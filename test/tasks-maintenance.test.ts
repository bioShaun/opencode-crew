import { test, expect } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { inspectProject, validateWorktree } from '../src/tasks-registry'
import { Ledger, normalizeTaskInput } from '../src/tasks-state'
import { AtomicRegistry } from '../src/tasks-ledger'
import { reviewTask } from '../src/tasks-review'
import { planMaintenance, applyMaintenance } from '../src/tasks-maintenance'

const work = join(import.meta.dir, '.work/tasks-maintenance')
const tmp = join(work, 'tmp')
mkdirSync(tmp, { recursive: true })
const op = (c: string) => 'op_' + c.repeat(32)
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex')
function code(fn: () => unknown, expected: string) {
  try { fn(); throw new Error('operation unexpectedly succeeded') } catch (e: any) { expect(e.code).toBe(expected) }
}

function setup() {
  const base = realpathSync((() => { const p = join(work, randomUUID()); mkdirSync(p, { recursive: true }); return p })())
  const primary = join(base, 'primary'); mkdirSync(primary)
  const git = (...args: string[]) => {
    const r = spawnSync('git', args, { cwd: primary, encoding: 'utf8', env: { ...process.env, TMPDIR: tmp, GIT_OPTIONAL_LOCKS: '0' } })
    if (r.status !== 0) throw Error('fixture git failed: ' + args.join(' ') + ' ' + r.stderr)
    return r.stdout.trim()
  }
  git('init', '-b', 'main')
  git('config', 'user.email', 'fixture@example.com')
  git('config', 'user.name', 'fixture')
  writeFileSync(join(primary, 'a.txt'), 'alpha\n')
  git('add', 'a.txt')
  git('commit', '-m', 'one')
  const oid = git('rev-parse', 'HEAD')
  const target = join(base, 'target')
  git('worktree', 'add', '--detach', target, oid)
  const project = inspectProject(primary)
  return { base, primary, target, oid, project, ledger: new Ledger(project), mgmt: join(project.commonDir, 'opencode-crew-stage1'), git }
}
type Fixture = ReturnType<typeof setup>

function start(f: Fixture, key = 'one', owner = 'owner') {
  const input = normalizeTaskInput({ key, directory: f.target, baseline: f.oid, scope: ['a.txt'], goal: 'private-goal', acceptance: 'private-acceptance', check: 'private-check' })
  return f.ledger.reserve(owner, input, () => validateWorktree(f.project.primaryDirectory, f.target, f.oid, ['a.txt'])).task
}
function migrated(f: Fixture) { f.ledger.migrate(op('9'), '9'.repeat(64)) }
function stop(f: Fixture, taskID: string, owner = 'owner') {
  f.ledger.transition(owner, taskID, 'reserved', 'stop_requested')
  f.ledger.transition(owner, taskID, 'stop_requested', 'stop_unconfirmed', { interruptResult: { interrupted: 'unknown', result: 'not_requested' } })
}
function record(f: Fixture, taskID = 'ct_one') {
  return new Ledger(f.project).read().find(t => t.taskID === taskID)!
}
function listing(f: Fixture, rec: any, mutate: Record<string, unknown> = {}) {
  const data = { ...reviewTask({ primaryDirectory: f.project.primaryDirectory, directory: rec.input.directory, taskID: rec.taskID, baseline: rec.input.baseline, scope: rec.input.scope }), ...mutate }
  mkdirSync(join(f.mgmt, 'evidence'), { recursive: true, mode: 0o700 })
  const bytes = JSON.stringify(data)
  writeFileSync(join(f.mgmt, 'evidence', 'listing.json'), bytes)
  return { ref: 'evidence/listing.json', digest: sha(bytes), data }
}
function bundle(f: Fixture, rec: any, opts: any = {}) {
  const l = opts.listing ?? listing(f, rec, opts.listingMutate)
  mkdirSync(join(f.mgmt, 'evidence'), { recursive: true, mode: 0o700 })
  for (const name of ['drain.txt', 'external.txt', 'quiescence.txt', 'resolution.txt']) writeFileSync(join(f.mgmt, 'evidence', name), 'evidence-' + name)
  const now = Date.now(), at = (ms: number) => new Date(now + ms).toISOString()
  const resolutions: any[] = opts.resolutions ?? []
  const data = {
    v: 1, taskID: rec.taskID, operatorRef: opts.operatorRef ?? 'operator-1', authorizationRef: opts.authorizationRef ?? 'auth-1',
    host: 'fixture-host', taskScope: [rec.taskID], recordedAt: opts.recordedAt ?? at(4000),
    entrypoints: { closedAt: opts.closedAt ?? at(1000), closed: opts.closed ?? ['crew_task_start', 'crew_task_stop', 'retry'], retryDisabled: opts.retryDisabled ?? true },
    stop: { ...(rec.sessionID ? { sessionID: rec.sessionID } : {}), stopState: opts.stopState ?? rec.state, ...(rec.interruptResult ? { interruptResult: rec.interruptResult } : {}), observedAt: at(1000) },
    drain: { completedAt: at(2000), inFlightEvidenceRefs: opts.inFlight ?? ['evidence/drain.txt'] },
    externalWriters: { verifiedAt: at(3000), method: 'terminal and process ownership', evidenceRefs: opts.external ?? ['evidence/external.txt'] },
    quiescence: { verifiedAt: at(3000), evidenceRefs: opts.quiescence ?? ['evidence/quiescence.txt'] },
    review: {
      listingRef: l.ref, listingDigest: l.digest, completeness: l.data.completeness,
      observedFrom: l.data.observedFrom, observedTo: l.data.observedTo,
      ...(resolutions.length ? { resolvedAt: at(3500) } : {}),
      resolutions: resolutions.map((r: any) => ({ ref: 'evidence/resolution.txt', resolvedAt: at(3500), approvedBy: 'reviewer', ...r })),
    },
  }
  const bytes = JSON.stringify(data)
  writeFileSync(join(f.mgmt, 'evidence', 'bundle.json'), bytes)
  return { ref: 'evidence/bundle.json', data, listing: l }
}
function closeRequest(f: Fixture, rec: any, over: Record<string, unknown> = {}) {
  return { v: 1, operation: 'close', operationID: op('1'), operatorRef: 'operator-1', authorizationRef: 'auth-1', project: { ...f.project }, taskID: rec.taskID, disposition: 'preserved', evidence: 'evidence/bundle.json', ...over }
}
function prepared() {
  const f = setup(), task = start(f)
  migrated(f)
  stop(f, task.taskID)
  const rec = record(f)
  bundle(f, rec)
  return { f, task, rec }
}
function closePlan(f: Fixture, rec: any, over: Record<string, unknown> = {}) {
  return planMaintenance(closeRequest(f, rec, over)) as any
}

test('plan is read-only and binds generation, registry digest, changes, and evidence', () => {
  const { f, rec } = prepared()
  const before = readFileSync(join(f.mgmt, 'registry.json'))
  const reg = JSON.parse(before.toString())
  const out = closePlan(f, rec)
  expect(out.v).toBe(1); expect(out.ok).toBe(true)
  expect(out.plan.request.operation).toBe('close')
  expect(out.plan.paramsDigest).toMatch(/^[0-9a-f]{64}$/)
  expect(out.plan.generation).toBe(reg.generation)
  expect(out.plan.registryDigest).toBe(sha(before))
  expect(out.planDigest).toMatch(/^[0-9a-f]{64}$/)
  expect(out.plan.changes).toEqual([{ taskID: 'ct_one', ownerSessionID: 'owner', lifecycle: 'active', from: { periodID: 'pd_1', state: 'stop_unconfirmed' }, to: { periodID: 'pd_1', state: 'stop_unconfirmed', closeout: { disposition: 'preserved' } }, evidenceRefs: ['evidence/bundle.json', 'evidence/listing.json'] }])
  expect(out.plan.expectedActive).toEqual([])
  expect(out.plan.evidence.map((e: any) => [e.kind, e.ref])).toEqual([
    ['bundle', 'evidence/bundle.json'], ['listing', 'evidence/listing.json'], ['drain', 'evidence/drain.txt'], ['external-writer', 'evidence/external.txt'], ['quiescence', 'evidence/quiescence.txt'],
  ])
  for (const e of out.plan.evidence) expect(e.digest).toMatch(/^[0-9a-f]{64}$/)
  expect(readFileSync(join(f.mgmt, 'registry.json'))).toEqual(before)
  expect(JSON.stringify(out)).not.toContain('private-goal')
  expect(JSON.stringify(out)).not.toContain('private-check')
})

test('close apply moves the record to closed, writes evidence-bound closeout, backup, archive, and +1 generation', () => {
  const { f, rec } = prepared()
  const plan = closePlan(f, rec)
  const oldBytes = readFileSync(join(f.mgmt, 'registry.json'))
  const worktreeFile = join(f.target, 'a.txt'), beforeFile = sha(readFileSync(worktreeFile))
  const out = applyMaintenance(plan) as any
  expect(out.v).toBe(1); expect(out.ok).toBe(true); expect(out.replayed).toBe(false)
  expect(out.result).toMatchObject({ taskID: 'ct_one', periodID: 'pd_1', disposition: 'preserved' })
  expect(Number.isFinite(Date.parse(out.result.closedAt))).toBe(true)
  const reg = JSON.parse(readFileSync(join(f.mgmt, 'registry.json'), 'utf8'))
  expect(reg.generation).toBe(plan.plan.generation + 1)
  expect(reg.active).toEqual([])
  expect(reg.closed).toHaveLength(1)
  expect(reg.closed[0].record.state).toBe('stop_unconfirmed')
  const c = reg.closed[0].closeout
  expect(c.operationID).toBe(op('1')); expect(c.paramsDigest).toBe(plan.plan.paramsDigest)
  expect(c.operatorRef).toBe('operator-1'); expect(c.authorizationRef).toBe('auth-1')
  expect(c.stopEvidenceRef).toBe('evidence/bundle.json'); expect(c.quiescenceEvidenceRef).toBe('evidence/bundle.json')
  expect(c.reviewEvidenceRef).toBe('evidence/listing.json')
  expect(c.evidenceDigest).toBe(sha(readFileSync(join(f.mgmt, 'evidence', 'bundle.json'))))
  const archive = join(f.mgmt, 'archives', op('1') + '.json')
  expect(c.archiveRef).toBe('archives/' + op('1') + '.json'); expect(existsSync(archive)).toBe(true)
  expect(c.archiveDigest).toBe(sha(readFileSync(archive)))
  expect(JSON.stringify(JSON.parse(readFileSync(archive, 'utf8')))).not.toContain('private-goal')
  const backups = readdirSync(join(f.mgmt, 'backups'))
  expect(backups).toHaveLength(1)
  expect(backups[0]).toMatch(new RegExp('^registry-' + plan.plan.generation + '-'))
  expect(readFileSync(join(f.mgmt, 'backups', backups[0]))).toEqual(oldBytes)
  expect(sha(readFileSync(worktreeFile))).toBe(beforeFile)
})

test('replaying close and a fresh replay plan are zero-write and return the original result shape', () => {
  const { f, rec } = prepared()
  const plan = closePlan(f, rec), first = applyMaintenance(plan) as any
  const bytes = readFileSync(join(f.mgmt, 'registry.json'))
  const backups = readdirSync(join(f.mgmt, 'backups')).length
  const archive = readFileSync(join(f.mgmt, 'archives', op('1') + '.json'))
  const again = applyMaintenance(plan) as any
  expect(again).toEqual({ v: 1, ok: true, replayed: true, result: first.result })
  expect(readFileSync(join(f.mgmt, 'registry.json'))).toEqual(bytes)
  expect(readdirSync(join(f.mgmt, 'backups'))).toHaveLength(backups)
  expect(readFileSync(join(f.mgmt, 'archives', op('1') + '.json'))).toEqual(archive)
  const replayPlan = closePlan(f, rec)
  expect(replayPlan.ok).toBe(true); expect(replayPlan.plan.changes).toEqual([])
  expect((applyMaintenance(replayPlan) as any).replayed).toBe(true)
})

test('operation ID reuse with different parameters conflicts and a stale plan is rejected', () => {
  {
    const { f, rec } = prepared()
    applyMaintenance(closePlan(f, rec))
    code(() => planMaintenance({ ...closeRequest(f, rec), operatorRef: 'other-operator' }), 'OPERATION_CONFLICT')
  }
  const { f, rec } = prepared()
  const plan = closePlan(f, rec)
  new AtomicRegistry(f.project.commonDir, f.project).withLock(store => { const reg: any = store.read(); reg.generation++; store.write(reg) })
  code(() => applyMaintenance(plan), 'MAINTENANCE_PLAN_STALE')
  const reg = JSON.parse(readFileSync(join(f.mgmt, 'registry.json'), 'utf8'))
  expect(reg.active).toHaveLength(1)
  const tampered: any = structuredClone(plan); tampered.plan.expectedActive = ['ct_forged']
  code(() => applyMaintenance(tampered), 'MAINTENANCE_PLAN_STALE')
})

test('missing, mismatched, and unresolved evidence is refused', () => {
  {
    const { f, rec } = prepared()
    rmSync(join(f.mgmt, 'evidence', 'listing.json'))
    code(() => closePlan(f, rec), 'MAINTENANCE_EVIDENCE_INSUFFICIENT')
  }
  {
    const { f, rec } = prepared()
    const l = listing(f, rec, { taskID: 'ct_other' })
    bundle(f, rec, { listing: l })
    code(() => closePlan(f, rec), 'MAINTENANCE_EVIDENCE_INSUFFICIENT')
  }
  {
    const { f, rec } = prepared()
    const l = listing(f, rec, { completeness: 'incomplete', failures: [{ code: 'REVIEW_UNREADABLE', count: 1 }] })
    bundle(f, rec, { listing: l })
    code(() => closePlan(f, rec), 'MAINTENANCE_EVIDENCE_INSUFFICIENT')
  }
  {
    const { f, rec } = prepared()
    const l = listing(f, rec, { completeness: 'incomplete', failures: [{ code: 'REVIEW_UNREADABLE', count: 1 }] })
    bundle(f, rec, { listing: l, resolutions: [{}] })
    expect(closePlan(f, rec).ok).toBe(true)
  }
  {
    const { f, rec } = prepared()
    const l = listing(f, rec)
    bundle(f, rec, { listing: l })
    writeFileSync(join(f.mgmt, 'evidence', 'listing.json'), JSON.stringify({ ...l.data, taskID: 'ct_other' }))
    code(() => closePlan(f, rec), 'MAINTENANCE_EVIDENCE_INSUFFICIENT')
  }
})

test('evidence closure limits refuse oversized bundles', () => {
  {
    const { f, rec } = prepared()
    const refs = Array.from({ length: 33 }, (_, i) => 'evidence/extra-' + i + '.txt')
    for (const ref of refs) writeFileSync(join(f.mgmt, ref), 'x')
    bundle(f, rec, { external: refs })
    code(() => closePlan(f, rec), 'MAINTENANCE_EVIDENCE_TOO_LARGE')
  }
  {
    const { f, rec } = prepared()
    writeFileSync(join(f.mgmt, 'evidence', 'big.bin'), Buffer.alloc(2 * 1024 * 1024 + 1))
    bundle(f, rec, { external: ['evidence/big.bin'] })
    code(() => closePlan(f, rec), 'MAINTENANCE_EVIDENCE_TOO_LARGE')
  }
})

test('authorization labels must agree with evidence and an unclosed or retry-enabled window is not drained', () => {
  {
    const { f, rec } = prepared()
    bundle(f, rec, { operatorRef: 'other-operator' })
    code(() => closePlan(f, rec), 'MAINTENANCE_AUTHORIZATION_MISMATCH')
  }
  {
    const { f, rec } = prepared()
    bundle(f, rec, { retryDisabled: false })
    code(() => closePlan(f, rec), 'MAINTENANCE_NOT_DRAINED')
  }
  {
    const { f, rec } = prepared()
    bundle(f, rec, { closed: [] })
    code(() => closePlan(f, rec), 'MAINTENANCE_NOT_DRAINED')
  }
})

test('close requires v2 and an active target', () => {
  {
    const f = setup(), task = start(f)
    code(() => closePlan(f, record(f, task.taskID)), 'REGISTRY_INVALID')
  }
  {
    const { f, rec } = prepared()
    applyMaintenance(closePlan(f, rec))
    code(() => closePlan(f, rec, { operationID: op('2') }), 'OPERATION_CONFLICT')
  }
})

test('close succeeds when the worktree no longer exists and does not touch surviving bytes', () => {
  const { f, rec } = prepared()
  rmSync(f.target, { recursive: true, force: true })
  const out = applyMaintenance(closePlan(f, rec)) as any
  expect(out.ok).toBe(true)
  const reg = JSON.parse(readFileSync(join(f.mgmt, 'registry.json'), 'utf8'))
  expect(reg.active).toEqual([]); expect(reg.closed[0].record.input.directory).toBe(f.target)
})

test('backup write failure leaves the active record and registry untouched', () => {
  const { f, rec } = prepared()
  const plan = closePlan(f, rec), before = readFileSync(join(f.mgmt, 'registry.json'))
  writeFileSync(join(f.mgmt, 'backups'), 'blocker')
  code(() => applyMaintenance(plan), 'HOST_ERROR')
  expect(readFileSync(join(f.mgmt, 'registry.json'))).toEqual(before)
  expect(JSON.parse(readFileSync(join(f.mgmt, 'registry.json'), 'utf8')).active).toHaveLength(1)
  expect(existsSync(join(f.mgmt, 'archives', op('1') + '.json'))).toBe(false)
})

test('integrated disposition records a valid commit and refuses to omit or misplace it', () => {
  {
    const { f, rec } = prepared()
    code(() => closePlan(f, rec, { disposition: 'integrated' }), 'MAINTENANCE_EVIDENCE_INSUFFICIENT')
  }
  {
    const { f, rec } = prepared()
    code(() => closePlan(f, rec, { disposition: 'integrated', integrationCommit: 'bad' }), 'INVALID_INPUT')
  }
  {
    const { f, rec } = prepared()
    code(() => closePlan(f, rec, { integrationCommit: 'b'.repeat(40) }), 'INVALID_INPUT')
  }
  {
    const { f, rec } = prepared()
    const plan = closePlan(f, rec, { disposition: 'integrated', integrationCommit: 'b'.repeat(40) })
    applyMaintenance(plan)
    const c = JSON.parse(readFileSync(join(f.mgmt, 'registry.json'), 'utf8')).closed[0].closeout
    expect(c.disposition).toBe('integrated'); expect(c.integrationCommit).toBe('b'.repeat(40))
  }
})

test('migration plan is read-only, apply preserves every v1 record, and replay is zero-write', () => {
  const f = setup(), task = start(f)
  const beforeBytes = readFileSync(join(f.mgmt, 'registry.json'))
  const before = new Ledger(f.project).read()
  const request = { v: 1, operation: 'migrate', operationID: op('1'), operatorRef: 'operator-1', authorizationRef: 'auth-1', project: { ...f.project } }
  const plan = planMaintenance(request) as any
  expect(plan.ok).toBe(true); expect(plan.plan.generation).toBe(0); expect(plan.plan.registryDigest).toBe(sha(beforeBytes))
  expect(plan.plan.changes).toEqual([]); expect(plan.plan.expectedActive).toEqual(['ct_one']); expect(plan.plan.evidence).toEqual([])
  expect(readFileSync(join(f.mgmt, 'registry.json'))).toEqual(beforeBytes)
  const out = applyMaintenance(plan) as any
  expect(out).toEqual({ v: 1, ok: true, replayed: false, result: { schemaVersion: 2, generation: 1, currentPeriodID: 'pd_1' } })
  const reg = JSON.parse(readFileSync(join(f.mgmt, 'registry.json'), 'utf8'))
  expect(reg.schemaVersion).toBe(2); expect(reg.generation).toBe(1)
  expect(reg.active.map((x: any) => x.record)).toEqual(before)
  expect(existsSync(join(f.mgmt, 'archives', op('1') + '.json'))).toBe(true)
  expect(readdirSync(join(f.mgmt, 'backups'))[0]).toMatch(/^registry-0-/)
  const bytes = readFileSync(join(f.mgmt, 'registry.json'))
  const replay = applyMaintenance(plan) as any
  expect(replay.replayed).toBe(true); expect(replay.result).toEqual({ schemaVersion: 2, generation: 1, currentPeriodID: 'pd_1' })
  expect(readFileSync(join(f.mgmt, 'registry.json'))).toEqual(bytes)
  code(() => planMaintenance({ ...request, operationID: op('2') }), 'OPERATION_CONFLICT')
  expect(task.taskID).toBe('ct_one')
})

test('open-period refuses active records, seals the old period, opens the next, and replays', () => {
  {
    const f = setup(), task = start(f); migrated(f)
    const request = { v: 1, operation: 'open-period', operationID: op('2'), operatorRef: 'operator-1', authorizationRef: 'auth-1', project: { ...f.project }, baseline: f.oid }
    code(() => planMaintenance(request), 'PERIOD_NOT_EMPTY')
    expect(task.taskID).toBe('ct_one')
  }
  const { f, rec } = prepared()
  applyMaintenance(closePlan(f, rec))
  writeFileSync(join(f.primary, 'b.txt'), 'beta\n'); f.git('add', 'b.txt'); f.git('commit', '-m', 'two')
  const baseline = f.git('rev-parse', 'HEAD')
  const request = { v: 1, operation: 'open-period', operationID: op('2'), operatorRef: 'operator-1', authorizationRef: 'auth-1', project: { ...f.project }, baseline }
  const plan = planMaintenance(request) as any
  expect(plan.ok).toBe(true); expect(plan.plan.changes).toEqual([]); expect(plan.plan.expectedActive).toEqual([])
  const out = applyMaintenance(plan) as any
  expect(out.ok).toBe(true); expect(out.replayed).toBe(false)
  expect(out.result).toMatchObject({ periodID: 'pd_2', baseline })
  expect(Number.isFinite(Date.parse(out.result.openedAt))).toBe(true)
  const reg = JSON.parse(readFileSync(join(f.mgmt, 'registry.json'), 'utf8'))
  expect(reg.currentPeriodID).toBe('pd_2'); expect(reg.periods).toHaveLength(2)
  expect(reg.periods[0].sealedAt).toBeDefined()
  expect(reg.periods[1]).toMatchObject({ periodID: 'pd_2', baseline, openedBy: op('2') })
  expect(reg.closed).toHaveLength(1)
  const bytes = readFileSync(join(f.mgmt, 'registry.json'))
  const replay = applyMaintenance(plan) as any
  expect(replay.replayed).toBe(true); expect(replay.result).toEqual(out.result)
  expect(readFileSync(join(f.mgmt, 'registry.json'))).toEqual(bytes)
})

test('open-period validates the new baseline and a clean primary', () => {
  const { f, rec } = prepared()
  applyMaintenance(closePlan(f, rec))
  const base = { v: 1, operation: 'open-period', operationID: op('2'), operatorRef: 'operator-1', authorizationRef: 'auth-1', project: { ...f.project } }
  code(() => planMaintenance({ ...base, baseline: 'b'.repeat(40) }), 'BASELINE_MISMATCH')
  writeFileSync(join(f.primary, 'dirty.txt'), 'dirty')
  code(() => planMaintenance({ ...base, baseline: f.oid }), 'DIRTY_PRIMARY')
})

const cli = join(import.meta.dir, '../src/maintenance-cli.ts')
const runCli = (...args: string[]) => spawnSync('bun', [cli, ...args], { encoding: 'utf8', env: { ...process.env, TMPDIR: tmp }, timeout: 20000 })

test('maintenance CLI emits one JSON object per plan/apply and replays without extra output', () => {
  const { f, rec } = prepared()
  const opFile = join(f.base, 'operation.json'), planFile = join(f.base, 'plan.json')
  writeFileSync(opFile, JSON.stringify(closeRequest(f, rec)))
  const planned = runCli('plan', opFile)
  expect(planned.status).toBe(0); expect(planned.signal).toBeNull()
  const plan = JSON.parse(planned.stdout)
  expect(plan.ok).toBe(true); expect(plan.plan.request.operation).toBe('close')
  expect(planned.stderr).toContain('计划')
  expect(planned.stdout).not.toContain('private-goal')
  expect(planned.stderr).not.toContain('private-goal')
  writeFileSync(planFile, JSON.stringify(plan))
  const applied = runCli('apply', planFile)
  expect(applied.status).toBe(0)
  expect(JSON.parse(applied.stdout)).toMatchObject({ v: 1, ok: true, replayed: false })
  const replayed = runCli('apply', planFile)
  expect(replayed.status).toBe(0)
  expect(JSON.parse(replayed.stdout)).toMatchObject({ v: 1, ok: true, replayed: true })
  expect(replayed.stderr).toContain('重放')
})

test('maintenance CLI maps refusal to exit 1 and bad usage or structure to exit 2', () => {
  const { f, rec } = prepared()
  rmSync(join(f.mgmt, 'evidence', 'listing.json'))
  const refusedFile = join(f.base, 'refused.json')
  writeFileSync(refusedFile, JSON.stringify(closeRequest(f, rec)))
  const refused = runCli('plan', refusedFile)
  expect(refused.status).toBe(1)
  expect(JSON.parse(refused.stdout).error.code).toBe('MAINTENANCE_EVIDENCE_INSUFFICIENT')
  expect(refused.stdout).not.toContain('private-goal')
  expect(refused.stderr).not.toContain('private-goal')
  const { f: g, rec: other } = prepared()
  const badFile = join(g.base, 'bad.json')
  writeFileSync(badFile, JSON.stringify({ ...closeRequest(g, other), unexpected: true }))
  const bad = runCli('plan', badFile)
  expect(bad.status).toBe(2)
  expect(JSON.parse(bad.stdout).error.code).toBe('INVALID_INPUT')
  const usage = runCli()
  expect(usage.status).toBe(2)
  expect(usage.stderr).toContain('用法')
  expect(JSON.parse(usage.stdout).error.code).toBe('INVALID_INPUT')
})
