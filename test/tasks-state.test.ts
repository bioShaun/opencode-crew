import { test, expect } from 'bun:test'
import { mkdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
const load = () => { try { return require('../src/tasks-state') } catch (e) { if ((e as any).code === 'MODULE_NOT_FOUND') return {}; throw e } }
test('normalization, digest, durable reservation and stage CAS', () => {
 const m = load(), root = join(import.meta.dir, '.work/tasks-state', randomUUID()); mkdirSync(root, {recursive:true}); const dir=realpathSync(root)
 const raw={key:'one',directory:dir,baseline:'a'.repeat(40),scope:['z','a','z'],goal:'g',acceptance:'a',check:'c'}
 const input = m.normalizeTaskInput?.(raw)
 expect(input?.scope).toEqual(['a','z'])
 expect(m.requestDigest(input,'owner')).not.toBe(m.requestDigest(input,'other'))
 const project={primaryDirectory:dir,commonDir:dir}, ledger=new m.Ledger(project)
 const preflight=()=>({...project,directory:dir,baseline:input.baseline,scope:input.scope})
 expect(ledger.reserve('owner',input,preflight).replayed).toBe(false)
 expect(new m.Ledger(project).reserve('owner',input,()=>{throw Error('unexpected preflight')}).replayed).toBe(true)
 expect(()=>ledger.transition('owner','ct_one','reserved','submitted')).toThrow()
 expect(ledger.transition('owner','ct_one','reserved','stop_requested').state).toBe('stop_requested')
 expect(()=>ledger.transition('owner','ct_one','reserved','stop_requested')).toThrow()
})

test('rejects invalid input and scope', () => {
 const m=load(), dir=realpathSync(import.meta.dir)
 const input={key:'k',directory:dir,baseline:'b'.repeat(40),scope:['ok'],goal:'g',acceptance:'a',check:'c'}
 for (const changes of [{key:'bad key'}, {owner:'x'}, {baseline:'A'.repeat(40)}, {goal:''}, {scope:['../escape']}, {directory:'relative'}]) expect(()=>m.normalizeTaskInput({...input,...changes})).toThrow()
})
test('capacity, identity, replay, and stop CAS remain durable', () => {
 const m=load(), root=join(import.meta.dir,'.work/tasks-state',randomUUID()); mkdirSync(root,{recursive:true}); const base=realpathSync(root)
 const dirs=['a','b','c'].map(x=>{const p=join(base,x);mkdirSync(p);return p}), project={primaryDirectory:base,commonDir:base}
 const ledger=new m.Ledger(project), raw=(key:string,i:number,baseline='a'.repeat(40))=>m.normalizeTaskInput({key,directory:dirs[i],baseline,scope:['out'],goal:'g',acceptance:'a',check:'c'})
 const reserve=(input:any)=>ledger.reserve('owner',input,()=>({...project,...input}))
 const one=raw('one',0); reserve(one)
 expect(()=>reserve(raw('other',0))).toThrow('WRITER_RESERVED')
 expect(()=>reserve(raw('other',1,'b'.repeat(40)))).toThrow('BASELINE_MISMATCH')
 reserve(raw('two',1)); expect(()=>reserve(raw('three',2))).toThrow('CAPACITY_RESERVED')
 expect(()=>ledger.reserve('other',one,()=>{throw Error('preflight')})).toThrow('IDEMPOTENCY_CONFLICT')
 expect(new m.Ledger(project).reserve('owner',one,()=>{throw Error('preflight')}).replayed).toBe(true)
 expect(()=>ledger.transition('owner','ct_one','reserved','submitted')).toThrow()
 ledger.transition('owner','ct_one','reserved','stop_requested')
 expect(()=>ledger.transition('owner','ct_one','reserved','stop_requested')).toThrow()
 ledger.transition('owner','ct_one','stop_requested','stop_unconfirmed')
 const copy=ledger.read(); copy[0].input.goal='changed'; expect(ledger.read()[0].input.goal).toBe('g')
})
test('invalid and symlink registries fail closed', () => {
 const {writeFileSync, symlinkSync, unlinkSync}=require('node:fs'), m=load(), root=join(import.meta.dir,'.work/tasks-state',randomUUID()); mkdirSync(root,{recursive:true}); const base=realpathSync(root), p={primaryDirectory:base,commonDir:base}, ledger=new m.Ledger(p)
 const directory=join(base,'opencode-crew-stage1'); mkdirSync(directory,{mode:0o700}); const file=join(directory,'registry.json')
 writeFileSync(file,JSON.stringify({schemaVersion:2})); expect(()=>ledger.read()).toThrow('REGISTRY_INVALID')
 unlinkSync(file); symlinkSync(join(base,'missing'),file); expect(()=>ledger.read()).toThrow('REGISTRY_INVALID')
})
test('registry rejects impossible session binding', () => {
 const {writeFileSync,readFileSync}=require('node:fs'), m=load(), root=join(import.meta.dir,'.work/tasks-state',randomUUID()); mkdirSync(root,{recursive:true}); const base=realpathSync(root), p={primaryDirectory:base,commonDir:base}, ledger=new m.Ledger(p)
 const input=m.normalizeTaskInput({key:'x',directory:base,baseline:'a'.repeat(40),scope:['x'],goal:'g',acceptance:'a',check:'c'})
 ledger.reserve('owner',input,()=>({...p,...input}))
 const file=join(base,'opencode-crew-stage1','registry.json'), data=JSON.parse(readFileSync(file,'utf8')); data.tasks[0].state='session_bound'; writeFileSync(file,JSON.stringify(data)); expect(()=>ledger.read()).toThrow('REGISTRY_INVALID')
})
test('corrupt records, duplicate keys, and identity mismatch fail closed', () => {
 const {writeFileSync,readFileSync}=require('node:fs'), m=load(), root=join(import.meta.dir,'.work/tasks-state',randomUUID()); mkdirSync(root,{recursive:true}); const base=realpathSync(root), p={primaryDirectory:base,commonDir:base}, ledger=new m.Ledger(p)
 const input=m.normalizeTaskInput({key:'x',directory:base,baseline:'a'.repeat(40),scope:['x'],goal:'g',acceptance:'a',check:'c'}); ledger.reserve('owner',input,()=>({...p,...input}))
 const file=join(base,'opencode-crew-stage1','registry.json'), original=JSON.parse(readFileSync(file,'utf8'))
 for (const mutate of [(v:any)=>v.tasks.push(v.tasks[0]),(v:any)=>v.tasks[0].state='unknown',(v:any)=>v.tasks[0].sessionID='',(v:any)=>v.tasks[0].requestDigest='bad',(v:any)=>v.project.primaryDirectory='/wrong']) { const data=structuredClone(original); mutate(data); writeFileSync(file,JSON.stringify(data)); expect(()=>ledger.read()).toThrow('REGISTRY_INVALID') }
})

test('history and replay survive a renamed or deleted worktree without new launch', () => {
 const {renameSync,rmSync}=require('node:fs'), m=load(), root=join(import.meta.dir,'.work/tasks-state',randomUUID()); mkdirSync(root,{recursive:true}); const base=realpathSync(root), dir=join(base,'work'); mkdirSync(dir)
 const project={primaryDirectory:base,commonDir:base}, ledger=new m.Ledger(project), input=m.normalizeTaskInput({key:'one',directory:dir,baseline:'a'.repeat(40),scope:['out'],goal:'g',acceptance:'a',check:'c'})
 let calls=0; ledger.reserve('owner',input,()=>{calls++;return {...project,...input}})
 renameSync(dir,join(base,'moved'))
 expect(ledger.read()[0].state).toBe('reserved')
 expect(ledger.reserve('owner',input,()=>{calls++;throw Error('must not launch')}).replayed).toBe(true)
 expect(calls).toBe(1)
 expect(()=>ledger.reserve('owner',{...input,key:'new'},()=>{throw Error('unexpected preflight')})).toThrow()
 rmSync(join(base,'moved'),{recursive:true}); expect(ledger.read()[0].state).toBe('reserved')
 expect(ledger.reserve('owner',input,()=>{calls++;throw Error('must not launch')}).replayed).toBe(true); expect(calls).toBe(1)
})

test('history ignores later scope symlinks but new work validates filesystem', () => {
 const {symlinkSync}=require('node:fs'), m=load(), root=join(import.meta.dir,'.work/tasks-state',randomUUID()); mkdirSync(root,{recursive:true}); const base=realpathSync(root), dir=join(base,'work'); mkdirSync(dir)
 const project={primaryDirectory:base,commonDir:base}, ledger=new m.Ledger(project), input=m.normalizeTaskInput({key:'one',directory:dir,baseline:'a'.repeat(40),scope:['out/file'],goal:'g',acceptance:'a',check:'c'})
 ledger.reserve('owner',input,()=>({...project,...input})); symlinkSync(base,join(dir,'out'))
 expect(ledger.read()[0].state).toBe('reserved')
 expect(ledger.reserve('owner',input,()=>{throw Error('must not launch')}).replayed).toBe(true)
 expect(()=>m.normalizeTaskInput({...input,key:'new'})).toThrow('INVALID_SCOPE')
 expect(()=>ledger.reserve('owner',{...input,key:'new'},()=>{throw Error('must not launch')})).toThrow()
 expect(()=>m.requestDigest({...input,scope:['../bad']},'owner')).toThrow()
 expect(()=>m.requestDigest({...input,directory:dir+'/../work'},'owner')).toThrow()
})
