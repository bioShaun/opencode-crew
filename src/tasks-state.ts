import { realpathSync, statSync } from 'node:fs'
import { isAbsolute, normalize } from 'node:path'
import { createHash } from 'node:crypto'
import { AtomicRegistry } from './tasks-ledger'
import { normalizeScope, normalizeScopeLexical, TaskRegistryError, type ProjectIdentity, type ValidatedWorktree } from './tasks-registry'

export interface TaskInput { key: string; directory: string; baseline: string; scope: string[]; goal: string; acceptance: string; check: string }
export type TaskState = 'reserved' | 'session_create_requested' | 'session_bound' | 'prompt_requested' | 'submitted' | 'start_unconfirmed' | 'stop_requested' | 'stop_unconfirmed'
export interface TaskRecord { taskID: string; input: TaskInput; ownerSessionID: string; requestDigest: string; state: TaskState; sessionID?: string; lastErrorCode?: 'START_UNCONFIRMED' | 'SESSION_MISMATCH' | 'HOST_ERROR'; interruptResult?: { interrupted: 'unknown'; result: 'request_completed' | 'not_requested' | 'error'; errorCode?: 'HOST_ERROR' }; createdAt: string; updatedAt: string }
export interface Closeout { operationID: string; paramsDigest: string; closedAt: string; operatorRef: string; authorizationRef: string; disposition: 'preserved' | 'abandoned' | 'integrated'; stopEvidenceRef: string; quiescenceEvidenceRef: string; reviewEvidenceRef: string; evidenceDigest: string; archiveRef: string; archiveDigest: string; integrationCommit?: string }
export interface Period { periodID: string; baseline: string; openedAt: string; openedBy: string; openedParamsDigest: string; sealedAt?: string }
export interface RegistryV1 { schemaVersion: 1; project: ProjectIdentity; baseline: string; tasks: TaskRecord[] }
export interface RegistryV2 { schemaVersion: 2; project: ProjectIdentity; generation: number; migration: { operationID: string; paramsDigest: string; appliedAt: string }; currentPeriodID: string; periods: Period[]; active: { periodID: string; record: TaskRecord }[]; closed: { periodID: string; record: TaskRecord; closeout: Closeout }[] }
export type Registry = RegistryV1 | RegistryV2
export interface LedgerEntry { record: TaskRecord; lifecycle: 'active' | 'closed'; periodID?: string; closeout?: Closeout }
export interface Reservation { task: TaskRecord; replayed: boolean; lifecycle: 'active' | 'closed'; periodID?: string; closeout?: Closeout }
export interface MigrationResult { schemaVersion: 2; generation: 1; currentPeriodID: 'pd_1'; replayed: boolean }
const fail = (code: ConstructorParameters<typeof TaskRegistryError>[0]): never => { throw new TaskRegistryError(code) }
const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x) && (Object.getPrototypeOf(x) === Object.prototype || Object.getPrototypeOf(x) === null)
const exact = (x: Record<string, unknown>, required: string[], optional: string[] = []) => required.every(k => Object.hasOwn(x,k)) && Object.keys(x).every(k => required.includes(k) || optional.includes(k))
const validInterrupt = (x: unknown) => object(x) && exact(x,['interrupted','result'],['errorCode']) && x.interrupted==='unknown' && (x.result==='error' ? x.errorCode==='HOST_ERROR' : (x.result==='request_completed' || x.result==='not_requested') && x.errorCode===undefined)
const id = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length <= 512 && !/[\x00-\x1f\x7f]/.test(x)
const baselineID = (x: unknown): x is string => typeof x === 'string' && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(x)
const periodID = (x: unknown): x is string => typeof x === 'string' && /^pd_[1-9][0-9]{0,5}$/.test(x)
const operationID = (x: unknown): x is string => typeof x === 'string' && /^op_[0-9a-f]{32}$/.test(x)
const sha256 = (x: unknown): x is string => typeof x === 'string' && /^[0-9a-f]{64}$/.test(x)
const timestamp = (x: unknown): x is string => typeof x === 'string' && Number.isFinite(Date.parse(x))
const evidenceRef = (x: unknown): x is string => {
 if (typeof x !== 'string' || !x || Buffer.byteLength(x) > 4096 || isAbsolute(x) || /[\x00-\x1f\x7f]/.test(x)) return false
 return x.split('/').every(part => part !== '' && part !== '.' && part !== '..')
}
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
const sameProject = (raw: unknown, project: ProjectIdentity) => object(raw) && exact(raw,['primaryDirectory','commonDir']) && raw.primaryDirectory === project.primaryDirectory && raw.commonDir === project.commonDir
function decodeRecord(raw: unknown, baseline: string): TaskRecord {
 if (!object(raw) || !exact(raw,['taskID','input','ownerSessionID','requestDigest','state','createdAt','updatedAt'],['sessionID','lastErrorCode','interruptResult']) || !id(raw.ownerSessionID) || !id(raw.taskID) || !states.includes(raw.state as TaskState) || (raw.sessionID !== undefined && !id(raw.sessionID)) || (raw.lastErrorCode !== undefined && !['START_UNCONFIRMED','SESSION_MISMATCH','HOST_ERROR'].includes(raw.lastErrorCode as string)) || (raw.interruptResult !== undefined && !validInterrupt(raw.interruptResult)) || !timestamp(raw.createdAt) || !timestamp(raw.updatedAt)) return fail('REGISTRY_INVALID')
 const input=normalizeStoredInput(raw.input)
 if (JSON.stringify(input)!==JSON.stringify(raw.input) || raw.taskID !== `ct_${input.key}` || input.baseline !== baseline || raw.requestDigest !== requestDigest(input,raw.ownerSessionID) || (['session_bound','prompt_requested','submitted'].includes(raw.state as string) && !raw.sessionID)) return fail('REGISTRY_INVALID')
 return raw as unknown as TaskRecord
}
function decodeV1(raw: Record<string, unknown>, project: ProjectIdentity): RegistryV1 {
 if (!exact(raw,['schemaVersion','project','baseline','tasks']) || raw.schemaVersion !== 1 || !sameProject(raw.project,project) || !baselineID(raw.baseline) || !Array.isArray(raw.tasks) || raw.tasks.length < 1 || raw.tasks.length > 2) return fail('REGISTRY_INVALID')
 const keys=new Set<string>(), dirs=new Set<string>()
 for (const item of raw.tasks) {
  const task=decodeRecord(item,raw.baseline)
  if (keys.has(task.input.key) || dirs.has(task.input.directory)) return fail('REGISTRY_INVALID')
  keys.add(task.input.key); dirs.add(task.input.directory)
 }
 return raw as unknown as RegistryV1
}
function decodeCloseout(raw: unknown, operationIDs: Set<string>): Closeout {
 if (!object(raw) || !exact(raw,['operationID','paramsDigest','closedAt','operatorRef','authorizationRef','disposition','stopEvidenceRef','quiescenceEvidenceRef','reviewEvidenceRef','evidenceDigest','archiveRef','archiveDigest'],['integrationCommit']) || !operationID(raw.operationID) || operationIDs.has(raw.operationID) || !sha256(raw.paramsDigest) || !timestamp(raw.closedAt) || !id(raw.operatorRef) || !id(raw.authorizationRef) || !['preserved','abandoned','integrated'].includes(raw.disposition as string) || !evidenceRef(raw.stopEvidenceRef) || !evidenceRef(raw.quiescenceEvidenceRef) || !evidenceRef(raw.reviewEvidenceRef) || !sha256(raw.evidenceDigest) || !evidenceRef(raw.archiveRef) || !sha256(raw.archiveDigest)) return fail('REGISTRY_INVALID')
 if (raw.disposition === 'integrated' ? !baselineID(raw.integrationCommit) : raw.integrationCommit !== undefined) return fail('REGISTRY_INVALID')
 operationIDs.add(raw.operationID)
 return raw as unknown as Closeout
}
function decodeV2(raw: Record<string, unknown>, project: ProjectIdentity): RegistryV2 {
 if (!exact(raw,['schemaVersion','project','generation','migration','currentPeriodID','periods','active','closed']) || raw.schemaVersion !== 2 || !sameProject(raw.project,project) || !Number.isSafeInteger(raw.generation) || (raw.generation as number) < 1 || !periodID(raw.currentPeriodID) || !Array.isArray(raw.periods) || raw.periods.length < 1 || !Array.isArray(raw.active) || raw.active.length > 2 || !Array.isArray(raw.closed)) return fail('REGISTRY_INVALID')
 const migration=raw.migration
 if (!object(migration) || !exact(migration,['operationID','paramsDigest','appliedAt']) || !operationID(migration.operationID) || !sha256(migration.paramsDigest) || !timestamp(migration.appliedAt)) return fail('REGISTRY_INVALID')
 const operationIDs=new Set<string>([migration.operationID]), baselines=new Map<string,string>()
 for (let index=0; index<raw.periods.length; index++) {
  const period=raw.periods[index]
  if (!object(period) || !exact(period,['periodID','baseline','openedAt','openedBy','openedParamsDigest'],['sealedAt']) || period.periodID !== `pd_${index+1}` || !baselineID(period.baseline) || !timestamp(period.openedAt) || !operationID(period.openedBy) || !sha256(period.openedParamsDigest)) return fail('REGISTRY_INVALID')
  if (index === 0) { if (period.openedBy !== migration.operationID || period.openedParamsDigest !== migration.paramsDigest) return fail('REGISTRY_INVALID') }
  else { if (operationIDs.has(period.openedBy)) return fail('REGISTRY_INVALID'); operationIDs.add(period.openedBy) }
  if (period.periodID === raw.currentPeriodID ? period.sealedAt !== undefined : period.sealedAt === undefined || !timestamp(period.sealedAt)) return fail('REGISTRY_INVALID')
  baselines.set(period.periodID,period.baseline)
 }
 const currentBaseline=baselines.get(raw.currentPeriodID)
 if (currentBaseline === undefined) return fail('REGISTRY_INVALID')
 const keys=new Set<string>(), ids=new Set<string>(), dirs=new Set<string>()
 const register=(task: TaskRecord) => { if (keys.has(task.input.key) || ids.has(task.taskID) || dirs.has(task.input.directory)) return fail('REGISTRY_INVALID'); keys.add(task.input.key); ids.add(task.taskID); dirs.add(task.input.directory) }
 for (const item of raw.active) {
  if (!object(item) || !exact(item,['periodID','record']) || item.periodID !== raw.currentPeriodID) return fail('REGISTRY_INVALID')
  register(decodeRecord(item.record,currentBaseline))
 }
 for (const item of raw.closed) {
  if (!object(item) || !exact(item,['periodID','record','closeout']) || typeof item.periodID !== 'string' || !baselines.has(item.periodID)) return fail('REGISTRY_INVALID')
  register(decodeRecord(item.record,baselines.get(item.periodID)!))
  decodeCloseout(item.closeout,operationIDs)
 }
 return raw as unknown as RegistryV2
}
const allRecords = (registry: Registry): TaskRecord[] => registry.schemaVersion === 1 ? registry.tasks : [...registry.active.map(item => item.record), ...registry.closed.map(item => item.record)]
const toReservation = (entry: LedgerEntry, replayed: boolean): Reservation => ({ task: entry.record, replayed, lifecycle: entry.lifecycle, ...(entry.periodID ? { periodID: entry.periodID } : {}), ...(entry.closeout ? { closeout: entry.closeout } : {}) })
export class Ledger {
 private readonly atomic: AtomicRegistry
 constructor(readonly project: ProjectIdentity) { this.atomic=new AtomicRegistry(project.commonDir,project); this.project={...project} }
 private decode(raw: unknown): Registry | undefined {
  try {
   if (raw === undefined) return undefined
   if (!object(raw)) return fail('REGISTRY_INVALID')
   if (raw.schemaVersion === 1) return decodeV1(raw,this.project)
   if (raw.schemaVersion === 2) return decodeV2(raw,this.project)
   return fail('REGISTRY_INVALID')
  } catch { return fail('REGISTRY_INVALID') }
 }
 /** Read-only snapshot; callers must not treat the lock-free read as stable. */
 load(): { registry: Registry | undefined; bytes: Buffer | undefined } {
  const bytes=this.atomic.readBytes()
  if (bytes===undefined) return { registry: undefined, bytes: undefined }
  let raw: unknown
  try { raw=JSON.parse(bytes.toString('utf8')) } catch { return fail('REGISTRY_INVALID') }
  const registry=this.decode(raw)
  if (!registry) return fail('REGISTRY_INVALID')
  return { registry, bytes }
 }
 /** Run a synchronous maintenance mutation under the registry lock with the exact bytes being replaced. */
 transaction<T>(fn: (tx: { registry: Registry; bytes: Buffer; write: (next: Registry) => void }) => T): T {
  return this.atomic.withLock(store => {
   const bytes=this.atomic.readBytes()
   if (bytes===undefined) return fail('REGISTRY_INVALID')
   let raw: unknown
   try { raw=JSON.parse(bytes.toString('utf8')) } catch { return fail('REGISTRY_INVALID') }
   const registry=this.decode(raw)
   if (!registry) return fail('REGISTRY_INVALID')
   return fn({ registry, bytes, write: next => store.write(next) })
  })
 }
 entries(): LedgerEntry[] {
  const registry=this.decode(this.atomic.read())
  if (!registry) return []
  if (registry.schemaVersion === 1) return registry.tasks.map(record => ({ record: clone(record), lifecycle: 'active' }))
  return [
   ...registry.active.map(item => ({ record: clone(item.record), lifecycle: 'active' as const, periodID: item.periodID })),
   ...registry.closed.map(item => ({ record: clone(item.record), lifecycle: 'closed' as const, periodID: item.periodID, closeout: clone(item.closeout) })),
  ]
 }
 read(): TaskRecord[] { return this.entries().map(entry => entry.record) }
 active(ownerSessionID?: string): LedgerEntry[] { return this.entries().filter(entry => entry.lifecycle === 'active' && (ownerSessionID === undefined || entry.record.ownerSessionID === ownerSessionID)) }
 find(ownerSessionID: string, taskID: string): LedgerEntry | undefined { return this.entries().find(entry => entry.record.ownerSessionID === ownerSessionID && entry.record.taskID === taskID) }
 findByKey(key: string): LedgerEntry | undefined { return this.entries().find(entry => entry.record.input.key === key) }
 private entryFrom(registry: Registry, record: TaskRecord): LedgerEntry {
  if (registry.schemaVersion === 1) return { record: clone(record), lifecycle: 'active' }
  const active=registry.active.find(item => item.record.taskID === record.taskID)
  if (active) return { record: clone(record), lifecycle: 'active', periodID: active.periodID }
  const closed=registry.closed.find(item => item.record.taskID === record.taskID)!
  return { record: clone(record), lifecycle: 'closed', periodID: closed.periodID, closeout: clone(closed.closeout) }
 }
 reserve(ownerSessionID: string, raw: TaskInput, preflight: () => ValidatedWorktree): Reservation {
  const input=normalizeStoredInput(raw), digest=requestDigest(input,ownerSessionID)
  return this.atomic.withLock(store => {
   const registry=this.decode(store.read()), records=registry ? allRecords(registry) : [], existing=records.find(task => task.input.key === input.key)
   if (existing) { if (existing.requestDigest !== digest) return fail('IDEMPOTENCY_CONFLICT'); return toReservation(this.entryFrom(registry!,existing),true) }
   const checkedInput=normalizeTaskInput(input)
   if (JSON.stringify(checkedInput)!==JSON.stringify(input)) return fail('INVALID_INPUT')
   const baseline=registry ? (registry.schemaVersion === 1 ? registry.baseline : registry.periods.find(period => period.periodID === registry.currentPeriodID)!.baseline) : undefined
   if (baseline !== undefined && baseline !== input.baseline) throw new TaskRegistryError('BASELINE_MISMATCH', { baseline: input.baseline, ledgerBaseline: baseline, reason: 'ledger_baseline' })
   if (records.some(task => task.input.directory === input.directory)) return fail('WRITER_RESERVED')
   const activeCount=registry === undefined ? 0 : registry.schemaVersion === 1 ? registry.tasks.length : registry.active.length
   if (activeCount >= 2) return fail('CAPACITY_RESERVED')
   const checked=preflight()
   if (!checked || checked.primaryDirectory!==this.project.primaryDirectory || checked.commonDir!==this.project.commonDir || checked.directory!==input.directory || checked.baseline!==input.baseline || JSON.stringify(checked.scope)!==JSON.stringify(input.scope)) return fail('PROJECT_MISMATCH')
   const now=new Date().toISOString(), task: TaskRecord={taskID:`ct_${input.key}`,input,ownerSessionID,requestDigest:digest,state:'reserved',createdAt:now,updatedAt:now}
   if (registry === undefined) { store.write({schemaVersion:1,project:{...this.project},baseline:input.baseline,tasks:[task]} as RegistryV1); return { task: clone(task), replayed: false, lifecycle: 'active' } }
   if (registry.schemaVersion === 1) { registry.tasks.push(task); store.write(registry); return { task: clone(task), replayed: false, lifecycle: 'active' } }
   registry.active.push({periodID:registry.currentPeriodID,record:task}); registry.generation++; store.write(registry)
   return { task: clone(task), replayed: false, lifecycle: 'active', periodID: registry.currentPeriodID }
  })
 }
 transition(ownerSessionID: string, taskID: string, expected: TaskState, next: TaskState, options: {sessionID?: string; lastErrorCode?: TaskRecord['lastErrorCode']; interruptResult?: TaskRecord['interruptResult']} = {}): TaskRecord {
  if (!id(ownerSessionID) || !id(taskID) || !states.includes(expected) || !states.includes(next) || !object(options) || !exact(options,[],['sessionID','lastErrorCode','interruptResult']) || (options.sessionID !== undefined && !id(options.sessionID)) || (options.lastErrorCode !== undefined && (!['START_UNCONFIRMED','SESSION_MISMATCH','HOST_ERROR'].includes(options.lastErrorCode) || next!=='start_unconfirmed')) || (options.interruptResult !== undefined && (!validInterrupt(options.interruptResult) || expected!=='stop_requested' || next!=='stop_unconfirmed'))) return fail('INVALID_INPUT')
  return this.atomic.withLock(store=>{
   const registry=this.decode(store.read())
   if (!registry) return fail('HOST_ERROR')
   const task=registry.schemaVersion === 1
    ? registry.tasks.find(item=>item.taskID===taskID && item.ownerSessionID===ownerSessionID)
    : registry.active.find(item=>item.record.taskID===taskID && item.record.ownerSessionID===ownerSessionID)?.record
   if (!task || task.state!==expected || !edges[expected].includes(next) || (options.sessionID !== undefined && (next!=='session_bound' || task.sessionID !== undefined)) || (next==='session_bound' && !options.sessionID)) return fail('HOST_ERROR')
   task.state=next; if (options.sessionID) task.sessionID=options.sessionID; if(options.lastErrorCode) task.lastErrorCode=options.lastErrorCode; if(options.interruptResult) task.interruptResult=options.interruptResult; task.updatedAt=new Date().toISOString()
   if (registry.schemaVersion === 2) registry.generation++
   store.write(registry); return clone(task)
  })
 }
 migrate(operation: unknown, paramsDigest: unknown): MigrationResult {
  if (!operationID(operation) || !sha256(paramsDigest)) return fail('INVALID_INPUT')
  return this.atomic.withLock(store=>{
   const registry=this.decode(store.read())
   if (!registry) return fail('REGISTRY_INVALID')
   if (registry.schemaVersion === 2) {
    if (registry.migration.operationID === operation && registry.migration.paramsDigest === paramsDigest) return {schemaVersion:2,generation:1,currentPeriodID:'pd_1',replayed:true}
    return fail('OPERATION_CONFLICT')
   }
   const appliedAt=new Date().toISOString()
   const next: RegistryV2={schemaVersion:2,project:{...registry.project},generation:1,migration:{operationID:operation,paramsDigest,appliedAt},currentPeriodID:'pd_1',periods:[{periodID:'pd_1',baseline:registry.baseline,openedAt:appliedAt,openedBy:operation,openedParamsDigest:paramsDigest}],active:registry.tasks.map(record=>({periodID:'pd_1',record})),closed:[]}
   store.write(next)
   return {schemaVersion:2,generation:1,currentPeriodID:'pd_1',replayed:false}
  })
 }
}
