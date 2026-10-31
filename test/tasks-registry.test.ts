import { expect, test } from "bun:test"
import { existsSync, mkdirSync, realpathSync, symlinkSync } from "node:fs"
import { resolve } from "node:path"
import { spawnSync } from "node:child_process"

// A callable fallback makes a missing implementation fail on behavior, not import.
const entry = new URL("../src/tasks-registry.ts", import.meta.url)
const registry: any = existsSync(entry) ? await import(entry.href) : {
  normalizeScope: (_directory: string, scope: string[]) => scope,
}
const root = resolve(import.meta.dir, "..")
const work = resolve(import.meta.dir, ".work/tasks-registry/scope-fixture")
const primary = resolve(work, "primary")
const target = resolve(work, "target")
mkdirSync(work, { recursive: true })
function git(...args: string[]) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", env: { ...process.env, TMPDIR: resolve(root, "test/.work/tasks-registry/tmp"), GIT_OPTIONAL_LOCKS: "0" } })
  if (result.status !== 0) throw new Error(`fixture git failed: ${result.stderr}`)
  return result.stdout.trim()
}
if (!existsSync(primary)) {
  git("clone", "--no-local", "--no-checkout", root, primary)
  const oid = git("rev-parse", "HEAD")
  git("-C", primary, "checkout", "--detach", oid)
  git("-C", primary, "worktree", "add", "--detach", target, oid)
}
const outside = resolve(work, "outside")
mkdirSync(outside, { recursive: true })
if (!existsSync(resolve(target, "outside-link"))) symlinkSync(outside, resolve(target, "outside-link"))
if (!existsSync(resolve(target, "inside-link"))) symlinkSync(resolve(target, "src"), resolve(target, "inside-link"))

test("scope normalizes exact paths and rejects traversal and sensitive names", () => {
  expect(registry.normalizeScope(realpathSync(target), ["src/index.ts", "agents/", "src/index.ts"])).toEqual(["agents/", "src/index.ts"])
  for (const path of ["../outside", "/etc/passwd", "a/./b", "a/.git/config", ".env", "src/.ssh/key", "node_modules/pkg", "a/*.ts"]) {
    expect(() => registry.normalizeScope(realpathSync(target), [path])).toThrow()
  }
})

test("scope rejects an existing symlink even for a nonexistent descendant", () => {
  expect(() => registry.normalizeScope(realpathSync(target), ["outside-link/not-yet-created"])).toThrow()
  expect(() => registry.normalizeScope(realpathSync(target), ["inside-link/not-yet-created"])).toThrow()
})

test("scope validates count, types and bounded path length", () => {
  for (const value of [[], Array(33).fill("src/a"), [""], [42], ["x".repeat(4097)], "src/a"]) {
    expect(() => registry.normalizeScope(target, value)).toThrow()
  }
  expect(registry.normalizeScope(target, Array.from({ length: 32 }, (_, i) => `new/file${i}`))).toHaveLength(32)
})

test("scope rejects unsafe path components and glob syntax", () => {
  for (const path of [".", "..", "src/../a", "src//a", "src\\a", "src/\0x", "a/?", "a/[ab]", "a/{x,y}", "a/.git", ".env.local", "a/.env.production", ".ssh/key", ".gnupg/x", ".cache/x", ".venv/x", "a/node_modules/x"]) {
    expect(() => registry.normalizeScope(target, [path])).toThrow()
  }
})

test("scope preserves file versus directory prefix and permits safe missing paths", () => {
  expect(registry.normalizeScope(target, ["z/new/file", ".env.example", "src/", "src/index.ts", "src/"])).toEqual([".env.example", "src/", "src/index.ts", "z/new/file"])
})

test("scope validates root and nearest existing parents", () => {
  expect(() => registry.normalizeScope(resolve(work, "missing-root"), ["a"])).toThrow()
  expect(() => registry.normalizeScope(resolve(target, "src/index.ts"), ["a"])).toThrow()
  expect(() => registry.normalizeScope(target, ["src/index.ts/child"])).toThrow()
  expect(registry.normalizeScope(target, ["not-existing/deeper/file"])).toEqual(["not-existing/deeper/file"])
})
