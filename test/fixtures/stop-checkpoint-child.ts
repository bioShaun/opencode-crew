import { registerTasks } from '../../src/tasks'
import { Ledger } from '../../src/tasks-state'
import { appendFileSync, readFileSync, writeFileSync, openSync, fsyncSync, closeSync } from 'node:fs'
import { join } from 'node:path'

const [base,mode,point=''] = process.argv.slice(2)
const config=JSON.parse(readFileSync(join(base,'config.json'),'utf8'))
const durable=(file:string,text:string)=>{const fd=openSync(join(base,file),'a',0o600);try{appendFileSync(fd,text);fsyncSync(fd)}finally{closeSync(fd)}}
const event=(x:string)=>durable('events',x+'\n')
const barrier=(x:string)=>{if(mode==='crash' && point===x){process.stdout.write(`BARRIER ${x}\n`);Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0)}}
const transition=Ledger.prototype.transition
Ledger.prototype.transition=function(...args:any[]){
 const next=args[3]
 if((mode==='fail-intent' && next==='stop_requested') || (mode==='fail-result' && next==='stop_unconfirmed')){event('fail:'+next);throw Error('injected checkpoint failure')}
 if(next==='stop_unconfirmed')barrier('interrupt-return')
 const result=transition.apply(this,args as any)
 if(next==='stop_requested'||next==='stop_unconfirmed')barrier(next)
 return result
}
const tools=new Map<string,any>()
const owner={id:'owner',agent:'root',location:{directory:config.primary},model:{providerID:'test',id:'stub'}}
const ctx:any={location:{directory:config.primary},tool:{transform:async(fn:any)=>fn({add:(tool:any)=>tools.set(tool.name,tool)})},permission:{assert:async()=>{}},session:{
 hook:async()=>({dispose:async()=>{}}),
 get:async({sessionID}:any)=>sessionID==='owner'?owner:JSON.parse(readFileSync(join(base,'session.json'),'utf8')),
 create:async(x:any)=>{event('create');const s={id:'child',...x};durable('session.json',JSON.stringify(s));return s},
 prompt:async()=>{event('prompt')},
 interrupt:async(x:any)=>{event(`interrupt:${JSON.stringify(x)}`);barrier('interrupt-effect');if(mode==='interrupt-error')throw Error('PRIVATE_STOP_SECRET');return {interrupted:true}},
 resume:async()=>{event('resume')}
}}
await registerTasks(ctx)
const tc={sessionID:'owner',agent:'root',messageID:'message',id:'call',signal:new AbortController().signal}
const invoke=async(name:string,input:any)=>(await tools.get(name).execute(input,tc)).output
let output:any
if(mode==='setup') output=await invoke('crew_task_start',config.input)
else if(mode==='status') output=await invoke('crew_task_status',{taskID:'ct_one'})
else if(mode==='collision') output=await invoke('crew_task_start',{...config.input,key:'other'})
else output=await invoke('crew_task_stop',{taskID:'ct_one'})
writeFileSync(join(base,mode+'-result.json'),JSON.stringify(output))
