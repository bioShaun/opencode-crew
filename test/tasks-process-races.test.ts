import { test, expect } from 'bun:test'
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, realpathSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

const root=resolve('test/.work/tasks-process-races'), tmp=join(root,'tmp'), script=resolve('test/fixtures/process-race-child.ts')
mkdirSync(tmp,{recursive:true})
const env:any=Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('GIT_'))); env.TMPDIR=tmp; env.GIT_OPTIONAL_LOCKS='0'
function run(cmd:string,args:string[]) { const p=spawnSync(cmd,args,{env,encoding:'utf8',timeout:15000}); if(p.error||p.status!==0||p.signal) throw Error(`${cmd} ${p.error||p.signal||p.stderr}`); return p.stdout.trim() }
function fixture() {
 const base=join(root,randomUUID()), primary=join(base,'primary'); mkdirSync(base,{recursive:true})
 const oid=run('git',['rev-parse','HEAD']);run('git',['clone','--no-local','--no-checkout',process.cwd(),primary]);run('git',['-C',primary,'checkout','--detach',oid])
 const inputs:any={}; for(const key of ['one','two','three']) {const dir=join(base,key);run('git',['-C',primary,'worktree','add','--detach',dir,oid]);inputs[key]={key,directory:realpathSync(dir),baseline:oid,scope:['src/'],goal:'goal',acceptance:'accept',check:'check'}}
 require('node:fs').writeFileSync(join(base,'config.json'),JSON.stringify({primary:realpathSync(primary),inputs}))
 return {base,primary}
}
type Harness = {all:ReturnType<typeof start>[], deadline:number}
function harness(ms=10000):Harness { return {all:[],deadline:Date.now()+ms} }
function start(base:string,name:string,key:string,mode:string,h:Harness, command='bun', args=[script,base,name,key,mode]) {
 const p=spawn(command,args,{env,stdio:['pipe','pipe','pipe']}); let stdout='',stderr='',error:Error|undefined,expired=false
 p.stdout.on('data',x=>stdout+=x);p.stderr.on('data',x=>stderr+=x);p.on('error',e=>error=e)
 const timer=setTimeout(()=>{expired=true;p.kill('SIGKILL')},Math.max(0,h.deadline-Date.now()))
 const closed=new Promise<{code:number|null,signal:NodeJS.Signals|null}>(r=>p.once('close',(code,signal)=>{clearTimeout(timer);r({code,signal})}))
 const barrier=()=>new Promise<void>((yes,no)=>{let done=false;const finish=(e?:Error)=>{if(done)return;done=true;p.stdout.off('data',check);p.off('error',failed);p.off('close',early);e?no(e):yes()};const check=()=>{if(stdout.includes('BARRIER\n'))finish()};const failed=(e:Error)=>finish(e);const early=()=>finish(Error(`barrier ${expired?'deadline':'early exit'}: ${stderr} ${error??''}`));p.stdout.on('data',check);p.once('error',failed);p.once('close',early);if(error)failed(error);else if(p.exitCode!==null||p.signalCode!==null)early();else check()})
 const finish=async()=>{const exit=await closed;if(error||expired||exit.code!==0||exit.signal!==null)throw Error(`child ${name}: ${error??''} deadline=${expired} exit=${JSON.stringify(exit)} ${stderr}`);return readFileSync(join(base,`${name}.jsonl`),'utf8').trim().split('\n').map(x=>JSON.parse(x))}
 const child={p,barrier,finish,closed};h.all.push(child);return child
}
const result=(events:any[])=>events.find(x=>x.type==='result').result
const effects=(events:any[])=>events.filter(x=>['create','prompt','interrupt','resume'].includes(x.type))
const tasks=(primary:string)=>JSON.parse(readFileSync(join(primary,'.git/opencode-crew-stage1/registry.json'),'utf8')).tasks
async function cleanup(h:Harness) {for(const child of h.all) if(child.p.exitCode===null && child.p.signalCode===null) child.p.kill('SIGKILL');await Promise.all(h.all.map(child=>child.closed))}

test('harness deadline rejects and reaps a child stalled before barrier',async()=>{
 const h=harness(150), base=root; const child=start(base,'stalled','one','lock',h,'bun',['-e','setInterval(()=>{},1000)'])
 try {const outcome=await Promise.race([child.barrier().then(()=> 'resolved',()=> 'rejected'),new Promise<string>(r=>setTimeout(()=>r('late'),500))]);expect(outcome).toBe('rejected');expect((await child.closed).signal).toBe('SIGKILL');await expect(child.finish()).rejects.toThrow('deadline=true');expect(h.all).toHaveLength(1)} finally {await cleanup(h)}
},30000)

test('harness rejects and reaps spawn errors promptly',async()=>{
 const h=harness(1000), base=root; const child=start(base,'missing','one','normal',h,join(base,'no-such-executable'))
 try {const outcome=await Promise.race([child.barrier().then(()=> 'resolved',()=> 'rejected'),new Promise<string>(r=>setTimeout(()=>r('late'),500))]);expect(outcome).toBe('rejected');expect((await child.closed).code).not.toBe(0);await expect(child.finish()).rejects.toThrow();expect(h.all).toHaveLength(1)} finally {await cleanup(h)}
},30000)

for(const mode of ['lock','reserved'] as const) test(`independent processes same key: ${mode}`,async()=>{
 const h=harness(), {base,primary}=fixture(), a=start(base,'winner','one',mode,h)
 try {
  await a.barrier(); if(mode==='lock') expect(existsSync(join(primary,'.git/opencode-crew-stage1/.lock'))).toBe(true)
  const b=start(base,'contender','one','normal',h);const be=await b.finish()
  if(mode==='lock') expect(result(be).error.code).toBe('REGISTRY_LOCKED');else {expect(result(be).task.state).toBe('reserved');expect(result(be).task.taskID).toBe('ct_one')}
  expect(effects(be)).toHaveLength(0);a.p.stdin.write('x');const ae=await a.finish();expect(result(ae).task.state).toBe('submitted');expect(effects(ae).map(x=>x.type)).toEqual(['create','prompt'])
  const before=tasks(primary);const c=start(base,'replay','one','normal',h);const ce=await c.finish();expect(result(ce).task.taskID).toBe('ct_one');expect(effects(ce)).toHaveLength(0);expect(tasks(primary)).toEqual(before);expect(before).toHaveLength(1)
  expect(new Set([ae[0].pid,be[0].pid,ce[0].pid]).size).toBe(3);console.log(JSON.stringify({case:mode,pids:[ae[0].pid,be[0].pid,ce[0].pid],tasks:before.map((x:any)=>[x.taskID,x.state]),effects:effects(ae).map(x=>x.type)}))
 } finally {await cleanup(h)}
},30000)

test('independent processes contend for final capacity slot',async()=>{
 const h=harness(), {base,primary}=fixture()
 try {
  const first=start(base,'first','one','normal',h);const fe=await first.finish();expect(result(fe).task.state).toBe('submitted')
  const a=start(base,'winner','two','lock',h);await a.barrier();expect(existsSync(join(primary,'.git/opencode-crew-stage1/.lock'))).toBe(true);const b=start(base,'contender','three','normal',h);const be=await b.finish();expect(result(be).error.code).toBe('REGISTRY_LOCKED');expect(effects(be)).toHaveLength(0)
  a.p.stdin.write('x');const ae=await a.finish();expect(result(ae).task.state).toBe('submitted');const retry=start(base,'capacity','three','normal',h);const re=await retry.finish();expect(result(re).error.code).toBe('CAPACITY_RESERVED');expect(effects(re)).toHaveLength(0)
  const before=tasks(primary);expect(before.map((x:any)=>[x.taskID,x.state])).toEqual([['ct_one','submitted'],['ct_two','submitted']]);const all=[...effects(fe),...effects(ae)];expect(all.map(x=>x.type)).toEqual(['create','prompt','create','prompt']);expect(new Set(all.filter(x=>x.type==='create').map(x=>x.session.id)).size).toBe(2)
  const replay=start(base,'replay','two','normal',h);const ce=await replay.finish();expect(result(ce).task.taskID).toBe('ct_two');expect(effects(ce)).toHaveLength(0);expect(tasks(primary)).toEqual(before)
  expect(new Set([fe[0].pid,ae[0].pid,be[0].pid,re[0].pid,ce[0].pid]).size).toBe(5);console.log(JSON.stringify({case:'capacity',pids:[fe[0].pid,ae[0].pid,be[0].pid,re[0].pid,ce[0].pid],tasks:before.map((x:any)=>[x.taskID,x.state]),effects:all.map(x=>x.type),third:'absent'}))
 } finally {await cleanup(h)}
},30000)
