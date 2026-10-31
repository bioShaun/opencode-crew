import { closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { inspectProject, TaskRegistryError, type ProjectIdentity } from './tasks-registry'
import { Ledger, type Closeout, type Registry, type RegistryV1, type RegistryV2, type TaskRecord, type TaskState } from './tasks-state'

type Operation = 'migrate' | 'close' | 'open-period'
type Disposition = Closeout['disposition']
const operations: Operation[] = ['migrate', 'close', 'open-period']
const dispositions: Disposition[] = ['preserved', 'abandoned', 'integrated']
const states: TaskState[] = ['reserved', 'session_create_requested', 'session_bound', 'prompt_requested', 'submitted', 'start_unconfirmed', 'stop_requested', 'stop_unconfirmed']
const kinds = ['bundle', 'listing', 'drain', 'external-writer', 'quiescence', 'resolution'] as const
const MAX_EVIDENCE_FILES = 32
const MAX_EVIDENCE_FILE_BYTES = 2 * 1024 * 1024
const MAX_EVIDENCE_TOTAL_BYTES = 16 * 1024 * 1024
const EVIDENCE_TIMEOUT_MS = 10000
const evidence = (): never => { throw new TaskRegistryError('MAINTENANCE_EVIDENCE_INSUFFICIENT') }
const tooLarge = (): never => { throw new TaskRegistryError('MAINTENANCE_EVIDENCE_TOO_LARGE') }
const stale = (): never => { throw new TaskRegistryError('MAINTENANCE_PLAN_STALE') }
const conflict = (): never => { throw new TaskRegistryError('OPERATION_CONFLICT') }
const invalid = (): never => { throw new TaskRegistryError('INVALID_INPUT') }
const object = (x: unknown): x is Record<string, any> => !!x && typeof x === 'object' && !Array.isArray(x) && (Object.getPrototypeOf(x) === Object.prototype || Object.getPrototypeOf(x) === null)
const exact = (x: Record<string, unknown>, required: string[], optional: string[] = []) => required.every(k => Object.hasOwn(x, k)) && Object.keys(x).every(k => required.includes(k) || optional.includes(k))
const id = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length <= 512 && !/[\x00-\x1f\x7f]/.test(x)
const taskID = (x: unknown): x is string => typeof x === 'string' && /^ct_[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(x)
const operationID = (x: unknown): x is string => typeof x === 'string' && /^op_[0-9a-f]{32}$/.test(x)
const periodID = (x: unknown): x is string => typeof x === 'string' && /^pd_[1-9][0-9]{0,5}$/.test(x)
const sha256 = (x: unknown): x is string => typeof x === 'string' && /^[0-9a-f]{64}$/.test(x)
const baselineID = (x: unknown): x is string => typeof x === 'string' && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(x)
const timestamp = (x: unknown): x is string => typeof x === 'string' && Number.isFinite(Date.parse(x))
const evidenceRef = (x: unknown): x is string => {
  if (typeof x !== 'string' || !x || Buffer.byteLength(x) > 4096 || isAbsolute(x) || /[\x00-\x1f\x7f]/.test(x)) return false
  return x.split('/').every(part => part !== '' && part !== '.' && part !== '..')
}
const validInterrupt = (x: unknown) => object(x) && exact(x, ['interrupted', 'result'], ['errorCode']) && x.interrupted === 'unknown' && (x.result === 'error' ? x.errorCode === 'HOST_ERROR' : (x.result === 'request_completed' || x.result === 'not_requested') && x.errorCode === undefined)
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x))
const canonical = (x: unknown): string => {
  if (Array.isArray(x)) return '[' + x.map(canonical).join(',') + ']'
  if (object(x)) return '{' + Object.keys(x).sort().map(key => JSON.stringify(key) + ':' + canonical(x[key])).join(',') + '}'
  return JSON.stringify(x)
}
const digest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex')
const bytesDigest = (value: Buffer) => createHash('sha256').update(value).digest('hex')
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b)
const generationOf = (registry: Registry) => registry.schemaVersion === 1 ? 0 : registry.generation
const activeIDs = (registry: Registry) => registry.schemaVersion === 1 ? registry.tasks.map(item => item.taskID) : registry.active.map(item => item.record.taskID)
const common = ['v', 'operation', 'operationID', 'operatorRef', 'authorizationRef', 'project']

function validateRequest(raw: unknown): Record<string, any> {
  if (!object(raw) || raw.v !== 1 || !operations.includes(raw.operation)) invalid()
  const operation = raw.operation as Operation
  if (operation === 'migrate' ? !exact(raw, common) : operation === 'close' ? !exact(raw, [...common, 'taskID', 'disposition', 'evidence'], ['integrationCommit']) : !exact(raw, [...common, 'baseline'])) invalid()
  if (!operationID(raw.operationID)) invalid()
  if (!id(raw.operatorRef) || !id(raw.authorizationRef)) throw new TaskRegistryError('MAINTENANCE_AUTHORIZATION_MISMATCH')
  if (!object(raw.project) || !exact(raw.project, ['primaryDirectory', 'commonDir']) || typeof raw.project.primaryDirectory !== 'string' || typeof raw.project.commonDir !== 'string' || !isAbsolute(raw.project.primaryDirectory) || !isAbsolute(raw.project.commonDir)) invalid()
  if (operation === 'close') {
    if (!taskID(raw.taskID) || !dispositions.includes(raw.disposition)) invalid()
    if (!evidenceRef(raw.evidence)) evidence()
    if (raw.disposition === 'integrated' && raw.integrationCommit === undefined) evidence()
    if (raw.integrationCommit !== undefined && (raw.disposition !== 'integrated' || !baselineID(raw.integrationCommit))) invalid()
  }
  if (operation === 'open-period' && !baselineID(raw.baseline)) throw new TaskRegistryError('BASELINE_MISMATCH')
  return raw
}

function identity(request: Record<string, any>): { project: ProjectIdentity; ledger: Ledger } {
  let project: ProjectIdentity
  try { project = inspectProject(request.project.primaryDirectory) } catch { throw new TaskRegistryError('PROJECT_MISMATCH') }
  if (project.primaryDirectory !== request.project.primaryDirectory || project.commonDir !== request.project.commonDir) throw new TaskRegistryError('PROJECT_MISMATCH')
  return { project, ledger: new Ledger(project) }
}

interface Credential { type: Operation; operationID: string; paramsDigest: string; result: Record<string, unknown> }
function credentials(registry: RegistryV2): Credential[] {
  const list: Credential[] = [{ type: 'migrate', operationID: registry.migration.operationID, paramsDigest: registry.migration.paramsDigest, result: { schemaVersion: 2, generation: 1, currentPeriodID: 'pd_1' } }]
  for (const period of registry.periods.slice(1)) list.push({ type: 'open-period', operationID: period.openedBy, paramsDigest: period.openedParamsDigest, result: { periodID: period.periodID, baseline: period.baseline, openedAt: period.openedAt } })
  for (const item of registry.closed) list.push({ type: 'close', operationID: item.closeout.operationID, paramsDigest: item.closeout.paramsDigest, result: { taskID: item.record.taskID, periodID: item.periodID, closedAt: item.closeout.closedAt, disposition: item.closeout.disposition } })
  return list
}
function replayCredential(registry: Registry, request: Record<string, any>, paramsDigest: string): Credential | undefined {
  if (registry.schemaVersion !== 2) return undefined
  const found = credentials(registry).find(item => item.operationID === request.operationID)
  if (found && (found.type !== request.operation || found.paramsDigest !== paramsDigest)) conflict()
  return found
}

interface Budget { start: number; total: number; cache: Map<string, { bytes: Buffer; digest: string }> }
const newBudget = (): Budget => ({ start: Date.now(), total: 0, cache: new Map() })
function readEvidence(project: ProjectIdentity, ref: unknown, budget: Budget): { bytes: Buffer; digest: string } {
  if (!evidenceRef(ref)) evidence()
  const cached = budget.cache.get(ref)
  if (cached) return cached
  if (budget.cache.size >= MAX_EVIDENCE_FILES) tooLarge()
  if (Date.now() - budget.start > EVIDENCE_TIMEOUT_MS) tooLarge()
  const base = join(project.commonDir, 'opencode-crew-stage1')
  const parts = ref.split('/')
  if (ref === 'registry.json' || ref === '.lock' || parts[0] === 'backups' || parts[0] === 'archives') evidence()
  let path = base, target: string | undefined
  try {
    const root = lstatSync(base)
    if (!root.isDirectory() || root.isSymbolicLink()) evidence()
    for (let index = 0; index < parts.length; index++) {
      path = join(path, parts[index])
      const info = lstatSync(path)
      if (info.isSymbolicLink()) evidence()
      if (index < parts.length - 1) { if (!info.isDirectory()) evidence() }
      else { if (!info.isFile()) evidence(); target = path }
    }
    if (!target || realpathSync(target) !== target) evidence()
    if (lstatSync(target).size > MAX_EVIDENCE_FILE_BYTES || budget.total + lstatSync(target).size > MAX_EVIDENCE_TOTAL_BYTES) tooLarge()
    const result = readRegular(target, budget)
    budget.total += result.bytes.length
    if (budget.total > MAX_EVIDENCE_TOTAL_BYTES || Date.now() - budget.start > EVIDENCE_TIMEOUT_MS) tooLarge()
    budget.cache.set(ref, result)
    return result
  } catch (error) {
    if (error instanceof TaskRegistryError) throw error
    evidence()
  }
}
function readRegular(path: string, budget: Budget): { bytes: Buffer; digest: string } {
  let fd: number | undefined
  try {
    const before = lstatSync(path)
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    const opened = fstatSync(fd)
    if (!opened.isFile() || opened.size > MAX_EVIDENCE_FILE_BYTES) tooLarge()
    const bytes = readFileSync(fd)
    const after = fstatSync(fd), last = lstatSync(path)
    if (before.ino !== opened.ino || before.dev !== opened.dev || before.size !== opened.size || before.mtimeMs !== opened.mtimeMs ||
      after.ino !== opened.ino || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs ||
      last.ino !== opened.ino || last.dev !== opened.dev || last.size !== opened.size || last.mtimeMs !== opened.mtimeMs ||
      bytes.length !== opened.size || Date.now() - budget.start > EVIDENCE_TIMEOUT_MS) evidence()
    return { bytes, digest: bytesDigest(bytes) }
  } finally { if (fd !== undefined) closeSync(fd) }
}

function parseJSON(bytes: Buffer): any {
  try { return JSON.parse(bytes.toString('utf8')) } catch { evidence() }
}

interface VerifiedClose { evidence: { ref: string; kind: typeof kinds[number]; digest: string }[]; bundleRef: string; listingRef: string; evidenceDigest: string; disposition: Disposition }
function verifyClose(request: Record<string, any>, project: ProjectIdentity, item: { periodID: string; record: TaskRecord }, budget = newBudget()): VerifiedClose {
  const bundleRef = request.evidence as string
  const root = readEvidence(project, bundleRef, budget), bundle = parseBundle(parseJSON(root.bytes))
  if (bundle.operatorRef !== request.operatorRef || bundle.authorizationRef !== request.authorizationRef) throw new TaskRegistryError('MAINTENANCE_AUTHORIZATION_MISMATCH')
  if (bundle.taskID !== item.record.taskID || !bundle.taskScope.includes(item.record.taskID)) evidence()
  if (bundle.entrypoints.retryDisabled !== true || bundle.entrypoints.closed.length === 0) throw new TaskRegistryError('MAINTENANCE_NOT_DRAINED')
  const times = [bundle.entrypoints.closedAt, bundle.drain.completedAt, bundle.externalWriters.verifiedAt, bundle.quiescence.verifiedAt, bundle.recordedAt].map((value: string) => Date.parse(value))
  if (!(times[0] <= times[1] && times[1] <= times[2] && times[1] <= times[3] && times[2] <= times[4] && times[3] <= times[4])) evidence()
  if (bundle.stop.stopState !== item.record.state) evidence()
  if (item.record.sessionID ? bundle.stop.sessionID !== item.record.sessionID : bundle.stop.sessionID !== undefined) evidence()
  if (item.record.interruptResult ? !same(bundle.stop.interruptResult, item.record.interruptResult) : bundle.stop.interruptResult !== undefined) evidence()
  if (Date.parse(item.record.updatedAt) > Date.parse(bundle.recordedAt)) throw new TaskRegistryError('MAINTENANCE_NOT_DRAINED')
  const listingRead = readEvidence(project, bundle.review.listingRef, budget)
  if (listingRead.digest !== bundle.review.listingDigest) evidence()
  const listing = parseListing(parseJSON(listingRead.bytes))
  if (listing.taskID !== item.record.taskID || listing.baseline !== item.record.input.baseline) evidence()
  if (listing.observedFrom !== bundle.review.observedFrom || listing.observedTo !== bundle.review.observedTo || listing.completeness !== bundle.review.completeness) evidence()
  if (listing.periodID !== undefined && listing.periodID !== item.periodID) evidence()
  if (listing.completeness !== 'complete') {
    const problems = listing.failures.reduce((total: number, failure: any) => total + failure.count, 0)
    if (bundle.review.resolutions.length === 0 || bundle.review.resolutions.length < problems || !timestamp(bundle.review.resolvedAt) || Date.parse(bundle.review.resolvedAt) < Date.parse(listing.observedTo)) evidence()
  }
  const closure: VerifiedClose['evidence'] = [{ ref: bundleRef, kind: 'bundle', digest: root.digest }, { ref: bundle.review.listingRef, kind: 'listing', digest: listingRead.digest }]
  for (const ref of bundle.drain.inFlightEvidenceRefs) closure.push({ ref, kind: 'drain', digest: readEvidence(project, ref, budget).digest })
  for (const ref of bundle.externalWriters.evidenceRefs) closure.push({ ref, kind: 'external-writer', digest: readEvidence(project, ref, budget).digest })
  for (const ref of bundle.quiescence.evidenceRefs) closure.push({ ref, kind: 'quiescence', digest: readEvidence(project, ref, budget).digest })
  for (const resolution of bundle.review.resolutions) closure.push({ ref: resolution.ref, kind: 'resolution', digest: readEvidence(project, resolution.ref, budget).digest })
  return { evidence: closure, bundleRef, listingRef: bundle.review.listingRef, evidenceDigest: root.digest, disposition: request.disposition }
}

function parseBundle(raw: any): any {
  if (!object(raw) || !exact(raw, ['v', 'taskID', 'operatorRef', 'authorizationRef', 'host', 'taskScope', 'recordedAt', 'entrypoints', 'stop', 'drain', 'externalWriters', 'quiescence', 'review'])) evidence()
  if (raw.v !== 1 || !taskID(raw.taskID) || !id(raw.operatorRef) || !id(raw.authorizationRef) || !id(raw.host) || !Array.isArray(raw.taskScope) || !raw.taskScope.every(taskID) || !timestamp(raw.recordedAt)) evidence()
  if (!object(raw.entrypoints) || !exact(raw.entrypoints, ['closedAt', 'closed', 'retryDisabled']) || !timestamp(raw.entrypoints.closedAt) || !Array.isArray(raw.entrypoints.closed) || !raw.entrypoints.closed.every(id) || typeof raw.entrypoints.retryDisabled !== 'boolean') evidence()
  if (!object(raw.stop) || !exact(raw.stop, ['stopState', 'observedAt'], ['sessionID', 'interruptResult']) || !states.includes(raw.stop.stopState) || !timestamp(raw.stop.observedAt) || (raw.stop.sessionID !== undefined && !id(raw.stop.sessionID)) || (raw.stop.interruptResult !== undefined && !validInterrupt(raw.stop.interruptResult))) evidence()
  if (!object(raw.drain) || !exact(raw.drain, ['completedAt', 'inFlightEvidenceRefs']) || !timestamp(raw.drain.completedAt) || !Array.isArray(raw.drain.inFlightEvidenceRefs) || !raw.drain.inFlightEvidenceRefs.every(evidenceRef)) evidence()
  if (!object(raw.externalWriters) || !exact(raw.externalWriters, ['verifiedAt', 'method', 'evidenceRefs']) || !timestamp(raw.externalWriters.verifiedAt) || !id(raw.externalWriters.method) || !Array.isArray(raw.externalWriters.evidenceRefs) || raw.externalWriters.evidenceRefs.length === 0 || !raw.externalWriters.evidenceRefs.every(evidenceRef)) evidence()
  if (!object(raw.quiescence) || !exact(raw.quiescence, ['verifiedAt', 'evidenceRefs']) || !timestamp(raw.quiescence.verifiedAt) || !Array.isArray(raw.quiescence.evidenceRefs) || raw.quiescence.evidenceRefs.length === 0 || !raw.quiescence.evidenceRefs.every(evidenceRef)) evidence()
  if (!object(raw.review) || !exact(raw.review, ['listingRef', 'listingDigest', 'completeness', 'observedFrom', 'observedTo', 'resolutions'], ['resolvedAt']) || !evidenceRef(raw.review.listingRef) || !sha256(raw.review.listingDigest) || !['complete', 'incomplete', 'changed'].includes(raw.review.completeness) || !timestamp(raw.review.observedFrom) || !timestamp(raw.review.observedTo) || Date.parse(raw.review.observedFrom) > Date.parse(raw.review.observedTo) || (raw.review.resolvedAt !== undefined && !timestamp(raw.review.resolvedAt)) || !Array.isArray(raw.review.resolutions) || !raw.review.resolutions.every((item: any) => object(item) && exact(item, ['ref', 'resolvedAt', 'approvedBy']) && evidenceRef(item.ref) && timestamp(item.resolvedAt) && id(item.approvedBy))) evidence()
  return raw
}
function parseListing(raw: any): any {
  if (!object(raw) || raw.v !== 1 || typeof raw.taskID !== 'string' || typeof raw.baseline !== 'string' || !timestamp(raw.observedFrom) || !timestamp(raw.observedTo) || !['complete', 'incomplete', 'changed'].includes(raw.completeness) || (raw.periodID !== undefined && typeof raw.periodID !== 'string') || !Array.isArray(raw.entries) || !Array.isArray(raw.failures)) evidence()
  if (!raw.failures.every((failure: any) => object(failure) && typeof failure.code === 'string' && Number.isSafeInteger(failure.count) && failure.count >= 0)) evidence()
  return raw
}

function git(cwd: string, args: string[], code: ConstructorParameters<typeof TaskRegistryError>[0]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  env.GIT_OPTIONAL_LOCKS = '0'
  const result = spawnSync('git', ['-c', 'core.fsmonitor=false', ...args], { cwd, env, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 })
  if (result.error || result.status !== 0 || result.signal) throw new TaskRegistryError(code)
  return result.stdout
}
function verifyBaseline(project: ProjectIdentity, baseline: unknown): void {
  if (!baselineID(baseline)) throw new TaskRegistryError('BASELINE_MISMATCH')
  const format = git(project.primaryDirectory, ['rev-parse', '--show-object-format'], 'PROJECT_MISMATCH').trim()
  const length = format === 'sha1' ? 40 : format === 'sha256' ? 64 : 0
  if (!length || !new RegExp(`^[0-9a-f]{${length}}$`).test(baseline)) throw new TaskRegistryError('BASELINE_MISMATCH')
  const commit = git(project.primaryDirectory, ['rev-parse', '--verify', `${baseline}^{commit}`], 'BASELINE_MISMATCH').trim()
  if (commit !== baseline || git(project.primaryDirectory, ['rev-parse', 'HEAD'], 'BASELINE_MISMATCH').trim() !== baseline) throw new TaskRegistryError('BASELINE_MISMATCH')
  if (git(project.primaryDirectory, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], 'HOST_ERROR') !== '') throw new TaskRegistryError('DIRTY_PRIMARY')
}

function closeChange(request: Record<string, any>, item: { periodID: string; record: TaskRecord }, listingRef: string) {
  return { taskID: item.record.taskID, ownerSessionID: item.record.ownerSessionID, lifecycle: 'active' as const, from: { periodID: item.periodID, state: item.record.state }, to: { periodID: item.periodID, state: item.record.state, closeout: { disposition: request.disposition } }, evidenceRefs: [request.evidence, listingRef] }
}
function replayPlan(request: Record<string, any>, registry: Registry, bytes: Buffer) {
  return { request, paramsDigest: digest(request), generation: generationOf(registry), registryDigest: bytesDigest(bytes), changes: [], expectedActive: activeIDs(registry), evidence: [], warnings: ['该操作已提交；apply 将返回原结果，不会重放副作用。'] }
}
function buildPlan(request: Record<string, any>, registry: Registry, bytes: Buffer, project: ProjectIdentity) {
  if (registry.schemaVersion === 1) {
    if (request.operation !== 'migrate') throw new TaskRegistryError('REGISTRY_INVALID')
    return { request, paramsDigest: digest(request), generation: 0, registryDigest: bytesDigest(bytes), changes: [], expectedActive: registry.tasks.map(item => item.taskID), evidence: [], warnings: ['迁移只把现有记录原样写入 v2，不释放名额。'] }
  }
  if (request.operation === 'migrate') conflict()
  if (request.operation === 'close') {
    const item = registry.active.find(entry => entry.record.taskID === request.taskID)
    if (!item) conflict()
    const verified = verifyClose(request, project, item)
    const change = closeChange(request, item, verified.listingRef)
    return { request, paramsDigest: digest(request), generation: registry.generation, registryDigest: bytesDigest(bytes), changes: [change], expectedActive: registry.active.filter(entry => entry.record.taskID !== item.record.taskID).map(entry => entry.record.taskID), evidence: verified.evidence, warnings: ['结案只释放账本名额，不代表进程已停止、成果已保存或 worktree 可清理。'] }
  }
  if (registry.active.length > 0) throw new TaskRegistryError('PERIOD_NOT_EMPTY')
  verifyBaseline(project, request.baseline)
  return { request, paramsDigest: digest(request), generation: registry.generation, registryDigest: bytesDigest(bytes), changes: [], expectedActive: [], evidence: [], warnings: ['新周期只允许 baseline 相同的新目标；旧 period 与记录保持不变。'] }
}
const planOutput = (plan: any) => ({ v: 1, ok: true, plan, planDigest: digest(plan) })

export function planMaintenance(raw: unknown): any {
  const request = validateRequest(raw)
  const { project, ledger } = identity(request)
  const { registry, bytes } = ledger.load()
  if (!registry || !bytes) throw new TaskRegistryError('REGISTRY_INVALID')
  const found = replayCredential(registry, request, digest(request))
  if (found) return planOutput(replayPlan(request, registry, bytes))
  return planOutput(buildPlan(request, registry, bytes, project))
}

function validatePlan(raw: unknown): { plan: any } {
  if (!object(raw) || raw.v !== 1 || raw.ok !== true || !exact(raw, ['v', 'ok', 'plan', 'planDigest']) || !sha256(raw.planDigest)) invalid()
  const plan = raw.plan
  if (!object(plan) || !exact(plan, ['request', 'paramsDigest', 'generation', 'registryDigest', 'changes', 'expectedActive', 'evidence', 'warnings']) || !sha256(plan.paramsDigest) || !sha256(plan.registryDigest) || !Number.isSafeInteger(plan.generation) || plan.generation < 0 || !Array.isArray(plan.changes) || !Array.isArray(plan.expectedActive) || !Array.isArray(plan.evidence) || !Array.isArray(plan.warnings)) invalid()
  const request = validateRequest(plan.request)
  if (!plan.expectedActive.every(taskID) || !plan.warnings.every((item: unknown) => typeof item === 'string')) invalid()
  const point = (value: any) => object(value) && exact(value, ['periodID', 'state'], ['closeout']) && periodID(value.periodID) && states.includes(value.state) && (value.closeout === undefined || (object(value.closeout) && exact(value.closeout, ['disposition']) && dispositions.includes(value.closeout.disposition)))
  for (const change of plan.changes) {
    if (!object(change) || !exact(change, ['taskID', 'ownerSessionID', 'lifecycle', 'from', 'to', 'evidenceRefs']) || !taskID(change.taskID) || !id(change.ownerSessionID) || !['active', 'closed'].includes(change.lifecycle) || !point(change.from) || !point(change.to) || !Array.isArray(change.evidenceRefs) || !change.evidenceRefs.every(evidenceRef)) invalid()
  }
  for (const item of plan.evidence) {
    if (!object(item) || !exact(item, ['ref', 'kind', 'digest']) || !evidenceRef(item.ref) || !kinds.includes(item.kind) || !sha256(item.digest)) invalid()
  }
  if (digest(request) !== plan.paramsDigest || digest(plan) !== raw.planDigest) stale()
  return { plan }
}

function writeBackup(project: ProjectIdentity, generation: number, bytes: Buffer): void {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  writeExclusive(project, 'backups', `registry-${generation}-${stamp}.json`, bytes, 'HOST_ERROR')
}
function writeArchive(project: ProjectIdentity, operation: string, payload: unknown): string {
  const bytes = Buffer.from(JSON.stringify(payload))
  writeExclusive(project, 'archives', `${operation}.json`, bytes, 'ARCHIVE_INVALID')
  return bytesDigest(bytes)
}
function writeExclusive(project: ProjectIdentity, directory: string, name: string, bytes: Buffer, conflictCode: ConstructorParameters<typeof TaskRegistryError>[0]): void {
  const base = join(project.commonDir, 'opencode-crew-stage1'), target = join(base, directory)
  let temp: string | undefined, fd: number | undefined
  try {
    try { mkdirSync(target, { mode: 0o700 }) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
    const info = lstatSync(target)
    if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o777) !== 0o700) throw new TaskRegistryError('HOST_ERROR')
    let exists = false
    try { lstatSync(join(target, name)); exists = true } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    if (exists) throw new TaskRegistryError(conflictCode)
    temp = join(target, `.${name}.${randomBytes(16).toString('hex')}.tmp`)
    fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
    writeFileSync(fd, bytes); fsyncSync(fd); closeSync(fd); fd = undefined
    renameSync(temp, join(target, name)); temp = undefined
    const dirfd = openSync(target, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
    try { fsyncSync(dirfd) } finally { closeSync(dirfd) }
  } catch (error) {
    if (error instanceof TaskRegistryError) throw error
    throw new TaskRegistryError('HOST_ERROR')
  } finally {
    if (fd !== undefined) closeSync(fd)
    if (temp !== undefined) { try { unlinkSync(temp) } catch {} }
  }
}

function applyMigrate(request: Record<string, any>, plan: any, tx: { registry: Registry; bytes: Buffer; write: (next: Registry) => void }, project: ProjectIdentity) {
  const registry = tx.registry as RegistryV1
  if (plan.changes.length !== 0 || plan.evidence.length !== 0 || !same(plan.expectedActive, registry.tasks.map(item => item.taskID))) stale()
  const appliedAt = new Date().toISOString(), paramsDigest = plan.paramsDigest as string
  const next: RegistryV2 = { schemaVersion: 2, project: { ...registry.project }, generation: 1, migration: { operationID: request.operationID, paramsDigest, appliedAt }, currentPeriodID: 'pd_1', periods: [{ periodID: 'pd_1', baseline: registry.baseline, openedAt: appliedAt, openedBy: request.operationID, openedParamsDigest: paramsDigest }], active: registry.tasks.map(record => ({ periodID: 'pd_1', record: clone(record) })), closed: [] }
  writeBackup(project, plan.generation, tx.bytes)
  writeArchive(project, request.operationID, { v: 1, operation: 'migrate', operationID: request.operationID, paramsDigest, appliedAt, generation: 1, currentPeriodID: 'pd_1', taskIDs: registry.tasks.map(item => item.taskID) })
  tx.write(next)
  return { replayed: false, result: { schemaVersion: 2, generation: 1, currentPeriodID: 'pd_1' } }
}
function applyClose(request: Record<string, any>, plan: any, tx: { registry: Registry; bytes: Buffer; write: (next: Registry) => void }, project: ProjectIdentity) {
  const registry = tx.registry as RegistryV2, index = registry.active.findIndex(item => item.record.taskID === request.taskID)
  if (index < 0) conflict()
  const item = registry.active[index], verified = verifyClose(request, project, item)
  if (!same(verified.evidence, plan.evidence)) evidence()
  const change = closeChange(request, item, verified.listingRef)
  const expectedActive = registry.active.filter(entry => entry.record.taskID !== request.taskID).map(entry => entry.record.taskID)
  if (!same(plan.changes, [change]) || !same(plan.expectedActive, expectedActive)) stale()
  writeBackup(project, plan.generation, tx.bytes)
  const closedAt = new Date().toISOString(), paramsDigest = plan.paramsDigest as string
  const archiveRef = `archives/${request.operationID}.json`
  const archive = { v: 1, operation: 'close', operationID: request.operationID, paramsDigest, taskID: item.record.taskID, periodID: item.periodID, ownerSessionID: item.record.ownerSessionID, state: item.record.state, baseline: item.record.input.baseline, directory: item.record.input.directory, closedAt, disposition: request.disposition, operatorRef: request.operatorRef, authorizationRef: request.authorizationRef, evidenceDigest: verified.evidenceDigest, ...(request.integrationCommit ? { integrationCommit: request.integrationCommit } : {}) }
  const archiveDigest = writeArchive(project, request.operationID, archive)
  const closeout: Closeout = { operationID: request.operationID, paramsDigest, closedAt, operatorRef: request.operatorRef, authorizationRef: request.authorizationRef, disposition: request.disposition, stopEvidenceRef: verified.bundleRef, quiescenceEvidenceRef: verified.bundleRef, reviewEvidenceRef: verified.listingRef, evidenceDigest: verified.evidenceDigest, archiveRef, archiveDigest, ...(request.integrationCommit ? { integrationCommit: request.integrationCommit } : {}) }
  registry.active.splice(index, 1); registry.closed.push({ periodID: item.periodID, record: item.record, closeout }); registry.generation++
  tx.write(registry)
  return { replayed: false, result: { taskID: item.record.taskID, periodID: item.periodID, closedAt, disposition: request.disposition } }
}
function applyOpenPeriod(request: Record<string, any>, plan: any, tx: { registry: Registry; bytes: Buffer; write: (next: Registry) => void }, project: ProjectIdentity) {
  const registry = tx.registry as RegistryV2
  if (registry.active.length > 0) throw new TaskRegistryError('PERIOD_NOT_EMPTY')
  verifyBaseline(project, request.baseline)
  if (plan.changes.length !== 0 || plan.expectedActive.length !== 0 || plan.evidence.length !== 0) stale()
  writeBackup(project, plan.generation, tx.bytes)
  const openedAt = new Date().toISOString(), periodID = `pd_${registry.periods.length + 1}`, paramsDigest = plan.paramsDigest as string
  writeArchive(project, request.operationID, { v: 1, operation: 'open-period', operationID: request.operationID, paramsDigest, periodID, baseline: request.baseline, openedAt, operatorRef: request.operatorRef, authorizationRef: request.authorizationRef })
  const current = registry.periods.find(period => period.periodID === registry.currentPeriodID)!
  current.sealedAt = openedAt
  registry.periods.push({ periodID, baseline: request.baseline, openedAt, openedBy: request.operationID, openedParamsDigest: paramsDigest })
  registry.currentPeriodID = periodID; registry.generation++
  tx.write(registry)
  return { replayed: false, result: { periodID, baseline: request.baseline, openedAt } }
}

export function applyMaintenance(raw: unknown): any {
  const { plan } = validatePlan(raw)
  const request = plan.request as Record<string, any>
  const paramsDigest = plan.paramsDigest as string
  const { project, ledger } = identity(request)
  const outcome = ledger.transaction(tx => {
    const found = replayCredential(tx.registry, request, paramsDigest)
    if (found) return { replayed: true, result: found.result }
    if (tx.registry.schemaVersion === 2 && request.operation === 'migrate') conflict()
    if (tx.registry.schemaVersion === 1 && request.operation !== 'migrate') throw new TaskRegistryError('REGISTRY_INVALID')
    if (plan.generation !== generationOf(tx.registry) || plan.registryDigest !== bytesDigest(tx.bytes)) stale()
    if (request.operation === 'migrate') return applyMigrate(request, plan, tx, project)
    if (request.operation === 'close') return applyClose(request, plan, tx, project)
    return applyOpenPeriod(request, plan, tx, project)
  })
  return { v: 1, ok: true, replayed: outcome.replayed, result: outcome.result }
}
