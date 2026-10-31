import { test, expect } from 'bun:test'
import plugin from '../src/index'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { inspectProject } from '../src/tasks-registry'
import { Ledger } from '../src/tasks-state'
import { AtomicRegistry } from '../src/tasks-ledger'

const OP = 'op_' + '1'.repeat(32)
const DG = '2'.repeat(64)
const closeout = {
  operationID: 'op_' + '3'.repeat(32), paramsDigest: '4'.repeat(64), closedAt: new Date().toISOString(), operatorRef: 'operator', authorizationRef: 'authorization',
  disposition: 'preserved', stopEvidenceRef: 'evidence/stop.json', quiescenceEvidenceRef: 'evidence/quiescence.json', reviewEvidenceRef: 'evidence/review.json',
  evidenceDigest: '5'.repeat(64), archiveRef: 'archives/op.json', archiveDigest: '6'.repeat(64),
}

async function fixture(options: any = {}) {
  const base = resolve('test/.work/tasks-tools-v2', randomUUID()), primary = resolve(base, 'primary'), target = resolve(base, 'target')
  mkdirSync(base, { recursive: true })
  function git(...args: string[]) { const r = spawnSync('git', args, { encoding: 'utf8', env: { ...process.env, TMPDIR: resolve('test/.work/tasks-tools-v2/tmp'), GIT_OPTIONAL_LOCKS: '0' } }); if (r.status !== 0) throw Error('fixture git failed'); return r.stdout.trim() }
  const oid = git('rev-parse', 'HEAD')
  git('clone', '--no-local', '--no-checkout', process.cwd(), primary)
  git('-C', primary, 'checkout', '--detach', oid)
  git('-C', primary, 'worktree', 'add', '--detach', target, oid)
  const dir = realpathSync(primary), wt = realpathSync(target), tools = new Map<string, any>(), hooks = new Map<string, any>(), sessions = new Map<string, any>(), calls: any[] = []
  const owner: any = { id: 'owner', agent: 'root', location: { directory: dir }, model: { providerID: 'owner', id: 'model' } }
  sessions.set('owner', owner)
  const controls: any = {}
  const ctx: any = {
    options, location: { directory: dir }, agent: { transform: async (fn: any) => fn({ update: (_: any, f: any) => f({ permissions: [] }) }) },
    command: { transform: async (fn: any) => fn({ add: () => {} }) }, tool: { transform: async (fn: any) => fn({ add: (t: any) => tools.set(t.name, t) }) },
    permission: { assert: async (x: any) => { calls.push(['assert', x]); if (controls.deny === x.action) throw Error('permission denied') } },
    session: {
      hook: async (name: string, fn: any) => { hooks.set(name, fn); return { dispose: async () => {} } },
      get: async ({ sessionID }: any) => { if (controls.getError === sessionID) throw Error('secret host body'); const s = sessions.get(sessionID); if (!s) throw Error('secret host body'); return s },
      create: async (x: any) => { calls.push(['create', x]); const id = calls.filter(c => c[0] === 'create').length === 1 ? 'child' : 'child2'; const s = { id, ...x, time: { created: 1, updated: 1 } }; sessions.set(id, s); if (controls.createLost) throw Error('secret host body'); return s },
      prompt: async (x: any) => { calls.push(['prompt', x]); if (controls.promptLost) throw Error('secret host body') },
      interrupt: async (x: any) => { calls.push(['interrupt', x]); if (controls.interruptLost) throw Error('secret host body'); return { interrupted: true } },
    },
  }
  await plugin.setup(ctx)
  const tc: any = { sessionID: 'owner', agent: 'root', messageID: 'message', id: 'call', signal: new AbortController().signal }
  const input = { key: 'one', directory: wt, baseline: oid, scope: ['src/'], goal: 'private-goal', acceptance: 'private-acceptance', check: 'private-check' }
  const run = async (name: string, args: any, context = tc) => { const tool = tools.get(name); expect(tool).toBeDefined(); return (await tool.execute(args, context)).output }
  return { tools, hooks, sessions, calls, controls, owner, tc, input, run, dir, wt, ctx, oid }
}

function migrate(f: Awaited<ReturnType<typeof fixture>>) {
  const project = inspectProject(f.dir)
  expect(new Ledger(project).migrate(OP, DG).replayed).toBe(false)
  return project
}
function close(f: Awaited<ReturnType<typeof fixture>>, project: any, taskID: string) {
  const atomic = new AtomicRegistry(project.commonDir, project)
  atomic.withLock(store => {
    const reg: any = store.read(), index = reg.active.findIndex((x: any) => x.record.taskID === taskID)
    if (index < 0) throw Error('task is not active')
    const [item] = reg.active.splice(index, 1)
    reg.closed.push({ periodID: item.periodID, record: item.record, closeout: { ...closeout } })
    reg.generation++
    store.write(reg)
  })
}
const count = (f: Awaited<ReturnType<typeof fixture>>, name: string) => f.calls.filter(x => x[0] === name).length

test('v2 active views expose lifecycle and period', async () => {
  const f = await fixture(); await f.run('crew_task_start', f.input); migrate(f)
  const status: any = await f.run('crew_task_status', {})
  expect(status.ok).toBe(true)
  expect(status.tasks).toHaveLength(1)
  expect(status.tasks[0].lifecycle).toBe('active')
  expect(status.tasks[0].periodID).toBe('pd_1')
  expect(status.tasks[0].processSafety).toBe('unconfirmed')
  expect(status.tasks[0].canCleanup).toBe(false)
  expect(status.tasks[0].canIntegrate).toBe(false)
})

test('closed key replay has zero create, prompt, or interrupt', async () => {
  const f = await fixture(); await f.run('crew_task_start', f.input); const project = migrate(f); close(f, project, 'ct_one')
  const creates = count(f, 'create'), prompts = count(f, 'prompt'), interrupts = count(f, 'interrupt')
  const replay: any = await f.run('crew_task_start', f.input)
  expect(replay.ok).toBe(true)
  expect(replay.task.lifecycle).toBe('closed')
  expect(replay.task.periodID).toBe('pd_1')
  expect(replay.task.closeout).toEqual({ closedAt: closeout.closedAt, disposition: 'preserved' })
  expect(replay.warnings).toContain('重放不会重新投递。')
  expect(count(f, 'create')).toBe(creates)
  expect(count(f, 'prompt')).toBe(prompts)
  expect(count(f, 'interrupt')).toBe(interrupts)
  expect(JSON.stringify(replay)).not.toContain('private-goal')
  expect(JSON.stringify(replay)).not.toContain('private-check')
})

test('status hides closed history unless a taskID is explicit', async () => {
  const f = await fixture(); await f.run('crew_task_start', f.input); const project = migrate(f); close(f, project, 'ct_one')
  const listing: any = await f.run('crew_task_status', {})
  expect(listing.ok).toBe(true)
  expect(listing.tasks).toEqual([])
  const one: any = await f.run('crew_task_status', { taskID: 'ct_one' })
  expect(one.ok).toBe(true)
  expect(one.task.lifecycle).toBe('closed')
  expect(one.task.periodID).toBe('pd_1')
  expect(one.task.closeout).toEqual({ closedAt: closeout.closedAt, disposition: 'preserved' })
  expect(one.task.processSafety).toBe('unconfirmed')
  expect(one.task.canCleanup).toBe(false)
  expect(one.task.canIntegrate).toBe(false)
  expect(JSON.stringify(one)).not.toContain('private-acceptance')
})

test('stop on closed history returns the record without interrupting', async () => {
  const f = await fixture(); await f.run('crew_task_start', f.input); const project = migrate(f); close(f, project, 'ct_one')
  const interrupts = count(f, 'interrupt')
  const stopped: any = await f.run('crew_task_stop', { taskID: 'ct_one' })
  expect(stopped.ok).toBe(true)
  expect(stopped.task.lifecycle).toBe('closed')
  expect(stopped.warnings).toContain('已结案，不会重复中断。')
  expect(count(f, 'interrupt')).toBe(interrupts)
})

test('retry hook still disables retry for closed bindings', async () => {
  const f = await fixture(); await f.run('crew_task_start', f.input); const project = migrate(f); close(f, project, 'ct_one')
  const event: any = { sessionID: 'child', decision: { retry: true, delay: 1 } }
  await f.hooks.get('retry')(event)
  expect(event.decision.retry).toBe(false)
})

test('closed history is not exposed across owners', async () => {
  const f = await fixture(); await f.run('crew_task_start', f.input); const project = migrate(f); close(f, project, 'ct_one')
  const other: any = { id: 'other', agent: 'root', location: { directory: f.dir }, model: { providerID: 'other', id: 'model' } }
  f.sessions.set('other', other)
  const tc: any = { ...f.tc, sessionID: 'other' }
  const status: any = await f.run('crew_task_status', { taskID: 'ct_one' }, tc)
  expect(status.ok).toBe(true)
  expect(status.task).toBeUndefined()
  const replay: any = await f.run('crew_task_start', f.input, tc)
  expect(replay.ok).toBe(false)
  expect(replay.error.code).toBe('IDEMPOTENCY_CONFLICT')
  expect(count(f, 'create')).toBe(1)
})

test('v2 active stop still interrupts at most once', async () => {
  const f = await fixture(); await f.run('crew_task_start', f.input); migrate(f)
  const first: any = await f.run('crew_task_stop', { taskID: 'ct_one' })
  const second: any = await f.run('crew_task_stop', { taskID: 'ct_one' })
  expect(first.ok).toBe(true)
  expect(first.task.lifecycle).toBe('active')
  expect(first.task.periodID).toBe('pd_1')
  expect(first.task.state).toBe('stop_unconfirmed')
  expect(second.task.state).toBe('stop_unconfirmed')
  expect(count(f, 'interrupt')).toBe(1)
})

test('migration leaves worktree and index bytes untouched', async () => {
  const f = await fixture(); await f.run('crew_task_start', f.input)
  const file = join(f.input.directory, 'package.json')
  const hash = () => createHash('sha256').update(readFileSync(file)).digest('hex')
  const before = { file: hash(), head: spawnSync('git', ['-C', f.input.directory, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim(), status: spawnSync('git', ['-C', f.input.directory, 'status', '--porcelain=v1'], { encoding: 'utf8' }).stdout }
  migrate(f)
  const after = { file: hash(), head: spawnSync('git', ['-C', f.input.directory, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim(), status: spawnSync('git', ['-C', f.input.directory, 'status', '--porcelain=v1'], { encoding: 'utf8' }).stdout }
  expect(after).toEqual(before)
})
