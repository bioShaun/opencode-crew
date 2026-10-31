import { realpathSync, statSync } from 'node:fs'
import { isAbsolute, normalize } from 'node:path'
import { createHash } from 'node:crypto'
import { AtomicRegistry } from './tasks-ledger'
import { normalizeScope, normalizeScopeLexical, TaskRegistryError, type ProjectIdentity, type ValidatedWorktree } from './tasks-registry'

export interface TaskInput { key: string; directory: string; baseline: string; scope: string[]; goal: string; acceptance: string; check: string }
export type TaskState = 'reserved' | 'session_create_requested' | 'session_bound' | 'prompt_requested' | 'submitted' | 'start_unconfirmed' | 'stop_requested' | 'stop_unconfirmed'
export interface TaskRecord { taskID: string; input: TaskInput; ownerSessionID: string; requestDigest: string; state: TaskState; sessionID?: string; lastErrorCode?: 'START_UNCONFIRMED' | 'SESSION_MISMATCH' | 'HOST_ERROR'; interruptResult?: { interrupted: 'unknown'; result: 'request_completed' | 'not_requested' | 'error'; errorCode?: 'HOST_ERROR' }; createdAt: string; updatedAt: string }
interface Registry { schemaVersion: 1; project: ProjectIdentity; baseline: string; tasks: TaskRecord[] }
const fail = (code: ConstructorParameters<typeof TaskRegistryError>[0]): never => { throw new TaskRegistryError(code) }
const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x) && (Object.getPrototypeOf(x) === Object.prototype || Object.getPrototypeOf(x) === null)
const exact = (x: Record<string, unknown>, required: string[], optional: string[] = []) => required.every(k => Object.hasOwn(x,k)) && Object.keys(x).every(k => required.includes(k) || optional.includes(k))
const validInterrupt = (x: unknown) => object(x) && exact(x,['interrupted','result'],['errorCode']) && x.interrupted==='unknown' && (x.result==='error' ? x.errorCode==='HOST_ERROR' : (x.result==='request_completed' || x.result==='not_requested') && x.errorCode===undefined)
const id = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length <= 512 && !/[\x00-\x1f\x7f]/.test(x)
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x))
/** Shape-only normalization for persisted records and replay lookup; not a new-start safety check. */
export function normalizeStoredInput(raw: unknown): TaskInput {
 if (!object(raw) || !exact(raw,['key','directory','baseline','scope','goal','acceptance','check'])) return fail('INVALID_INPUT')
 const {key,directory,baseline,scope,goal,acceptance,check}=raw
 if (typeof key !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(key) || typeof directory !== 'string' || !isAbsolute(directory) || directory.includes('\0') || normalize(directory) !== directory || typeof baseline !== 'string' || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(baseline) || !Array.isArray(scope) || ![goal,acceptance,check].every(x => typeof x === 'string' && x.length >= 1 && x.length <= 8000) || Buffer.byteLength(JSON.stringify(raw)) > 32768) return fail('INVALID_INPUT')
 return {key,directory,baseline,scope:normalizeScopeLexical(scope),goal:goal as string,acceptance:acceptance as string,check:check as string}
}
export function normalizeTaskInput(raw: unknown): TaskInput {
 if (!object(raw) || typeof raw.directory !== 'string' || !isAbsolute(raw.directory)) return fail('INVALID_INPUT')
 let dir: string
 try { dir=realpathSync(raw.directory); if (!statSync(dir).isDirectory()) return fail('INVALID_INPUT') } catch { return fail('INVALID_INPUT') }
 const input=normalizeStoredInput({...raw,directory:dir})
 return {...input,scope:normalizeScope(dir,input.scope)}
}
export function requestDigest(input: TaskInput, ownerSessionID: string): string {
 if (!id(ownerSessionID)) return fail('INVALID_INPUT')
 const normalized=normalizeStoredInput(input)
 return createHash('sha256').update(JSON.stringify([normalized,ownerSessionID])).digest('hex')
}
const states: TaskState[] = ['reserved','session_create_requested','session_bound','prompt_requested','submitted','start_unconfirmed','stop_requested','stop_unconfirmed']
const edges: Record<TaskState, TaskState[]> = {
 reserved:['session_create_requested','start_unconfirmed','stop_requested'], session_create_requested:['session_bound','start_unconfirmed','stop_requested'], session_bound:['prompt_requested','start_unconfirmed','stop_requested'], prompt_requested:['submitted','start_unconfirmed','stop_requested'], submitted:['start_unconfirmed','stop_requested'], start_unconfirmed:['stop_requested'], stop_requested:['stop_unconfirmed'], stop_unconfirmed:[]
}
export class Ledger {
 private readonly atomic: AtomicRegistry
 constructor(readonly project: ProjectIdentity) { this.atomic=new AtomicRegistry(project.commonDir,project); this.project={...project} }
 private decode(raw: unknown): Registry | undefined {
  if (raw === undefined) return undefined
  try {
   if (!object(raw) || !exact(raw,['schemaVersion','project','baseline','tasks']) || raw.schemaVersion !== 1 || !object(raw.project) || !exact(raw.project,['primaryDirectory','commonDir']) || raw.project.primaryDirectory !== this.project.primaryDirectory || raw.project.commonDir !== this.project.commonDir || typeof raw.baseline !== 'string' || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(raw.baseline) || !Array.isArray(raw.tasks) || raw.tasks.length < 1 || raw.tasks.length > 2) return fail('REGISTRY_INVALID')
   const keys=new Set<string>(), dirs=new Set<string>()
   for (const t of raw.tasks) {
    if (!object(t) || !exact(t,['taskID','input','ownerSessionID','requestDigest','state','createdAt','updatedAt'],['sessionID','lastErrorCode','interruptResult']) || !id(t.ownerSessionID) || !id(t.taskID) || !states.includes(t.state as TaskState) || (t.sessionID !== undefined && !id(t.sessionID)) || (t.lastErrorCode !== undefined && !['START_UNCONFIRMED','SESSION_MISMATCH','HOST_ERROR'].includes(t.lastErrorCode as string)) || (t.interruptResult !== undefined && !validInterrupt(t.interruptResult)) || typeof t.createdAt !== 'string' || !Number.isFinite(Date.parse(t.createdAt)) || typeof t.updatedAt !== 'string' || !Number.isFinite(Date.parse(t.updatedAt))) return fail('REGISTRY_INVALID')
     const input=normalizeStoredInput(t.input)
    if (JSON.stringify(input)!==JSON.stringify(t.input) || t.taskID !== `ct_${input.key}` || input.baseline !== raw.baseline || t.requestDigest !== requestDigest(input,t.ownerSessionID) || keys.has(input.key) || dirs.has(input.directory) || (['session_bound','prompt_requested','submitted'].includes(t.state as string) && !t.sessionID)) return fail('REGISTRY_INVALID')
    keys.add(input.key); dirs.add(input.directory)
   }
   return raw as unknown as Registry
  } catch { return fail('REGISTRY_INVALID') }
 }
 read(): TaskRecord[] { return clone(this.decode(this.atomic.read())?.tasks ?? []) }
 reserve(ownerSessionID: string, raw: TaskInput, preflight: () => ValidatedWorktree): { task: TaskRecord; replayed: boolean } {
  const input=normalizeStoredInput(raw), digest=requestDigest(input,ownerSessionID)
  return this.atomic.withLock(store => {
   const registry=this.decode(store.read()), existing=registry?.tasks.find(t=>t.input.key===input.key)
    if (existing) { if (existing.requestDigest!==digest) return fail('IDEMPOTENCY_CONFLICT'); return {task:clone(existing),replayed:true} }
    const checkedInput=normalizeTaskInput(input)
    if (JSON.stringify(checkedInput)!==JSON.stringify(input)) return fail('INVALID_INPUT')
   if (registry && registry.baseline!==input.baseline) return fail('BASELINE_MISMATCH')
   if (registry?.tasks.some(t=>t.input.directory===input.directory)) return fail('WRITER_RESERVED')
   if ((registry?.tasks.length ?? 0)>=2) return fail('CAPACITY_RESERVED')
   const checked=preflight()
   if (!checked || checked.primaryDirectory!==this.project.primaryDirectory || checked.commonDir!==this.project.commonDir || checked.directory!==input.directory || checked.baseline!==input.baseline || JSON.stringify(checked.scope)!==JSON.stringify(input.scope)) return fail('PROJECT_MISMATCH')
   const now=new Date().toISOString(), task: TaskRecord={taskID:`ct_${input.key}`,input,ownerSessionID,requestDigest:digest,state:'reserved',createdAt:now,updatedAt:now}
   const next: Registry=registry ?? {schemaVersion:1,project:{...this.project},baseline:input.baseline,tasks:[]}; next.tasks.push(task); store.write(next)
   return {task:clone(task),replayed:false}
  })
 }
 transition(ownerSessionID: string, taskID: string, expected: TaskState, next: TaskState, options: {sessionID?: string; lastErrorCode?: TaskRecord['lastErrorCode']; interruptResult?: TaskRecord['interruptResult']} = {}): TaskRecord {
  if (!id(ownerSessionID) || !id(taskID) || !states.includes(expected) || !states.includes(next) || !object(options) || !exact(options,[],['sessionID','lastErrorCode','interruptResult']) || (options.sessionID !== undefined && !id(options.sessionID)) || (options.lastErrorCode !== undefined && (!['START_UNCONFIRMED','SESSION_MISMATCH','HOST_ERROR'].includes(options.lastErrorCode) || next!=='start_unconfirmed')) || (options.interruptResult !== undefined && (!validInterrupt(options.interruptResult) || expected!=='stop_requested' || next!=='stop_unconfirmed'))) return fail('INVALID_INPUT')
  return this.atomic.withLock(store=>{
   const registry=this.decode(store.read()), task=registry?.tasks.find(t=>t.taskID===taskID && t.ownerSessionID===ownerSessionID)
   if (!task || task.state!==expected || !edges[expected].includes(next) || (options.sessionID !== undefined && (next!=='session_bound' || task.sessionID !== undefined)) || (next==='session_bound' && !options.sessionID)) return fail('HOST_ERROR')
   task.state=next; if (options.sessionID) task.sessionID=options.sessionID; if(options.lastErrorCode) task.lastErrorCode=options.lastErrorCode; if(options.interruptResult) task.interruptResult=options.interruptResult; task.updatedAt=new Date().toISOString(); store.write(registry); return clone(task)
  })
 }
}
