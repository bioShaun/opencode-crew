import { test, expect } from 'bun:test'
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, existsSync, statSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { AtomicRegistry } from '../src/tasks-ledger'

const root=resolve('test/.work/tasks-atomic-faults'),tmp=join(root,'tmp'),child=resolve('test/fixtures/atomic-fault-child.ts')
mkdirSync(tmp,{recursive:true})
const env={...process.env,TMPDIR:tmp}
const old={version:'old',payload:['complete',7]}, next={version:'new',payload:['full',42]}
function setup(initial=true) {
 const base=join(root,randomUUID()),commonDir=join(base,'common'),primaryDirectory=join(base,'primary')
 mkdirSync(commonDir,{recursive:true});mkdirSync(primaryDirectory,{recursive:true});mkdirSync(join(base,'target','src'),{recursive:true})
 const registry=new AtomicRegistry(commonDir,{commonDir,primaryDirectory})
 if(initial)registry.withLock(store=>store.write(old))
 return {base,commonDir,primaryDirectory,registry,dir:join(commonDir,'opencode-crew-stage1')}
}
function fresh(f:ReturnType<typeof setup>){return new AtomicRegistry(f.commonDir,{commonDir:f.commonDir,primaryDirectory:f.primaryDirectory})}
function checkMode(f:ReturnType<typeof setup>){expect(statSync(f.dir).mode & 0o777).toBe(0o700);expect(statSync(join(f.dir,'registry.json')).mode & 0o777).toBe(0o600)}
function fault(f:ReturnType<typeof setup>,point:string,action='fail') {
 const p=spawnSync('bun',[child,f.base,point,action],{env,encoding:'utf8',timeout:15000})
 expect(p.error).toBeUndefined();expect(p.status).toBe(0);expect(p.signal).toBeNull();expect(p.stdout).toContain(`HIT ${point}\n`);expect(p.stdout).toContain('RESULT REGISTRY_INVALID\n')
}

test('initial Ledger.reserve temporary write failure leaves no registry and releases lock',()=>{
 const f=setup(false);fault(f,'write','reserve');expect(fresh(f).read()).toBeUndefined();expect(existsSync(join(f.dir,'.lock'))).toBe(false);expect(existsSync(join(f.dir,'registry.json'))).toBe(false)
 expect(statSync(f.dir).mode & 0o777).toBe(0o700);expect(readdirSync(f.dir)).toEqual([])
 fresh(f).withLock(store=>store.write(next));expect(fresh(f).read()).toEqual(next);checkMode(f)
})
for(const [point,expected] of [['write',old],['file-fsync',old],['rename-before',old],['dir-fsync',next]] as const) test(`${point} failure preserves complete ${expected.version} and releases lock`,()=>{
 const f=setup();fault(f,point);expect(fresh(f).read()).toEqual(expected);checkMode(f);expect(existsSync(join(f.dir,'.lock'))).toBe(false);expect(readdirSync(f.dir)).toEqual(['registry.json'])
 fresh(f).withLock(store=>store.write({version:'after'}));expect(fresh(f).read()).toEqual({version:'after'});checkMode(f)
})
for(const [point,expected] of [['rename-before',old],['rename-after',next]] as const) test(`SIGKILL while locked ${point}: ${expected.version} readable, no lock stealing`,async()=>{
 const f=setup(),p=spawn('bun',[child,f.base,point,'kill'],{env,stdio:['ignore','pipe','pipe']});let out='',err=''
 p.stdout.on('data',x=>out+=x);p.stderr.on('data',x=>err+=x)
 const closed=new Promise<{code:number|null;signal:NodeJS.Signals|null}>(resolve=>p.once('close',(code,signal)=>resolve({code,signal})))
 try {
  await new Promise<void>((yes,no)=>{const timer=setTimeout(()=>no(Error(`timeout ${out} ${err}`)),15000);p.once('error',e=>{clearTimeout(timer);no(e)});p.once('exit',()=>{clearTimeout(timer);no(Error(`early exit ${out} ${err}`))});p.stdout.on('data',()=>{if(out.includes(`HIT ${point}\n`)){clearTimeout(timer);yes()}})})
 } finally {if(p.exitCode===null && p.signalCode===null)p.kill('SIGKILL');await closed}
 const exit=await closed;expect(exit.signal).toBe('SIGKILL');expect(exit.code).toBeNull();expect(out).toContain(`HIT ${point}\n`)
 expect(fresh(f).read()).toEqual(expected);checkMode(f);expect(existsSync(join(f.dir,'.lock'))).toBe(true);expect(statSync(join(f.dir,'.lock')).mode & 0o777).toBe(0o700)
 const temps=readdirSync(f.dir).filter(name=>name.startsWith('.registry-'));expect(temps.length).toBe(point==='rename-before'?1:0)
 if(temps.length)expect(statSync(join(f.dir,temps[0])).mode & 0o777).toBe(0o600)
 expect(()=>fresh(f).withLock(()=>{})).toThrow(expect.objectContaining({code:'REGISTRY_LOCKED'}));expect(existsSync(join(f.dir,'.lock'))).toBe(true);expect(fresh(f).read()).toEqual(expected)
},30000)
