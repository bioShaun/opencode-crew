import { test, expect } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import * as api from '../src/tasks-registry'
const base = resolve('test/.work/tasks-git'), primary = resolve(base, 'primary'), target = resolve(base, 'target')
const env = { ...process.env, TMPDIR: resolve(base, 'tmp'), GIT_OPTIONAL_LOCKS: '0' }
function git(...args: string[]) { const r = spawnSync('git', args, { cwd: process.cwd(), env, encoding: 'utf8' }); if (r.status !== 0) throw Error('fixture git failed'); return r.stdout.trim() }
rmSync(primary, { recursive: true, force: true }); rmSync(target, { recursive: true, force: true }); mkdirSync(base, { recursive: true })
const oid = git('rev-parse', 'HEAD')
git('clone', '--no-local', '--no-checkout', process.cwd(), primary); git('-C', primary, 'checkout', '--detach', oid); git('-C', primary, 'worktree', 'add', '--detach', target, oid)
const inspect = (api as any).inspectProject ?? (() => null)
const validate = (api as any).validateWorktree ?? (() => null)
function code(fn: () => unknown, expected: string) { try { fn(); throw Error('accepted invalid input') } catch (e: any) { expect(e.code).toBe(expected) } }
test('real registered detached clean worktree returns canonical identity', () => {
 const project = inspect(primary); expect(project.primaryDirectory).toBe(realpathSync(primary)); expect(project.commonDir).toBe(realpathSync(resolve(primary, '.git')))
 expect(validate(primary, target, oid, ['src/index.ts', 'agents/', 'src/index.ts'])).toEqual({ primaryDirectory: realpathSync(primary), directory: realpathSync(target), commonDir: project.commonDir, baseline: oid, scope: ['agents/', 'src/index.ts'] })
})
test('rejects dirty primary and target, baseline mismatch and invalid identity', () => {
 writeFileSync(resolve(primary, 'untracked-test'), 'x'); code(() => validate(primary, target, oid, ['src/']), 'DIRTY_PRIMARY'); rmSync(resolve(primary, 'untracked-test'))
 writeFileSync(resolve(target, 'untracked-test'), 'x'); code(() => validate(primary, target, oid, ['src/']), 'DIRTY_WORKTREE'); rmSync(resolve(target, 'untracked-test'))
 code(() => validate(primary, target, '0'.repeat(40), ['src/']), 'BASELINE_MISMATCH')
 code(() => validate(primary, primary, oid, ['src/']), 'PROJECT_MISMATCH')
 code(() => inspect(resolve(primary, 'src')), 'PROJECT_MISMATCH')
})
test('inherited Git location variables cannot redirect checks', () => {
 const old = process.env.GIT_DIR; process.env.GIT_DIR = resolve(base, 'nonexistent')
 try { expect(validate(primary, target, oid, ['src/']).baseline).toBe(oid) } finally { if (old === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = old }
})
test('attached target and unsafe scope rejected', () => {
 git('-C', target, 'checkout', '-b', 'fixture-branch'); code(() => validate(primary, target, oid, ['src/']), 'PROJECT_MISMATCH'); git('-C', target, 'checkout', '--detach', oid)
 code(() => validate(primary, target, oid, ['../escape']), 'INVALID_SCOPE')
})
test('identity ignores inherited work tree and index overrides', () => {
 const saved = [process.env.GIT_WORK_TREE, process.env.GIT_INDEX_FILE]
 process.env.GIT_WORK_TREE = resolve(base, 'wrong'); process.env.GIT_INDEX_FILE = resolve(base, 'wrong-index')
 try { expect(validate(primary, target, oid, ['src/']).directory).toBe(realpathSync(target)) } finally {
  for (const [i, k] of ['GIT_WORK_TREE', 'GIT_INDEX_FILE'].entries()) { if (saved[i] === undefined) delete process.env[k]; else process.env[k] = saved[i] }
 }
})
test('tracked changes, staged changes and deletions fail closed', () => {
 const file = resolve(primary, 'README.md')
 writeFileSync(file, 'changed'); code(() => validate(primary, target, oid, ['src/']), 'DIRTY_PRIMARY')
 git('-C', primary, 'add', '--', 'README.md'); code(() => validate(primary, target, oid, ['src/']), 'DIRTY_PRIMARY')
 git('-C', primary, 'reset', '--hard', oid); rmSync(file); code(() => validate(primary, target, oid, ['src/']), 'DIRTY_PRIMARY'); git('-C', primary, 'reset', '--hard', oid)
})
test('rejects unregistered project and abbreviated baseline', () => {
 code(() => validate(primary, process.cwd(), oid, ['src/']), 'PROJECT_MISMATCH')
 code(() => validate(primary, target, oid.slice(0, 8), ['src/']), 'BASELINE_MISMATCH')
})
test('real oversized status output fails closed for primary and target', () => {
 const limit = 1024 * 1024
 for (const directory of [primary, target]) {
  const fixture = resolve(directory, 'overflow-fixture')
  try {
   mkdirSync(fixture)
   for (let i = 0; i < 5000; i++) writeFileSync(resolve(fixture, `${String(i).padStart(5, '0')}-${'x'.repeat(200)}`), '')
   const result = spawnSync('git', ['-c', 'core.fsmonitor=false', 'status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: directory, env, maxBuffer: 4 * limit })
   expect(result.error).toBeUndefined(); expect(result.status).toBe(0)
   expect(result.stdout.length).toBeGreaterThan(limit)
   console.log(`oversized status ${directory === primary ? 'primary' : 'target'}: ${result.stdout.length} bytes > ${limit}`)
   code(() => validate(primary, target, oid, ['src/']), 'HOST_ERROR')
  } finally { rmSync(fixture, { recursive: true, force: true }) }
 }
})
