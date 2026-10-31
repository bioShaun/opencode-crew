import * as fs from 'node:fs'
import { mock } from 'bun:test'
import { join } from 'node:path'

const [base, point, action] = process.argv.slice(2)
const commonDir=join(base,'common'), primaryDirectory=join(base,'primary')
const directory=join(commonDir,'opencode-crew-stage1')
const descriptors=new Map<number,string>()
const original={...fs}
const hit=(name:string)=>{
 if(name!==point) return
 process.stdout.write(`HIT ${name}\n`)
 if(action==='kill') Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0)
 throw new Error(`injected ${name}`)
}
// Wrap only the real fs operations; AtomicRegistry remains the production implementation.
mock.module('node:fs',()=>({ ...original,
 openSync:(path:any,...args:any[])=>{const fd=(original.openSync as any)(path,...args);if(typeof path==='string')descriptors.set(fd,path);return fd},
 closeSync:(fd:number)=>{descriptors.delete(fd);return original.closeSync(fd)},
 writeFileSync:(file:any,...args:any[])=>{if(typeof file==='number' && descriptors.get(file)?.includes('/.registry-'))hit('write');return (original.writeFileSync as any)(file,...args)},
 fsyncSync:(fd:number)=>{const path=descriptors.get(fd);if(path?.includes('/.registry-'))hit('file-fsync');if(path===directory)hit('dir-fsync');return original.fsyncSync(fd)},
 renameSync:(from:any,to:any)=>{if(typeof from==='string' && from.includes('/.registry-'))hit('rename-before');original.renameSync(from,to);if(typeof from==='string' && from.includes('/.registry-'))hit('rename-after')},
}))
const { AtomicRegistry }=await import('../../src/tasks-ledger')
const { Ledger }=await import('../../src/tasks-state')
const identity={commonDir,primaryDirectory}
try {
 if(action==='reserve') {
  const dir=join(base,'target'), baseline='a'.repeat(40), scope=['src/']
  const input={key:'one',directory:dir,baseline,scope,goal:'goal',acceptance:'accept',check:'check'}
  new Ledger(identity).reserve('owner',input,()=>({...identity,directory:dir,baseline,scope}))
 } else {
  new AtomicRegistry(commonDir,identity).withLock(store=>store.write({version:'new',payload:['full',42]}))
 }
 process.stdout.write('RESULT success\n')
} catch(e:any) { process.stdout.write(`RESULT ${e.code ?? 'unknown'}\n`) }
