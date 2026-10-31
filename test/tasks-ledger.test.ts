import { test, expect } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, symlinkSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { spawn } from "node:child_process"

const work = resolve(import.meta.dir, ".work/tasks-ledger")
mkdirSync(work, { recursive: true })
const modulePath = resolve(import.meta.dir, "../src/tasks-ledger.ts")
const mod: any = existsSync(modulePath) ? await import(modulePath) : {}
function fixture() {
  const dir = mkdtempSync(join(work, "case-"))
  const registry = mod.AtomicRegistry ? new mod.AtomicRegistry(dir, { primaryDirectory: dir, commonDir: dir }) : undefined
  return { dir, registry, base: join(dir, "opencode-crew-stage1") }
}
function code(fn: () => unknown, expected: string) {
  try { fn(); throw new Error("operation unexpectedly succeeded") } catch (e: any) { expect(e.code).toBe(expected) }
}

test("atomic registry reads and writes JSON with private modes", () => {
  const { registry, base } = fixture()
  expect(typeof registry?.withLock).toBe("function")
  expect(registry.read()).toBeUndefined()
  registry.withLock((store: any) => { expect(store.read()).toBeUndefined(); store.write({ value: 1 }) })
  expect(registry.read()).toEqual({ value: 1 })
  expect(statSync(base).mode & 0o777).toBe(0o700)
  expect(statSync(join(base, "registry.json")).mode & 0o777).toBe(0o600)
})

test("invalid JSON, oversized and symlink registry fail closed", () => {
  const { registry, base, dir } = fixture()
  expect(typeof registry?.withLock).toBe("function")
  registry.withLock((s: any) => s.write({ ok: true }))
  const file = join(base, "registry.json")
  writeFileSync(file, "{")
  code(() => registry.read(), "REGISTRY_INVALID")
  code(() => registry.withLock((s: any) => s.write({ reset: true })), "REGISTRY_INVALID")
  expect(readFileSync(file, "utf8")).toBe("{")
  writeFileSync(file, '"' + 'a'.repeat(1024 * 1024) + '"')
  code(() => registry.read(), "REGISTRY_INVALID")
  const { unlinkSync } = require("node:fs")
  unlinkSync(file); symlinkSync(join(dir, "target"), file)
  code(() => registry.read(), "REGISTRY_INVALID")
  code(() => registry.withLock((s: any) => s.write({})), "REGISTRY_INVALID")
})

test("base symlink and lock symlink are rejected", () => {
  const a = fixture(); expect(typeof a.registry?.withLock).toBe("function")
  mkdirSync(join(a.dir, "target")); symlinkSync(join(a.dir, "target"), a.base)
  code(() => a.registry.read(), "REGISTRY_INVALID")
  const b = fixture(); b.registry.withLock(() => {})
  symlinkSync(join(b.dir, "target"), join(b.base, ".lock"))
  expect(() => b.registry.withLock(() => {})).toThrow()
})

test("independent process holds lock until killed; stale lock remains while reads work", async () => {
  const { registry, dir, base } = fixture(); expect(typeof registry?.withLock).toBe("function")
  registry.withLock((s: any) => s.write({ durable: true }))
  const ready = join(dir, "ready")
  const script = join(dir, "holder.ts")
  writeFileSync(script, `import { AtomicRegistry } from ${JSON.stringify(modulePath)}; import { writeFileSync } from "node:fs"; const d=process.argv[2]; new AtomicRegistry(d,{primaryDirectory:d,commonDir:d}).withLock(()=>{writeFileSync(process.argv[3],"ready"); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,30000)})`)
  const child = spawn(process.execPath, [script, dir, ready], { env: { PATH: process.env.PATH, TMPDIR: work }, stdio: "ignore" })
  const exited = new Promise<void>(resolve => child.once("exit", () => resolve()))
  try {
    const deadline = Date.now() + 5000
    while (!existsSync(ready) && Date.now() < deadline && child.exitCode === null) await Bun.sleep(10)
    expect(existsSync(ready)).toBe(true)
    expect(registry.read()).toEqual({ durable: true })
    code(() => registry.withLock(() => {}), "REGISTRY_LOCKED")
    child.kill("SIGKILL")
    await exited
    expect(existsSync(join(base, ".lock"))).toBe(true)
    code(() => registry.withLock(() => {}), "REGISTRY_LOCKED")
    expect(registry.read()).toEqual({ durable: true })
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL") }
})
