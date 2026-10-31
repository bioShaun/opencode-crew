import { test, expect } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const cli = resolve(import.meta.dir, '../src/maintenance-cli.ts')
const tmp = resolve(import.meta.dir, '.work/tmp')
mkdirSync(tmp, { recursive: true })
const runCli = (...args: string[]) => spawnSync('bun', [cli, ...args], { encoding: 'utf8', env: { ...process.env, TMPDIR: tmp }, timeout: 20000 })

test('help subcommand prints usage to stdout and exits 0', () => {
  for (const arg of ['help', '--help']) {
    const r = runCli(arg)
    expect(r.status).toBe(0)
    expect(r.signal).toBeNull()
    expect(r.stdout).toContain('plan <operation.json>')
    expect(r.stdout).toContain('apply <plan.json>')
  }
})

test('invalid subcommand still exits 2 with INVALID_INPUT', () => {
  const r = runCli('bogus')
  expect(r.status).toBe(2)
  const parsed = JSON.parse(r.stdout)
  expect(parsed.ok).toBe(false)
  expect(parsed.error.code).toBe('INVALID_INPUT')
})
