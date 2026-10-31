import { registerTasks } from '../../src/tasks'
import { Ledger } from '../../src/tasks-state'
import { appendFileSync, readFileSync, writeFileSync, openSync, fsyncSync, closeSync } from 'node:fs'
import { join } from 'node:path'

const [base, point, mode] = process.argv.slice(2)
const config=JSON.parse(readFileSync(join(base,'config.json'),'utf8'))
const event=(x:string)=>{const fd=openSync(join(base,'events'),'a');try{appendFileSync(fd,x+'\n');fsyncSync(fd)}finally{closeSync(fd)}}
const barrier=(x:string)=>{if(mode==='crash' && point===x){process.stdout.write('BARRIER '+x+'\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0)}}
const reserve=Ledger.prototype.reserve, transition=Ledger.prototype.transition
Ledger.prototype.reserve=function(...args:any[]){const result=reserve.apply(this,args as any);barrier('reserved');return result}
Ledger.prototype.transition=function(...args:any[]){const next=args[3];if(mode==='failboth' && (next===point || next==='start_unconfirmed')){event('fail:'+next);throw Error('injected before checkpoint write')}if(mode==='fail' && next===point)throw Error('injected before checkpoint write');if(next==='session_bound')barrier('create-return');if(next==='submitted')barrier('prompt-return');const result=transition.apply(this,args as any);barrier(next);return result}
const tools=new Map<string,any>()
const owner={id:'owner',agent:'root',location:{directory:config.primary},model:{providerID:'test',id:'test'}}
const ctx:any={location:{directory:config.primary},tool:{transform:async(fn:any)=>fn({add:(t:any)=>tools.set(t.name,t)})},permission:{assert:async()=>{}},session:{
 hook:async()=>({dispose:async()=>{}}),
 get:async({sessionID}:any)=>sessionID==='owner'?owner:JSON.parse(readFileSync(join(base,'session.json'),'utf8')),
 create:async(x:any)=>{event('create');const s={id:'child',...x};writeFileSync(join(base,'session.json'),JSON.stringify(s));return s},
 prompt:async()=>{event('prompt');barrier('prompt-effect')},
 interrupt:async()=>{event('interrupt')},resume:async()=>{event('resume')}
}}
await registerTasks(ctx)
const tc={sessionID:'owner',agent:'root',messageID:'message',id:'call',signal:new AbortController().signal}
if(mode==='capacity') {
 const results=[]
 for(const input of config.extraInputs) results.push((await tools.get('crew_task_start').execute(input,tc)).output)
 writeFileSync(join(base,'capacity-result.json'),JSON.stringify(results))
} else {
 const out=await tools.get('crew_task_start').execute(config.input,tc)
 writeFileSync(join(base,mode+'-result.json'),JSON.stringify(out.output))
}
