import { test, expect } from 'bun:test'
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { randomUUID } from 'node:crypto'

const root=resolve('test/.work/tasks-checkpoints'), tmp=join(root,'tmp'), child=resolve('test/fixtures/checkpoint-child.ts')
mkdirSync(tmp,{recursive:true})
const env={...process.env,TMPDIR:tmp,GIT_OPTIONAL_LOCKS:'0'}
function run(cmd:string,args:string[]) {const p=spawnSync(cmd,args,{encoding:'utf8',env,timeout:15000});if(p.error || p.status!==0 || p.signal)throw Error(`${cmd}: ${p.error ?? p.signal ?? p.stderr}`);return p.stdout.trim()}
const cases=[
 ['reserved','reserved',0,0,false], ['session_create_requested','session_create_requested',0,0,false],
 ['create-return','session_create_requested',1,0,false], ['session_bound','session_bound',1,0,true],
 ['prompt_requested','prompt_requested',1,0,true], ['prompt-effect','prompt_requested',1,1,true],
 ['prompt-return','prompt_requested',1,1,true], ['submitted','submitted',1,1,true],
] as const
for(const [point,state,creates,prompts,bound] of cases) test(`SIGKILL at ${point} preserves ${state} and replay never launches`,async()=>{
 const base=join(root,randomUUID()), primary=join(base,'primary'), target=join(base,'target');mkdirSync(base,{recursive:true})
 const oid=run('git',['rev-parse','HEAD']);run('git',['clone','--no-local','--no-checkout',process.cwd(),primary]);run('git',['-C',primary,'checkout','--detach',oid]);run('git',['-C',primary,'worktree','add','--detach',target,oid])
 const input={key:'one',directory:realpathSync(target),baseline:oid,scope:['src/'],goal:'goal',acceptance:'accept',check:'check'}
 const extraInputs:any[]=[]
 if(point==='reserved') for(const key of ['two','three']) {const dir=join(base,key);run('git',['-C',primary,'worktree','add','--detach',dir,oid]);extraInputs.push({...input,key,directory:realpathSync(dir)})}
 writeFileSync(join(base,'config.json'),JSON.stringify({primary:realpathSync(primary),input,extraInputs}))
 const proc=spawn('bun',[child,base,point,'crash'],{env,stdio:['ignore','pipe','pipe']});let stderr='',stdout=''
 proc.stderr.on('data',x=>stderr+=x);proc.stdout.on('data',x=>stdout+=x)
 const closed=new Promise<{code:number|null;signal:NodeJS.Signals|null}>(r=>proc.once('close',(code,signal)=>r({code,signal})))
 try {
  await new Promise<void>((yes,no)=>{const timer=setTimeout(()=>no(Error(`barrier timeout ${stdout} ${stderr}`)),15000);proc.once('error',e=>{clearTimeout(timer);no(e)});proc.stdout.on('data',()=>{if(stdout.includes(`BARRIER ${point}\n`)){clearTimeout(timer);yes()}});proc.once('exit',()=>{clearTimeout(timer);no(Error(`early exit ${stderr}`))})})
 } finally {if(proc.exitCode===null && proc.signalCode===null)proc.kill('SIGKILL');const exit=await closed;expect(exit.signal).toBe('SIGKILL');expect(exit.code).toBeNull()}
 const registry=join(primary,'.git','opencode-crew-stage1','registry.json')
 const before=JSON.parse(readFileSync(registry,'utf8')).tasks[0]
 expect(before.state).toBe(state);expect(before.sessionID=== 'child').toBe(bound);expect(before.input).toEqual(input)
 const events=()=>existsSync(join(base,'events'))?readFileSync(join(base,'events'),'utf8').trim().split('\n'):[]
 expect(events()).toEqual([...Array(creates).fill('create'),...Array(prompts).fill('prompt')])
 run('bun',[child,base,point,'replay'])
 const replay=JSON.parse(readFileSync(join(base,'replay-result.json'),'utf8'));expect(replay.ok).toBe(true);expect(replay.task.state).toBe(state);expect(replay.task.taskID).toBe('ct_one')
 expect(JSON.parse(readFileSync(registry,'utf8')).tasks[0]).toEqual(before)
 expect(events()).toEqual([...Array(creates).fill('create'),...Array(prompts).fill('prompt')])
 if(point==='reserved') {run('bun',[child,base,point,'capacity']);const results=JSON.parse(readFileSync(join(base,'capacity-result.json'),'utf8'));expect(results[0].ok).toBe(true);expect(results[1].error.code).toBe('CAPACITY_RESERVED');const tasks=JSON.parse(readFileSync(registry,'utf8')).tasks;expect(tasks).toHaveLength(2);expect(tasks[0]).toEqual(before);expect(tasks[1].taskID).toBe('ct_two');expect(events()).toEqual(['create','prompt'])}
},30000)

for(const [point,creates,prompts] of [
 ['session_create_requested',0,0],['session_bound',1,0],['prompt_requested',1,0],['submitted',1,1],
] as const) test(`checkpoint ${point} rejects before write, replay has no new effects`,()=>{
 const base=join(root,randomUUID()),primary=join(base,'primary'),target=join(base,'target');mkdirSync(base,{recursive:true})
 const oid=run('git',['rev-parse','HEAD']);run('git',['clone','--no-local','--no-checkout',process.cwd(),primary]);run('git',['-C',primary,'checkout','--detach',oid]);run('git',['-C',primary,'worktree','add','--detach',target,oid])
 const input={key:'one',directory:realpathSync(target),baseline:oid,scope:['src/'],goal:'goal',acceptance:'accept',check:'check'}
 writeFileSync(join(base,'config.json'),JSON.stringify({primary:realpathSync(primary),input}))
 run('bun',[child,base,point,'fail']);const result=JSON.parse(readFileSync(join(base,'fail-result.json'),'utf8'));expect(result.ok).toBe(false)
 const registry=join(primary,'.git','opencode-crew-stage1','registry.json'),before=JSON.parse(readFileSync(registry,'utf8')).tasks[0]
 expect(before.state).toBe('start_unconfirmed');expect(before.sessionID==='child').toBe(point==='prompt_requested'||point==='submitted')
 const events=()=>existsSync(join(base,'events'))?readFileSync(join(base,'events'),'utf8').trim().split('\n'):[]
 expect(events()).toEqual([...Array(creates).fill('create'),...Array(prompts).fill('prompt')])
 run('bun',[child,base,point,'replay']);expect(JSON.parse(readFileSync(join(base,'replay-result.json'),'utf8')).task.state).toBe('start_unconfirmed')
 expect(JSON.parse(readFileSync(registry,'utf8')).tasks[0]).toEqual(before);expect(events()).toEqual([...Array(creates).fill('create'),...Array(prompts).fill('prompt')])
},30000)

test('submitted and error checkpoints both fail: prompt intent survives replay without another prompt',()=>{
 const base=join(root,randomUUID()),primary=join(base,'primary'),target=join(base,'target');mkdirSync(base,{recursive:true})
 const oid=run('git',['rev-parse','HEAD']);run('git',['clone','--no-local','--no-checkout',process.cwd(),primary]);run('git',['-C',primary,'checkout','--detach',oid]);run('git',['-C',primary,'worktree','add','--detach',target,oid])
 const input={key:'one',directory:realpathSync(target),baseline:oid,scope:['src/'],goal:'goal',acceptance:'accept',check:'check'}
 writeFileSync(join(base,'config.json'),JSON.stringify({primary:realpathSync(primary),input}))
 run('bun',[child,base,'submitted','failboth']);expect(JSON.parse(readFileSync(join(base,'failboth-result.json'),'utf8')).ok).toBe(false)
 const registry=join(primary,'.git','opencode-crew-stage1','registry.json'),before=JSON.parse(readFileSync(registry,'utf8')).tasks[0]
 expect(before.state).toBe('prompt_requested');expect(before.sessionID).toBe('child');expect(readFileSync(join(base,'events'),'utf8')).toBe('create\nprompt\nfail:submitted\nfail:start_unconfirmed\n')
 run('bun',[child,base,'submitted','replay']);expect(JSON.parse(readFileSync(join(base,'replay-result.json'),'utf8')).task.state).toBe('prompt_requested')
 expect(JSON.parse(readFileSync(registry,'utf8')).tasks[0]).toEqual(before);expect(readFileSync(join(base,'events'),'utf8')).toBe('create\nprompt\nfail:submitted\nfail:start_unconfirmed\n')
},30000)
