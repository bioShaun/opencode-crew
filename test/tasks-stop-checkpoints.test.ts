import { test, expect } from 'bun:test'
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, realpathSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { randomUUID } from 'node:crypto'

const root=resolve('test/.work/tasks-stop-checkpoints'),tmp=join(root,'tmp'),child=resolve('test/fixtures/stop-checkpoint-child.ts')
mkdirSync(tmp,{recursive:true})
const env={...process.env,TMPDIR:tmp,GIT_OPTIONAL_LOCKS:'0'}
function run(cmd:string,args:string[]){const p=spawnSync(cmd,args,{env,encoding:'utf8',timeout:15000});if(p.error||p.status!==0||p.signal)throw Error(`${cmd}: ${p.error??p.signal??p.stderr}`);return p.stdout.trim()}
function fixture(){
 const base=join(root,randomUUID()),primary=join(base,'primary'),target=join(base,'target');mkdirSync(base,{recursive:true})
 const oid=run('git',['rev-parse','HEAD']);run('git',['clone','--no-local','--no-checkout',process.cwd(),primary]);run('git',['-C',primary,'checkout','--detach',oid]);run('git',['-C',primary,'worktree','add','--detach',target,oid])
 const input={key:'one',directory:realpathSync(target),baseline:oid,scope:['src/'],goal:'goal',acceptance:'accept',check:'check'}
 writeFileSync(join(base,'config.json'),JSON.stringify({primary:realpathSync(primary),input}))
 const call=(mode:string)=>{run('bun',[child,base,mode]);return JSON.parse(readFileSync(join(base,`${mode}-result.json`),'utf8'))}
 const registry=join(primary,'.git','opencode-crew-stage1','registry.json')
 const record=()=>JSON.parse(readFileSync(registry,'utf8')).tasks[0]
 const events=()=>readFileSync(join(base,'events'),'utf8').trim().split('\n')
 const setup=call('setup');expect(setup.ok).toBe(true);expect(setup.task.state).toBe('submitted');expect(record().sessionID).toBe('child');expect(events()).toEqual(['create','prompt'])
 return {base,input,call,record,events}
}
const interrupt='interrupt:{"sessionID":"child","resume":false}'
for(const [point,state,count] of [['stop_requested','stop_requested',0],['interrupt-effect','stop_requested',1],['interrupt-return','stop_requested',1],['stop_unconfirmed','stop_unconfirmed',1]] as const) test(`SIGKILL ${point}: ${state}, no replay interrupt`,async()=>{
 const f=fixture(),proc=spawn('bun',[child,f.base,'crash',point],{env,stdio:['ignore','pipe','pipe']});let out='',err=''
 proc.stdout.on('data',x=>out+=x);proc.stderr.on('data',x=>err+=x)
 const closed=new Promise<{code:number|null;signal:NodeJS.Signals|null}>(r=>proc.once('close',(code,signal)=>r({code,signal})))
 try {
  await new Promise<void>((yes,no)=>{const timer=setTimeout(()=>no(Error(`barrier timeout: ${out} ${err}`)),15000);proc.once('error',e=>{clearTimeout(timer);no(e)});proc.once('exit',()=>{clearTimeout(timer);no(Error(`early exit: ${out} ${err}`))});proc.stdout.on('data',()=>{if(out.includes(`BARRIER ${point}\n`)){clearTimeout(timer);yes()}})})
 } finally {if(proc.exitCode===null&&proc.signalCode===null)proc.kill('SIGKILL');const exit=await closed;expect(exit.signal).toBe('SIGKILL');expect(exit.code).toBeNull()}
 const before=f.record();expect(before.state).toBe(state);expect(before.sessionID).toBe('child');expect(before.input).toEqual(f.input)
 if(state==='stop_unconfirmed')expect(before.interruptResult).toEqual({interrupted:'unknown',result:'request_completed'})
 const expected=['create','prompt',...Array(count).fill(interrupt)];expect(f.events()).toEqual(expected)
 const replay=f.call('replay');expect(replay.ok).toBe(true);expect(replay.task.state).toBe(state);expect(replay.task.processSafety).toBe('unconfirmed');expect(f.record()).toEqual(before);expect(f.events()).toEqual(expected)
 if(point==='stop_requested'){
  const status=f.call('status');expect(status.ok).toBe(true);expect(status.task.state).toBe(state);expect(status.task.sessionID).toBe('child');expect(status.task.processSafety).toBe('unconfirmed')
  const collision=f.call('collision');expect(collision.ok).toBe(false);expect(collision.error.code).toBe('WRITER_RESERVED');expect(f.record()).toEqual(before);expect(f.events()).toEqual(expected)
 }
},30000)

test('stop intent write failure causes zero interrupt and later retry may interrupt once',()=>{
 const f=fixture(),before=f.record();const failed=f.call('fail-intent');expect(failed.ok).toBe(false);expect(f.record()).toEqual(before);expect(f.events()).toEqual(['create','prompt','fail:stop_requested'])
 const retry=f.call('replay');expect(retry.ok).toBe(true);expect(retry.task.state).toBe('stop_unconfirmed');expect(f.record().interruptResult).toEqual({interrupted:'unknown',result:'request_completed'})
 const after=f.record();expect(f.call('replay').task.state).toBe('stop_unconfirmed');expect(f.record()).toEqual(after);expect(f.events()).toEqual(['create','prompt','fail:stop_requested',interrupt])
},30000)

test('stop result write failure preserves intent and replay does not interrupt',()=>{
 const f=fixture(),failed=f.call('fail-result');expect(failed.ok).toBe(false)
 const before=f.record();expect(before.state).toBe('stop_requested');expect(before.sessionID).toBe('child');expect(before.interruptResult).toBeUndefined()
 expect(f.events()).toEqual(['create','prompt',interrupt,'fail:stop_unconfirmed']);const replay=f.call('replay');expect(replay.ok).toBe(true);expect(replay.task.state).toBe('stop_requested');expect(f.record()).toEqual(before);expect(f.events()).toEqual(['create','prompt',interrupt,'fail:stop_unconfirmed'])
},30000)

test('interrupt exception is bounded and private and is not repeated',()=>{
 const f=fixture(),result=f.call('interrupt-error');expect(result.ok).toBe(true);expect(result.task.state).toBe('stop_unconfirmed');expect(result.task.interruptResult).toEqual({interrupted:'unknown',result:'error',errorCode:'HOST_ERROR'})
 const before=f.record();expect(before.interruptResult).toEqual({interrupted:'unknown',result:'error',errorCode:'HOST_ERROR'});expect(JSON.stringify(result)).not.toContain('PRIVATE_STOP_SECRET');expect(JSON.stringify(before)).not.toContain('PRIVATE_STOP_SECRET')
 expect(f.call('replay').task.state).toBe('stop_unconfirmed');expect(f.record()).toEqual(before);expect(f.events()).toEqual(['create','prompt',interrupt])
},30000)
