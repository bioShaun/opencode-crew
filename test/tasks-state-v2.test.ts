import { test, expect } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { Ledger, normalizeTaskInput, requestDigest } from '../src/tasks-state'

const work = join(import.meta.dir, '.work/tasks-state-v2')
mkdirSync(work, { recursive: true })
mkdirSync(join(work, 'tmp'), { recursive: true })
const B = 'a'.repeat(40)
const OP = 'op_' + '1'.repeat(32)
const DG = '2'.repeat(64)
const op = (c: string) => 'op_' + c.repeat(32)
const dg = (c: string) => c.repeat(64)

function setup() {
  const base = realpathSync((() => { const p = join(work, randomUUID()); mkdirSync(p, { recursive: true }); return p })())
  const project = { primaryDirectory: base, commonDir: base }
  const dirs = ['a', 'b', 'c', 'd'].map(name => { const p = join(base, name); mkdirSync(p); return p })
  return { base, project, dirs, ledger: new Ledger(project), file: join(base, 'opencode-crew-stage1', 'registry.json') }
}
const input = (directory: string, key = 'one', baseline = B) => normalizeTaskInput({ key, directory, baseline, scope: ['out'], goal: 'private-goal', acceptance: 'private-accept', check: 'private-check' })
const pre = (project: any, i: any) => ({ ...project, directory: i.directory, baseline: i.baseline, scope: i.scope })
const readReg = (file: string) => JSON.parse(readFileSync(file, 'utf8'))
const writeReg = (file: string, payload: unknown) => writeFileSync(file, JSON.stringify(payload))
const snapshot = (file: string) => readFileSync(file, 'utf8')

function record(directory: string, key: string, owner = 'owner', baseline = B) {
  const i = input(directory, key, baseline), now = new Date().toISOString()
  return { taskID: `ct_${key}`, input: i, ownerSessionID: owner, requestDigest: requestDigest(i, owner), state: 'reserved', createdAt: now, updatedAt: now }
}
function closeout(over: Record<string, unknown> = {}) {
  return {
    operationID: op('3'), paramsDigest: dg('4'), closedAt: new Date().toISOString(), operatorRef: 'operator', authorizationRef: 'authorization',
    disposition: 'preserved', stopEvidenceRef: 'evidence/stop.json', quiescenceEvidenceRef: 'evidence/quiescence.json', reviewEvidenceRef: 'evidence/review.json',
    evidenceDigest: dg('5'), archiveRef: 'archives/op.json', archiveDigest: dg('6'), ...over,
  }
}
function migrate(s: ReturnType<typeof setup>) { return s.ledger.migrate(OP, DG) }
function migrated() { const s = setup(); const one = input(s.dirs[0]); s.ledger.reserve('owner', one, () => pre(s.project, one)); migrate(s); return s }
function closeFixture(s: ReturnType<typeof setup>, taskID: string, over: Record<string, unknown> = {}) {
  const reg = readReg(s.file), index = reg.active.findIndex((x: any) => x.record.taskID === taskID)
  const [item] = reg.active.splice(index, 1)
  reg.closed.push({ periodID: item.periodID, record: item.record, closeout: closeout(over) })
  writeReg(s.file, reg)
  return reg
}
function reject(s: ReturnType<typeof setup>, mutate: (reg: any) => void) {
  const data = structuredClone(readReg(s.file)); mutate(data)
  const bytes = JSON.stringify(data); writeFileSync(s.file, bytes)
  let error: any
  try { new Ledger(s.project).read() } catch (e) { error = e }
  expect(error?.code).toBe('REGISTRY_INVALID')
  expect(readFileSync(s.file, 'utf8')).toBe(bytes)
}

test('missing registry reads empty without creating a store', () => {
  const s = setup()
  expect(s.ledger.read()).toEqual([])
  expect(existsSync(join(s.base, 'opencode-crew-stage1'))).toBe(false)
})

test('explicit migration preserves every v1 record and releases no capacity', () => {
  const s = setup(), one = input(s.dirs[0]), two = input(s.dirs[1], 'two')
  s.ledger.reserve('owner', one, () => pre(s.project, one))
  s.ledger.reserve('owner2', two, () => pre(s.project, two))
  s.ledger.transition('owner', 'ct_one', 'reserved', 'session_create_requested')
  s.ledger.transition('owner', 'ct_one', 'session_create_requested', 'session_bound', { sessionID: 'session-one' })
  s.ledger.transition('owner', 'ct_one', 'session_bound', 'prompt_requested')
  s.ledger.transition('owner', 'ct_one', 'prompt_requested', 'submitted')
  s.ledger.transition('owner', 'ct_one', 'submitted', 'stop_requested')
  s.ledger.transition('owner', 'ct_one', 'stop_requested', 'stop_unconfirmed', { interruptResult: { interrupted: 'unknown', result: 'request_completed' } })
  const before = s.ledger.read()
  const result = migrate(s)
  expect(result).toEqual({ schemaVersion: 2, generation: 1, currentPeriodID: 'pd_1', replayed: false })
  const reg = readReg(s.file)
  expect(reg.schemaVersion).toBe(2)
  expect(reg.generation).toBe(1)
  expect(reg.currentPeriodID).toBe('pd_1')
  expect(reg.migration.operationID).toBe(OP)
  expect(reg.migration.paramsDigest).toBe(DG)
  expect(Number.isFinite(Date.parse(reg.migration.appliedAt))).toBe(true)
  expect(reg.periods).toEqual([{ periodID: 'pd_1', baseline: B, openedAt: reg.migration.appliedAt, openedBy: OP, openedParamsDigest: DG }])
  expect(reg.active).toEqual(before.map((item: any) => ({ periodID: 'pd_1', record: item })))
  expect(reg.closed).toEqual([])
  expect(new Ledger(s.project).read()).toEqual(before)
  const three = input(s.dirs[2], 'three')
  expect(() => new Ledger(s.project).reserve('owner3', three, () => pre(s.project, three))).toThrow('CAPACITY_RESERVED')
})

test('migration keeps history when the worktree no longer exists', () => {
  const s = setup(), one = input(s.dirs[0])
  s.ledger.reserve('owner', one, () => pre(s.project, one))
  rmSync(s.dirs[0], { recursive: true })
  migrate(s)
  expect(new Ledger(s.project).read()[0].input.directory).toBe(s.dirs[0])
})

test('migration replay is byte-identical and conflicting credentials fail closed', () => {
  const s = migrated(), bytes = snapshot(s.file)
  expect(new Ledger(s.project).migrate(OP, DG)).toEqual({ schemaVersion: 2, generation: 1, currentPeriodID: 'pd_1', replayed: true })
  expect(snapshot(s.file)).toBe(bytes)
  expect(() => new Ledger(s.project).migrate(OP, dg('3'))).toThrow('OPERATION_CONFLICT')
  expect(() => new Ledger(s.project).migrate(op('9'), DG)).toThrow('OPERATION_CONFLICT')
})

test('migration requires an existing v1 registry and well-formed credentials', () => {
  const s = setup()
  expect(() => s.ledger.migrate(OP, DG)).toThrow('REGISTRY_INVALID')
  const one = input(s.dirs[0]); s.ledger.reserve('owner', one, () => pre(s.project, one))
  for (const [operation, digest] of [['op_bad', DG], [OP, 'xyz'], [OP.toUpperCase(), DG], [op('1'), dg('Z')]] as const) {
    expect(() => new Ledger(s.project).migrate(operation as any, digest as any)).toThrow('INVALID_INPUT')
  }
})

test('closed history frees capacity but keeps key, cwd, and replay identity', () => {
  const s = migrated(); closeFixture(s, 'ct_one')
  expect(new Ledger(s.project).read().map(t => t.taskID)).toEqual(['ct_one'])
  expect(new Ledger(s.project).entries()).toMatchObject([{ lifecycle: 'closed', periodID: 'pd_1' }])
  const two = input(s.dirs[1], 'two')
  expect(new Ledger(s.project).reserve('owner2', two, () => pre(s.project, two)).replayed).toBe(false)
  const replay = new Ledger(s.project).reserve('owner', input(s.dirs[0]), () => { throw Error('preflight must not run') })
  expect(replay.replayed).toBe(true)
  expect(replay.lifecycle).toBe('closed')
  expect(replay.periodID).toBe('pd_1')
  expect(replay.task.taskID).toBe('ct_one')
  expect(() => new Ledger(s.project).reserve('other', input(s.dirs[0]), () => { throw Error('preflight must not run') })).toThrow('IDEMPOTENCY_CONFLICT')
  const alias = input(s.dirs[0], 'alias')
  expect(() => new Ledger(s.project).reserve('owner3', alias, () => { throw Error('preflight must not run') })).toThrow('WRITER_RESERVED')
})

test('generation increases on reserve and transition but not on replay', () => {
  const s = migrated()
  const generation = () => readReg(s.file).generation
  expect(generation()).toBe(1)
  new Ledger(s.project).reserve('owner', input(s.dirs[0]), () => { throw Error('preflight must not run') })
  expect(generation()).toBe(1)
  const two = input(s.dirs[1], 'two')
  new Ledger(s.project).reserve('owner2', two, () => pre(s.project, two))
  expect(generation()).toBe(2)
  new Ledger(s.project).transition('owner', 'ct_one', 'reserved', 'stop_requested')
  expect(generation()).toBe(3)
  expect(readReg(s.file).active.find((x: any) => x.record.taskID === 'ct_two').periodID).toBe('pd_1')
})

test('v2 binds the current baseline and never transitions closed records', () => {
  const s = migrated(); closeFixture(s, 'ct_one')
  expect(() => new Ledger(s.project).reserve('owner2', input(s.dirs[1], 'two', 'b'.repeat(40)), () => { throw Error('preflight must not run') })).toThrow('BASELINE_MISMATCH')
  expect(() => new Ledger(s.project).transition('owner', 'ct_one', 'reserved', 'stop_requested')).toThrow('HOST_ERROR')
})

test('v1 operations never migrate implicitly', () => {
  const s = setup(), one = input(s.dirs[0])
  s.ledger.reserve('owner', one, () => pre(s.project, one))
  s.ledger.transition('owner', 'ct_one', 'reserved', 'stop_requested')
  const reg = readReg(s.file)
  expect(reg.schemaVersion).toBe(1)
  expect(reg.generation).toBeUndefined()
  expect(reg.tasks).toHaveLength(1)
})

test('v2 rejects malformed versions, migration, and periods', () => {
  const cases: ((reg: any) => void)[] = [
    reg => { reg.schemaVersion = 3 },
    reg => { reg.generation = 0 },
    reg => { reg.generation = 1.5 },
    reg => { delete reg.migration },
    reg => { reg.migration.operationID = 'op_bad' },
    reg => { reg.migration.paramsDigest = 'XYZ' },
    reg => { reg.migration.appliedAt = 'not-a-date' },
    reg => { reg.periods[0].openedBy = op('9') },
    reg => { reg.periods[0].openedParamsDigest = dg('9') },
    reg => { reg.periods[0].periodID = 'pd_2' },
    reg => { reg.periods[0].sealedAt = new Date().toISOString() },
    reg => { reg.currentPeriodID = 'pd_2' },
    reg => { reg.periods = [] },
    reg => { reg.extra = true },
  ]
  for (const mutate of cases) reject(migrated(), mutate)
})

test('v2 rejects malformed active records and identity collisions', () => {
  const cases: ((s: ReturnType<typeof setup>, reg: any) => void)[] = [
    (s, reg) => { reg.active = [reg.active[0], { periodID: 'pd_1', record: reg.active[0].record }] },
    (s, reg) => { reg.active[0].periodID = 'pd_2' },
    (s, reg) => { reg.active[0].record = record(s.dirs[0], 'one', 'owner', 'b'.repeat(40)) },
    (s, reg) => { reg.active.push({ periodID: 'pd_1', record: record(s.dirs[1], 'one') }) },
    (s, reg) => { reg.active.push({ periodID: 'pd_1', record: record(s.dirs[0], 'alias') }) },
    (s, reg) => { reg.active[0].record.requestDigest = dg('9') },
    (s, reg) => { reg.active = [reg.active[0], { periodID: 'pd_1', record: record(s.dirs[1], 'two') }, { periodID: 'pd_1', record: record(s.dirs[2], 'three') }] },
  ]
  for (const mutate of cases) { const s = migrated(); reject(s, reg => mutate(s, reg)) }
})

test('v2 rejects malformed closed history and closeout evidence', () => {
  const cases: ((s: ReturnType<typeof setup>, reg: any) => void)[] = [
    (s, reg) => { reg.closed[0].periodID = 'pd_9' },
    (s, reg) => { reg.closed[0].record = record(s.dirs[0], 'one', 'owner', 'b'.repeat(40)) },
    (s, reg) => { delete reg.closed[0].closeout.archiveDigest },
    (s, reg) => { reg.closed[0].closeout.extra = true },
    (s, reg) => { reg.closed[0].closeout.operationID = OP },
    (s, reg) => { reg.closed[0].closeout.operationID = 'op_bad' },
    (s, reg) => { reg.closed[0].closeout.paramsDigest = 'bad' },
    (s, reg) => { reg.closed[0].closeout.stopEvidenceRef = '/absolute/stop.json' },
    (s, reg) => { reg.closed[0].closeout.stopEvidenceRef = '../escape.json' },
    (s, reg) => { reg.closed[0].closeout.reviewEvidenceRef = 'evidence/../escape.json' },
    (s, reg) => { reg.closed[0].closeout.operatorRef = '' },
    (s, reg) => { reg.closed[0].closeout.authorizationRef = 'bad\u0001label' },
    (s, reg) => { reg.closed[0].closeout.disposition = 'released' },
    (s, reg) => { reg.closed[0].closeout.disposition = 'integrated' },
    (s, reg) => { reg.closed[0].closeout.disposition = 'integrated'; reg.closed[0].closeout.integrationCommit = 'bad' },
    (s, reg) => { reg.closed[0].closeout.integrationCommit = 'a'.repeat(40) },
    (s, reg) => { reg.closed[0].closeout.evidenceDigest = 'bad' },
    (s, reg) => { reg.closed[0].closeout.archiveDigest = 'bad' },
  ]
  for (const mutate of cases) { const s = migrated(); closeFixture(s, 'ct_one'); reject(s, reg => mutate(s, reg)) }
})

test('v2 accepts a sealed prior period, a current period, and a non-contiguous generation', () => {
  const s = migrated(), reg = readReg(s.file)
  const prior = reg.active.shift()
  reg.periods[0].sealedAt = new Date().toISOString()
  reg.periods.push({ periodID: 'pd_2', baseline: 'b'.repeat(40), openedAt: new Date().toISOString(), openedBy: op('2'), openedParamsDigest: dg('2') })
  reg.currentPeriodID = 'pd_2'
  reg.closed.push({ periodID: 'pd_1', record: prior.record, closeout: closeout() })
  reg.active.push({ periodID: 'pd_2', record: record(s.dirs[1], 'two', 'owner2', 'b'.repeat(40)) })
  reg.generation = 7
  writeReg(s.file, reg)
  const ledger = new Ledger(s.project)
  expect(ledger.entries().map(e => [e.lifecycle, e.periodID])).toEqual([['active', 'pd_2'], ['closed', 'pd_1']])
  expect(ledger.active('owner2').map(e => e.record.taskID)).toEqual(['ct_two'])
  expect(ledger.find('owner', 'ct_one')?.lifecycle).toBe('closed')
  expect(ledger.find('owner2', 'ct_one')).toBeUndefined()
})

test('integrated closeout requires a valid integration commit', () => {
  const s = migrated(); closeFixture(s, 'ct_one', { disposition: 'integrated', integrationCommit: 'c'.repeat(40) })
  expect(new Ledger(s.project).entries()[0]).toMatchObject({ lifecycle: 'closed', closeout: { disposition: 'integrated', integrationCommit: 'c'.repeat(40) } })
})

test('oversized registry fails closed and is not rewritten', () => {
  const s = migrated(), bytes = 'x'.repeat(1024 * 1024 + 1)
  writeFileSync(s.file, bytes)
  expect(() => new Ledger(s.project).read()).toThrow('REGISTRY_INVALID')
  expect(() => new Ledger(s.project).reserve('owner2', input(s.dirs[1], 'two'), () => { throw Error('preflight must not run') })).toThrow('REGISTRY_INVALID')
  expect(readFileSync(s.file, 'utf8')).toBe(bytes)
})

test('migration write failure leaves the v1 registry intact', () => {
  const base = join(work, randomUUID()), commonDir = join(base, 'common'), primary = join(base, 'primary'), target = join(base, 'target')
  mkdirSync(commonDir, { recursive: true }); mkdirSync(primary); mkdirSync(target)
  const identity = { commonDir, primaryDirectory: primary }
  const one = normalizeTaskInput({ key: 'one', directory: target, baseline: B, scope: ['out'], goal: 'g', acceptance: 'a', check: 'c' })
  new Ledger(identity).reserve('owner', one, () => ({ ...identity, directory: target, baseline: B, scope: ['out'] }))
  const file = join(commonDir, 'opencode-crew-stage1', 'registry.json'), before = readFileSync(file)
  const child = resolve(import.meta.dir, 'fixtures/atomic-fault-child.ts')
  const result = spawnSync('bun', [child, base, 'write', 'migrate'], { env: { ...process.env, TMPDIR: join(work, 'tmp') }, encoding: 'utf8', timeout: 15000 })
  expect(result.error).toBeUndefined(); expect(result.status).toBe(0); expect(result.signal).toBeNull()
  expect(result.stdout).toContain('HIT write'); expect(result.stdout).toContain('RESULT REGISTRY_INVALID')
  expect(readFileSync(file)).toEqual(before)
  expect(new Ledger(identity).read()[0].taskID).toBe('ct_one')
  expect(existsSync(join(commonDir, 'opencode-crew-stage1', '.lock'))).toBe(false)
})
