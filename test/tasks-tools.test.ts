import { test, expect } from 'bun:test'
import plugin from '../src/index'
import { spawnSync } from 'node:child_process'
import { mkdirSync, realpathSync, writeFileSync, renameSync, symlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

test('registers exactly the three stage-1 task tools', async () => {
 const tools: any[]=[]
 const ctx: any={options:{},location:{directory:process.cwd()},agent:{transform:async (fn:any)=>fn({update:(_:any,f:any)=>f({permissions:[]})})},command:{transform:async (fn:any)=>fn({add:()=>{}})},tool:{transform:async (fn:any)=>fn({add:(tool:any)=>tools.push(tool)})},session:{hook:async()=>({dispose:async()=>{}})}}
 await plugin.setup(ctx)
 expect(tools.map(x=>x.name).sort()).toEqual(['crew_task_start','crew_task_status','crew_task_stop'])
})

async function fixture(options:any={}) {
 const base=resolve('test/.work/tasks-tools',randomUUID()), primary=resolve(base,'primary'), target=resolve(base,'target'); mkdirSync(base,{recursive:true})
 function git(...args:string[]) { const r=spawnSync('git',args,{encoding:'utf8',env:{...process.env,TMPDIR:resolve('test/.work/tasks-tools/tmp'),GIT_OPTIONAL_LOCKS:'0'}}); if(r.status!==0) throw Error('fixture git failed'); return r.stdout.trim() }
 const oid=git('rev-parse','HEAD'); git('clone','--no-local','--no-checkout',process.cwd(),primary); git('-C',primary,'checkout','--detach',oid); git('-C',primary,'worktree','add','--detach',target,oid)
 const dir=realpathSync(primary), wt=realpathSync(target), tools=new Map<string,any>(), hooks=new Map<string,any>(), sessions=new Map<string,any>(), calls:any[]=[]
 const owner:any={id:'owner',agent:'root',location:{directory:dir},model:{providerID:'owner',id:'model'}}; sessions.set('owner',owner)
 const controls:any={}
 const ctx:any={options,location:{directory:dir},agent:{transform:async(fn:any)=>fn({update:(_:any,f:any)=>f({permissions:[]})})},command:{transform:async(fn:any)=>fn({add:()=>{}})},tool:{transform:async(fn:any)=>fn({add:(t:any)=>tools.set(t.name,t)})},permission:{assert:async(x:any)=>{calls.push(['assert',x]);if(controls.deny===x.action) throw Error('permission denied')}},session:{
  hook:async(name:string,fn:any)=>{hooks.set(name,fn);return {dispose:async()=>{}}},get:async({sessionID}:any)=>{if(controls.getError===sessionID)throw Error('secret host body');const s=sessions.get(sessionID);if(!s)throw Error('secret host body');return s},
  create:async(x:any)=>{calls.push(['create',x]);const id=calls.filter(c=>c[0]==='create').length===1?'child':'child2';const s={id,...x,time:{created:1,updated:1}};sessions.set(id,s);if(controls.createLost)throw Error('secret host body');return s},
  prompt:async(x:any)=>{calls.push(['prompt',x]);if(controls.promptLost)throw Error('secret host body')},interrupt:async(x:any)=>{calls.push(['interrupt',x]);if(controls.interruptLost)throw Error('secret host body');return {interrupted:true}},
 }}
 await plugin.setup(ctx)
 const tc:any={sessionID:'owner',agent:'root',messageID:'message',id:'call',signal:new AbortController().signal}, input={key:'one',directory:wt,baseline:oid,scope:['src/'],goal:'private-goal',acceptance:'private-acceptance',check:'private-check'}
 const run=async(name:string,args:any,context=tc)=>{const tool=tools.get(name);expect(tool).toBeDefined();return (await tool.execute(args,context)).output}
 return {tools,hooks,sessions,calls,controls,owner,tc,input,run,dir,ctx}
}

test('one launch and replay, private status, model and metadata',async()=>{
 const f=await fixture(); const a:any=await f.run('crew_task_start',f.input); expect(a.ok).toBe(true)
 const b:any=await f.run('crew_task_start',f.input); expect(b.ok).toBe(true)
 expect(f.calls.filter(x=>x[0]==='create')).toHaveLength(1);expect(f.calls.filter(x=>x[0]==='prompt')).toHaveLength(1)
 const create=f.calls.find(x=>x[0]==='create')[1];expect(create.agent).toBe('engineer');expect(create.model).toEqual(f.owner.model);expect(create.metadata).toBeDefined()
 const status:any=await f.run('crew_task_status',{});expect(status.ok).toBe(true);expect(JSON.stringify(status)).not.toContain('private-goal');expect(status.tasks[0].processSafety).toBe('unconfirmed');expect(status.tasks[0].canIntegrate).toBe(false)
})

test('prunable unrelated worktree does not break status stop or retry',async()=>{
 const f=await fixture(); const second=resolve(f.dir,'../second')
 const git=spawnSync('git',['-C',f.dir,'worktree','add','--detach',second,f.input.baseline],{encoding:'utf8',env:{...process.env,TMPDIR:resolve('test/.work/tasks-tools/tmp')}}); expect(git.status).toBe(0)
 expect((await f.run('crew_task_start',f.input)).ok).toBe(true)
 expect((await f.run('crew_task_start',{...f.input,key:'two',directory:second})).ok).toBe(true)
 renameSync(f.input.directory,f.input.directory+'-missing')
 const status:any=await f.run('crew_task_status',{});expect(status.ok).toBe(true);expect(status.tasks).toHaveLength(2)
 const stopped:any=await f.run('crew_task_stop',{taskID:'ct_two'});expect(stopped.ok).toBe(true);expect(f.calls.filter(x=>x[0]==='interrupt')).toHaveLength(1)
 await plugin.setup({...f.ctx,location:{directory:second}})
 const ev:any={sessionID:'child2',decision:{retry:true}};await f.hooks.get('retry')(ev);expect(ev.decision.retry).toBe(false)
})

test('canonical alias launch and replay survives missing canonical directory',async()=>{
 const f=await fixture();const alias=f.input.directory+'-alias';symlinkSync(f.input.directory,alias)
 const a:any=await f.run('crew_task_start',{...f.input,directory:alias});expect(a.ok).toBe(true);expect(a.task.directory).toBe(f.input.directory)
 const b:any=await f.run('crew_task_start',{...f.input,directory:alias});expect(b.ok).toBe(true)
 const edit=f.calls.find(x=>x[0]==='assert' && x[1].action==='edit')[1];expect(edit.resources[0]).toBe(resolve(f.input.directory,'src')+'/**')
 renameSync(f.input.directory,f.input.directory+'-missing')
 const c:any=await f.run('crew_task_start',f.input);expect(c.ok).toBe(true)
 const d:any=await f.run('crew_task_start',{...f.input,key:'new'});expect(d.ok).toBe(false)
 expect(f.calls.filter(x=>x[0]==='create')).toHaveLength(1);expect(f.calls.filter(x=>x[0]==='prompt')).toHaveLength(1)
})
test('lost prompt response does not replay, status error remains private and reservation remains',async()=>{
 const f=await fixture();f.controls.promptLost=true;await f.run('crew_task_start',f.input);await f.run('crew_task_start',f.input);expect(f.calls.filter(x=>x[0]==='prompt')).toHaveLength(1)
 f.controls.getError='child';const s:any=await f.run('crew_task_status',{});expect(JSON.stringify(s)).not.toContain('secret host body');expect(s.tasks[0].processSafety).toBe('unconfirmed')
})
test('denial, non-root, and wrong owner location have zero launch effects',async()=>{
 const f=await fixture();f.controls.deny='crew_task_start';await expect(f.run('crew_task_start',f.input)).rejects.toThrow('permission denied');f.controls.deny=undefined
 await f.run('crew_task_start',f.input,{...f.tc,agent:'engineer'});f.owner.location={directory:'/wrong'};await f.run('crew_task_start',f.input)
 expect(f.calls.filter(x=>['create','prompt','interrupt'].includes(x[0]))).toHaveLength(0)
})
test('stop requests at most one interrupt and identity mismatch never interrupts',async()=>{
 const f=await fixture();await f.run('crew_task_start',f.input);const child=f.sessions.get('child');child.agent='other';await f.run('crew_task_stop',{taskID:'ct_one'});expect(f.calls.filter(x=>x[0]==='interrupt')).toHaveLength(0)
 child.agent='engineer';const a:any=await f.run('crew_task_stop',{taskID:'ct_one'});const b:any=await f.run('crew_task_stop',{taskID:'ct_one'});expect(a.task.state).toBe('stop_unconfirmed');expect(b.task.state).toBe('stop_unconfirmed');expect(f.calls.filter(x=>x[0]==='interrupt')).toHaveLength(1)
})

test('retry hook only disables retry for a ledger-bound matching session',async()=>{
 const f=await fixture(); await f.run('crew_task_start',f.input)
 const hook=f.hooks.get('retry'); expect(hook).toBeDefined()
 const event:any={sessionID:'child',decision:{retry:true,delay:10}}; await hook(event); expect(event.decision).toEqual({retry:false})
 f.sessions.get('child').metadata.crewTask.taskID='ct_forged'
 const other:any={sessionID:'child',decision:{retry:true,delay:10}}; await hook(other); expect(other.decision.retry).toBe(true)
})

test('worktree hook resolves primary ledger and refuses forged or missing sessions',async()=>{
 const f=await fixture(); await f.run('crew_task_start',f.input)
 await plugin.setup({...f.ctx,location:{directory:f.input.directory}})
 const hook=f.hooks.get('retry'); const ev:any={sessionID:'child',decision:{retry:true,delay:1}}; await hook(ev); expect(ev.decision.retry).toBe(false)
 const copy={...f.sessions.get('child'),id:'forged'}; f.sessions.set('forged',copy)
 const fake:any={sessionID:'forged',decision:{retry:true,delay:1}}; await hook(fake); expect(fake.decision.retry).toBe(true)
 f.controls.getError='child'; const missing:any={sessionID:'child',decision:{retry:true,delay:1}}; await hook(missing); expect(missing.decision.retry).toBe(true)
})
test('lost create response and denied permissions never launch twice',async()=>{
 const f=await fixture(); f.controls.createLost=true; await f.run('crew_task_start',f.input); await f.run('crew_task_start',f.input)
 expect(f.calls.filter(x=>x[0]==='create')).toHaveLength(1); expect(f.calls.filter(x=>x[0]==='prompt')).toHaveLength(0)
 for(const action of ['subagent','edit']) { const g=await fixture();g.controls.deny=action;await expect(g.run('crew_task_start',g.input)).rejects.toThrow('permission denied');expect(g.calls.filter(x=>x[0]==='create')).toHaveLength(0) }
})
test('concurrent stop records bounded error and interrupts at most once',async()=>{
 const f=await fixture(); await f.run('crew_task_start',f.input); f.controls.interruptLost=true
 await Promise.all([f.run('crew_task_stop',{taskID:'ct_one'}),f.run('crew_task_stop',{taskID:'ct_one'})])
 expect(f.calls.filter(x=>x[0]==='interrupt')).toHaveLength(1)
 const s:any=await f.run('crew_task_status',{taskID:'ct_one'}); expect(s.task.interruptResult).toEqual({interrupted:'unknown',result:'error',errorCode:'HOST_ERROR'});expect(JSON.stringify(s)).not.toContain('secret host body')
})
test('configured model wins, absent model and dirty primary refuse launch',async()=>{
 const f=await fixture({models:{engineer:'configured/model'}}); await f.run('crew_task_start',f.input);expect(f.calls.find(x=>x[0]==='create')[1].model).toEqual({providerID:'configured',id:'model'})
 const g=await fixture(); delete g.owner.model;expect((await g.run('crew_task_start',g.input)).ok).toBe(false);expect(g.calls.filter(x=>x[0]==='create')).toHaveLength(0)
 const h=await fixture();writeFileSync(resolve(h.dir,'dirty-safety-test'),'dirty');expect((await h.run('crew_task_start',h.input)).ok).toBe(false);expect(h.calls.filter(x=>x[0]==='create')).toHaveLength(0)
})
test('independent registrations racing the same key launch once',async()=>{
 const f=await fixture();const second=new Map<string,any>();await plugin.setup({...f.ctx,tool:{transform:async(fn:any)=>fn({add:(t:any)=>second.set(t.name,t)})}})
 await Promise.all([f.run('crew_task_start',f.input),second.get('crew_task_start').execute(f.input,f.tc)])
 expect(f.calls.filter(x=>x[0]==='create')).toHaveLength(1);expect(f.calls.filter(x=>x[0]==='prompt')).toHaveLength(1)
})
test('session mismatch prevents prompt and missing session preserves reservation',async()=>{
 const f=await fixture(); const create=f.ctx.session.create
 f.ctx.session.create=async(x:any)=>{const s=await create(x);s.agent='wrong';return s}
 const result:any=await f.run('crew_task_start',f.input);expect(result.ok).toBe(false);expect(f.calls.filter(x=>x[0]==='prompt')).toHaveLength(0)
 f.controls.getError='child';const status:any=await f.run('crew_task_status',{});expect(status.tasks).toHaveLength(1);expect(status.tasks[0].observed.errorCode).toBe('HOST_ERROR')
 const replay:any=await f.run('crew_task_start',f.input);expect(replay.task.state).toBe('start_unconfirmed');expect(f.calls.filter(x=>x[0]==='create')).toHaveLength(1)
})
test('successful void interrupt is recorded as unknown, not confirmed',async()=>{
 const f=await fixture(); f.ctx.session.interrupt=async(x:any)=>{f.calls.push(['interrupt',x])}
 await f.run('crew_task_start',f.input); const s:any=await f.run('crew_task_stop',{taskID:'ct_one'})
 expect(s.task.interruptResult).toEqual({interrupted:'unknown',result:'request_completed'})
})
