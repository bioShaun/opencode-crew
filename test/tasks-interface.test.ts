import { test, expect } from 'bun:test'
import plugin from '../src/index'
import { spawnSync } from 'node:child_process'
import { mkdirSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

const root = resolve('test/.work/tasks-interface')
const env = () => ({ ...process.env, TMPDIR: resolve(root, 'tmp'), GIT_OPTIONAL_LOCKS: '0' })
function git(cwd: string, ...args: string[]) {
  const result = spawnSync('git', args, { cwd, env: env(), encoding: 'utf8' })
  if (result.error || result.status !== 0) throw Error(`fixture git failed: ${result.error ?? result.stderr}`)
  return result.stdout.trim()
}
const count = (f: Awaited<ReturnType<typeof fixture>>, name: string) => f.calls.filter(x => x[0] === name).length

/** Registration-only context: no repository, enough to inspect prompts, tools and validation. */
async function registration(options: any = {}) {
  const tools = new Map<string, any>(), agents = new Map<string, any>()
  const ctx: any = {
    options, location: { directory: process.cwd() },
    agent: { transform: async (fn: any) => fn({ update: (id: string, f: any) => { const a = agents.get(id) ?? { id, permissions: [] }; f(a); agents.set(id, a) } }) },
    command: { transform: async (fn: any) => fn({ add: () => {} }) },
    tool: { transform: async (fn: any) => fn({ add: (t: any) => tools.set(t.name, t) }) },
    session: { hook: async () => ({ dispose: async () => {} }) },
  }
  await plugin.setup(ctx)
  return { tools, agents }
}

async function fixture(options: any = {}) {
  const base = resolve(root, randomUUID()), primary = resolve(base, 'primary'), target = resolve(base, 'target')
  mkdirSync(base, { recursive: true })
  const oid = git(process.cwd(), 'rev-parse', 'HEAD')
  git(process.cwd(), 'clone', '--no-local', '--no-checkout', process.cwd(), primary)
  git(primary, 'checkout', '--detach', oid)
  git(primary, 'worktree', 'add', '--detach', target, oid)
  const dir = realpathSync(primary), wt = realpathSync(target)
  const tools = new Map<string, any>(), agents = new Map<string, any>(), hooks = new Map<string, any>(), sessions = new Map<string, any>(), calls: any[] = []
  const owner: any = { id: 'owner', agent: 'root', location: { directory: dir }, model: { providerID: 'owner', id: 'model' } }
  sessions.set('owner', owner)
  const controls: any = {}
  const ctx: any = {
    options, location: { directory: dir },
    agent: { transform: async (fn: any) => fn({ update: (id: string, f: any) => { const a = agents.get(id) ?? { id, permissions: [] }; f(a); agents.set(id, a) } }) },
    command: { transform: async (fn: any) => fn({ add: () => {} }) },
    tool: { transform: async (fn: any) => fn({ add: (t: any) => tools.set(t.name, t) }) },
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
  const runFull = async (name: string, args: any, context = tc) => { const tool = tools.get(name); expect(tool).toBeDefined(); return await tool.execute(args, context) }
  const run = async (name: string, args: any, context = tc) => (await runFull(name, args, context)).output
  const worktree = (name: string, at = oid) => { const path = resolve(base, name); git(dir, 'worktree', 'add', '--detach', path, at); return realpathSync(path) }
  const advance = (cwd: string) => { git(cwd, '-c', 'user.email=fixture@example.com', '-c', 'user.name=fixture', 'commit', '--allow-empty', '-m', 'advance'); return git(cwd, 'rev-parse', 'HEAD') }
  return { base, dir, wt, oid, tools, agents, hooks, sessions, calls, controls, owner, tc, input, run, runFull, worktree, advance, ctx }
}

test('tool descriptions freeze the calling contract', async () => {
  const { tools } = await registration()
  const start = tools.get('crew_task_start').description
  expect(start).toContain('主 worktree 根目录的 Root 会话')
  expect(start).toContain('active 与 closed 任务历史中全局唯一')
  expect(start).toContain('相同 key、相同输入返回原记录')
  expect(start).toContain('重试必须换新的 key')
  expect(start).toContain('最多保留 2 个未结案写入预留')
  expect(start).toContain('idle、出错和 stop 均不释放')
  expect(start).toContain('不是操作系统级隔离')

  const status = tools.get('crew_task_status').description
  expect(status).toContain('不能查询其他 Root 的任务')
  expect(status).toContain('只列出当前 Root 的未结案任务')
  expect(status).toContain('不含 task 字段')

  const stop = tools.get('crew_task_stop').description
  expect(stop).toContain('最多发送一次中断请求')
  expect(stop).toContain('重复调用不会再次中断')
  expect(stop).toContain('processSafety 仍为 unconfirmed')
  expect(stop).toContain('不要重试')
})

test('capacity refusal stops dispatch and points to offline plan/apply', async () => {
  const f = await fixture()
  const second = f.worktree('second'), third = f.worktree('third')
  expect((await f.run('crew_task_start', f.input)).ok).toBe(true)
  expect((await f.run('crew_task_start', { ...f.input, key: 'two', directory: second })).ok).toBe(true)
  const full = await f.runFull('crew_task_start', { ...f.input, key: 'three', directory: third })
  expect(full.output.ok).toBe(false)
  expect(full.output.error.code).toBe('CAPACITY_RESERVED')
  expect(full.output.error.message).toContain('2 个未结案')
  expect(full.output.error.nextAction).toContain('停止继续派发')
  expect(full.output.error.nextAction).toContain('plan/apply')
  expect(full.output.error.nextAction).toContain('stop')
  expect(full.content).toContain('plan/apply')
  expect(count(f, 'create')).toBe(2)
})

test('foreign-owner key reuse is an idempotency conflict, not a retry', async () => {
  const f = await fixture()
  await f.run('crew_task_start', f.input)
  f.sessions.set('other', { id: 'other', agent: 'root', location: { directory: f.dir }, model: { providerID: 'other', id: 'model' } })
  const result: any = await f.run('crew_task_start', f.input, { ...f.tc, sessionID: 'other' })
  expect(result.ok).toBe(false)
  expect(result.error.code).toBe('IDEMPOTENCY_CONFLICT')
  expect(result.error.nextAction).toContain('不要原样重试')
  expect(result.error.nextAction).toContain('新 key')
  expect(count(f, 'create')).toBe(1)
})

test('baseline failures expose the failing comparison and full OIDs only', async () => {
  const primaryHead = await fixture()
  const advanced = primaryHead.advance(primaryHead.dir)
  const a: any = await primaryHead.run('crew_task_start', primaryHead.input)
  expect(a.error.code).toBe('BASELINE_MISMATCH')
  expect(a.error.details).toEqual({ baseline: primaryHead.oid, primaryHead: advanced, reason: 'primary_head' })

  const worktreeHead = await fixture()
  const targetAdvanced = worktreeHead.advance(worktreeHead.wt)
  const b: any = await worktreeHead.run('crew_task_start', worktreeHead.input)
  expect(b.error.code).toBe('BASELINE_MISMATCH')
  expect(b.error.details).toEqual({ baseline: worktreeHead.oid, worktreeHead: targetAdvanced, reason: 'worktree_head' })

  const ledger = await fixture()
  await ledger.run('crew_task_start', ledger.input)
  const next = ledger.advance(ledger.dir)
  const other = ledger.worktree('next', next)
  const c: any = await ledger.run('crew_task_start', { ...ledger.input, key: 'two', directory: other, baseline: next })
  expect(c.error.code).toBe('BASELINE_MISMATCH')
  expect(c.error.details).toEqual({ baseline: next, ledgerBaseline: ledger.oid, reason: 'ledger_baseline' })

  const invalid = await fixture()
  const d: any = await invalid.run('crew_task_start', { ...invalid.input, baseline: '0'.repeat(64) })
  expect(d.error.code).toBe('BASELINE_MISMATCH')
  expect(d.error.details).toEqual({ baseline: '0'.repeat(64), reason: 'invalid_oid' })

  for (const result of [a, b, c, d]) {
    expect(Object.keys(result.error.details).every(key => ['baseline', 'primaryHead', 'worktreeHead', 'ledgerBaseline', 'reason'].includes(key))).toBe(true)
    expect(JSON.stringify(result.error.details)).not.toContain('fatal')
    expect(JSON.stringify(result.error.details)).not.toContain('private-goal')
  }
})

test('status hides foreign and missing tasks; stop reports TASK_NOT_FOUND and denial propagates', async () => {
  const f = await fixture()
  await f.run('crew_task_start', f.input)
  f.sessions.set('other', { id: 'other', agent: 'root', location: { directory: f.dir }, model: { providerID: 'other', id: 'model' } })
  const foreign: any = await f.run('crew_task_status', { taskID: 'ct_one' }, { ...f.tc, sessionID: 'other' })
  expect(foreign.ok).toBe(true)
  expect(foreign.task).toBeUndefined()
  expect(JSON.stringify(foreign)).not.toContain('private-goal')
  const missing: any = await f.run('crew_task_status', { taskID: 'ct_missing' })
  expect(missing.ok).toBe(true)
  expect(missing.task).toBeUndefined()
  const interrupts = count(f, 'interrupt')
  const stop: any = await f.run('crew_task_stop', { taskID: 'ct_missing' })
  expect(stop.ok).toBe(false)
  expect(stop.error.code).toBe('TASK_NOT_FOUND')
  expect(stop.error.nextAction).toContain('不要重试')
  expect(count(f, 'interrupt')).toBe(interrupts)
  f.controls.deny = 'crew_task_stop'
  await expect(f.run('crew_task_stop', { taskID: 'ct_one' })).rejects.toThrow('permission denied')
})

test('unconfirmed start keeps the reservation and never advises a new key', async () => {
  const f = await fixture()
  f.controls.promptLost = true
  const first = await f.runFull('crew_task_start', f.input)
  expect(first.output.ok).toBe(false)
  expect(first.output.error.code).toBe('START_UNCONFIRMED')
  expect(first.output.error.nextAction).toContain('status')
  expect(first.output.error.nextAction).toContain('不要换 key 重派')
  expect(JSON.stringify(first)).not.toContain('secret host body')
  expect(first.content).not.toContain('secret host body')
  const replay: any = await f.run('crew_task_start', f.input)
  expect(replay.task.state).toBe('start_unconfirmed')
  expect(count(f, 'create')).toBe(1)
  expect(count(f, 'prompt')).toBe(1)
  const status: any = await f.run('crew_task_status', {})
  expect(status.tasks).toHaveLength(1)

  const g = await fixture()
  const create = g.ctx.session.create
  g.ctx.session.create = async (x: any) => { const s = await create(x); s.agent = 'wrong'; return s }
  const mismatch: any = await g.run('crew_task_start', g.input)
  expect(mismatch.error.code).toBe('SESSION_MISMATCH')
  expect(mismatch.error.nextAction).toContain('不要换 key 重派')
})

test('default prompts assume no slot command and no /tmp ban', async () => {
  const f = await fixture()
  await f.run('crew_task_start', f.input)
  const engineer = f.agents.get('engineer').system
  expect(engineer).not.toContain('/tmp')
  expect(engineer).not.toContain('slot')
  const prompt = f.calls.find(c => c[0] === 'prompt')[1].text
  expect(prompt).not.toContain('/tmp')
  expect(prompt).not.toContain('slot')
  expect(prompt).toContain('禁止 commit')
  expect(prompt).toContain('Report:')
})

test('engineerInstructions reach only the engineer system, once, after family appendices', async () => {
  const rules = ['临时和中间文件放在项目内，禁止使用 /tmp；子进程同样遵守。', '重活先执行 slot audit 和 slot status 并记录项目日志，再按项目规定通过 slot 提交。']
  const f = await fixture({ models: { engineer: 'openai/gpt-4o' }, engineerInstructions: rules })
  await f.run('crew_task_start', f.input)
  const engineer = f.agents.get('engineer').system
  expect(engineer.split('## 项目补充规则')).toHaveLength(2)
  expect(engineer.split(rules[0])).toHaveLength(2)
  expect(engineer).toContain(rules[1])
  expect(engineer.indexOf('## 附录')).toBeLessThan(engineer.indexOf('## 项目补充规则'))
  for (const id of ['root', 'architect', 'explorer', 'reviewer']) expect(f.agents.get(id).system).not.toContain('## 项目补充规则')
  const create = f.calls.find(c => c[0] === 'create')[1]
  expect(create.agent).toBe('engineer')
  const prompt = f.calls.find(c => c[0] === 'prompt')[1].text
  expect(prompt).not.toContain('项目补充规则')
  expect(prompt).not.toContain(rules[0])
  expect(prompt).not.toContain(rules[1])
})

test('invalid engineerInstructions fail before any registration', async () => {
  const cases: any[] = [
    { engineerInstructions: 'x' },
    { engineerInstructions: ['  '] },
    { engineerInstructions: [1] },
    { engineerInstructions: ['line one\nline two'] },
    { engineerInstructions: ['trailing newline\n'] },
    { engineerInstructions: ['\rcarriage return'] },
    { engineerInstructions: ['a'.repeat(2001)] },
    { engineerInstructions: Array.from({ length: 33 }, () => 'a') },
    { engineerInstructions: Array.from({ length: 5 }, () => 'a'.repeat(1700)) },
    { engineerInstructions: [], unknownField: true },
  ]
  for (const options of cases) {
    const tools = new Map<string, any>(), agents = new Map<string, any>()
    const ctx: any = {
      options, location: { directory: process.cwd() },
      agent: { transform: async (fn: any) => fn({ update: (id: string, f: any) => { agents.set(id, f({ id, permissions: [] })) } }) },
      command: { transform: async (fn: any) => fn({ add: () => {} }) },
      tool: { transform: async (fn: any) => fn({ add: (t: any) => tools.set(t.name, t) }) },
      session: { hook: async () => ({ dispose: async () => {} }) },
    }
    await expect(plugin.setup(ctx)).rejects.toThrow('opencode-crew')
    expect(agents.size).toBe(0)
    expect(tools.size).toBe(0)
  }
  const omitted = await registration({})
  const empty = await registration({ engineerInstructions: [] })
  expect(empty.agents.get('engineer').system).toBe(omitted.agents.get('engineer').system)
  expect(empty.agents.get('engineer').system).not.toContain('## 项目补充规则')
})

test('error output never includes host exception bodies', async () => {
  const f = await fixture()
  f.controls.createLost = true
  const created = await f.runFull('crew_task_start', f.input)
  expect(created.output.error.code).toBe('START_UNCONFIRMED')
  expect(JSON.stringify(created)).not.toContain('secret host body')
  const g = await fixture()
  await g.run('crew_task_start', g.input)
  g.controls.getError = 'child'
  const status = await g.runFull('crew_task_status', {})
  expect(status.output.ok).toBe(true)
  expect(status.output.tasks[0].observed.errorCode).toBe('HOST_ERROR')
  expect(JSON.stringify(status)).not.toContain('secret host body')
})
