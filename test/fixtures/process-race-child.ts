import { registerTasks } from '../../src/tasks'
import { Ledger } from '../../src/tasks-state'
import { AtomicRegistry } from '../../src/tasks-ledger'
import { readFileSync, openSync, writeSync, fsyncSync, closeSync, readSync } from 'node:fs'
import { join } from 'node:path'

const [base, name, key, mode] = process.argv.slice(2)
const config = JSON.parse(readFileSync(join(base, 'config.json'), 'utf8'))
const fd = openSync(join(base, `${name}.jsonl`), 'wx')
const event = (type:string, data:any = {}) => { writeSync(fd, JSON.stringify({pid:process.pid, name, type, ...data})+'\n'); fsyncSync(fd) }
const barrier = () => { process.stdout.write('BARRIER\n'); const b=Buffer.alloc(1); if(readSync(0,b,0,1,null)!==1) throw Error('barrier closed') }
let held = false
const lock = AtomicRegistry.prototype.withLock
AtomicRegistry.prototype.withLock = function(fn:any) { return lock.call(this, (store:any) => { if(mode==='lock' && !held) { held=true; barrier() } return fn(store) }) as any }
const reserve = Ledger.prototype.reserve
Ledger.prototype.reserve = function(...args:any[]) { const result=reserve.apply(this,args as any); if(mode==='reserved' && !result.replayed) barrier(); return result }
const tools=new Map<string,any>()
const owner={id:'owner',agent:'root',location:{directory:config.primary},model:{providerID:'test',id:'test'}}
let ownSession:any
const ctx:any={location:{directory:config.primary},tool:{transform:async(fn:any)=>fn({add:(t:any)=>tools.set(t.name,t)})},permission:{assert:async()=>{}},session:{
 hook:async()=>({dispose:async()=>{}}), get:async({sessionID}:any)=>{if(sessionID==='owner')return owner; if(ownSession?.id===sessionID)return ownSession; throw Error('unexpected child get')},
 create:async(x:any)=>{const session={id:`child-${process.pid}`, ...x}; event('create',{session});ownSession=session;return session},
 prompt:async(x:any)=>event('prompt',{input:x}), interrupt:async()=>event('interrupt'),resume:async()=>event('resume')
}}
event('setup'); await registerTasks(ctx)
const tc={sessionID:'owner',agent:'root',messageID:'message',id:'call',signal:new AbortController().signal}
const result=(await tools.get('crew_task_start').execute(config.inputs[key],tc)).output
event('result',{result}); closeSync(fd)
