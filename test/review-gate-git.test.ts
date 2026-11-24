import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { join, parse } from "node:path"
import { defaultReviewGate } from "../src/config"
import { evaluateGate } from "../src/review-gate"
import { collectNativeChanges, fromReviewListing, snapshotNative } from "../src/review-gate-git"
import { reviewTask } from "../src/tasks-review"
import { WORK } from "./workdir"

// Same real-repo/worktree setup as tasks-review.test.ts, kept independent of its top-level hooks.
const base = join(WORK, "review-gate")
const git = (cwd: string, ...args: string[]) => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")))
  const result = spawnSync("git", ["-c", "core.fsmonitor=false", ...args], { cwd, env: { ...env, TMPDIR: base }, encoding: "utf8" })
  if (result.status !== 0) throw new Error(`fixture git ${args.join(" ")}: ${result.stderr}`)
  return result.stdout.trimEnd()
}

function repo(run: (dir: string, head: string, parent: string) => void) {
  mkdirSync(base, { recursive: true })
  const parent = mkdtempSync(join(base, "repo-"))
  const dir = join(parent, "primary")
  mkdirSync(dir)
  try {
    git(dir, "init")
    git(dir, "config", "user.email", "test@example.com")
    git(dir, "config", "user.name", "Test")
    for (const name of ["original.test.ts", "modify", "remove"]) writeFileSync(join(dir, name), name)
    writeFileSync(join(dir, ".gitignore"), "ignored/\n")
    git(dir, "add", ".")
    git(dir, "commit", "-m", "base")
    run(dir, git(dir, "rev-parse", "HEAD"), parent)
  } finally { rmSync(parent, { recursive: true, force: true }) }
}

test("native status classifies staged, unstaged, untracked and rename paths without quoting", () => repo((dir, head) => {
  git(dir, "mv", "original.test.ts", "renamed\tfile.ts")
  writeFileSync(join(dir, "modify"), "modified bytes")
  rmSync(join(dir, "remove"))
  writeFileSync(join(dir, "added"), "stage")
  git(dir, "add", "added")
  writeFileSync(join(dir, "untracked\nfile"), "new")
  const result = collectNativeChanges(dir)
  expect(result).toMatchObject({ status: "available", head, complete: true, degraded: true })
  expect(Object.fromEntries(result.files.map(f => [f.path, f.type]))).toEqual({
    "original.test.ts": "deleted", "renamed\tfile.ts": "renamed", modify: "modified", remove: "deleted", added: "added", "untracked\nfile": "added",
  })
  expect(result.latestChangeAt).toBe(Math.max(...["renamed\tfile.ts", "modify", "added", "untracked\nfile"].map(p => lstatSync(join(dir, p)).mtimeMs)))
}))

test("native baseline snapshots mtime and size, filters existing dirt and retains later modifications", () => repo((dir, head) => {
  writeFileSync(join(dir, "modify"), "already dirty")
  writeFileSync(join(dir, "prior"), "old untracked")
  rmSync(join(dir, "remove"))
  const baseline = snapshotNative(dir)
  const prior = lstatSync(join(dir, "prior"))
  expect(baseline?.head).toBe(head)
  expect([...(baseline?.files.values() ?? [])]).toContain(`${prior.size}:${prior.mtimeMs}`)
  writeFileSync(join(dir, "modify"), "actually edited later")
  const result = collectNativeChanges(dir, { baseline })
  expect(result).toMatchObject({ status: "available", complete: true, degraded: false, files: [{ path: "modify", type: "modified" }] })
  expect(result.latestChangeAt).toBe(lstatSync(join(dir, "modify")).mtimeMs)
  if (result.status === "available") expect(collectNativeChanges(dir, { baseline: result.snapshot }).files).toEqual([])
}))

test("native HEAD drift adds committed changes including deleted files and deduplicates overlaps", () => repo((dir) => {
  const baseline = snapshotNative(dir)
  expect(baseline).toBeDefined()
  writeFileSync(join(dir, "modify"), "committed")
  git(dir, "rm", "remove")
  git(dir, "add", "modify")
  git(dir, "commit", "-m", "change HEAD")
  writeFileSync(join(dir, "modify"), "then edit again")
  const result = collectNativeChanges(dir, { baseline })
  expect(result).toMatchObject({ status: "available", complete: true, head: git(dir, "rev-parse", "HEAD") })
  expect(result.files).toHaveLength(2)
  expect(result.files).toEqual(expect.arrayContaining([expect.objectContaining({ path: "modify", type: "modified" }), expect.objectContaining({ path: "remove", type: "deleted" })]))
}))

test("baseline clears a staged deletion whose path was also recreated as untracked", () => repo(dir => {
  git(dir, "rm", "remove")
  writeFileSync(join(dir, "remove"), "recreated")
  const before = collectNativeChanges(dir)
  expect(before.files.filter(f => f.path === "remove").map(f => f.type).sort()).toEqual(["added", "deleted"])
  const baseline = snapshotNative(dir)
  expect(collectNativeChanges(dir, { baseline }).files).toEqual([])
}))

test("R1 editing a recreated test after the baseline does not repeat its staged deletion", () => repo(dir => {
  mkdirSync(join(dir, "test"))
  const path = "test/a.ts", fullPath = join(dir, path)
  writeFileSync(fullPath, "tracked test")
  git(dir, "add", path)
  git(dir, "commit", "-m", "track a test")
  git(dir, "rm", path)
  mkdirSync(join(dir, "test"), { recursive: true })
  writeFileSync(fullPath, "recreated")
  const baseline = snapshotNative(dir)
  expect(baseline).toBeDefined()
  expect(collectNativeChanges(dir, { baseline }).files).toEqual([])
  writeFileSync(fullPath, "edit just the recreated file")
  const { size, mtimeMs } = lstatSync(fullPath)
  const result = collectNativeChanges(dir, { baseline })
  expect(result).toMatchObject({ status: "available", complete: true, latestChangeAt: mtimeMs })
  expect(evaluateGate(result, defaultReviewGate).reasons.map(reason => reason.rule)).not.toContain("deletedTest")
  expect(result.files).toEqual([{ path, type: "added", token: `${size}:${mtimeMs}` }])
}))

test("R2 HEAD drift from a subdirectory is root-relative even with diff.relative enabled", () => repo(dir => {
  const sub = join(dir, "sub")
  mkdirSync(sub)
  writeFileSync(join(sub, "inside.txt"), "initial inside")
  writeFileSync(join(dir, "root.txt"), "initial outside")
  git(dir, "add", ".")
  git(dir, "commit", "-m", "track both sides")
  git(dir, "config", "diff.relative", "true")
  const baseline = snapshotNative(sub)
  expect(baseline).toBeDefined()
  writeFileSync(join(sub, "inside.txt"), "commit inside")
  writeFileSync(join(dir, "root.txt"), "commit outside")
  git(dir, "commit", "-am", "move HEAD")
  const result = collectNativeChanges(sub, { baseline })
  expect(result.files.map(({ path, type }) => [path, type]).sort()).toEqual([["root.txt", "modified"], ["sub/inside.txt", "modified"]])
  expect(result).toMatchObject({ status: "available", complete: true, degraded: false, head: git(dir, "rev-parse", "HEAD") })
}))

test("native git handles subdirectory cwd, ignores gitignored paths and strips inherited GIT_*", () => repo((dir, head) => {
  const nested = join(dir, "src")
  mkdirSync(nested)
  mkdirSync(join(dir, "ignored"))
  writeFileSync(join(nested, "fresh"), "check")
  writeFileSync(join(dir, "ignored", "secret"), "not listed")
  const old = process.env.GIT_DIR
  process.env.GIT_DIR = join(dir, "nonexistent")
  try {
    expect(collectNativeChanges(nested)).toMatchObject({ status: "available", complete: true, head, files: [{ path: "src/fresh", type: "added" }] })
  } finally {
    if (old === undefined) delete process.env.GIT_DIR
    else process.env.GIT_DIR = old
  }
}))

test("native status consumes the source field of a copy record without reporting a deletion", () => repo((dir, _head, parent) => {
  const bin = join(parent, "bin")
  mkdirSync(bin)
  renameSync(join(dir, "remove"), join(dir, "first-copy"))
  copyFileSync(join(dir, "first-copy"), join(dir, "second-copy"))
  git(dir, "add", "-A")
  git(dir, "config", "status.renames", "copies")
  const porcelain = git(dir, "status", "--porcelain=v1", "-z", "--untracked-files=all")
  const copy = porcelain.split("\0").find(record => record.startsWith("C  "))
  expect(copy).toBeDefined()
  // The production --renames flag overrides copy detection. Replay real copy-mode
  // output for the status calls to exercise the defensive parser branch.
  writeFileSync(join(bin, "status"), porcelain)
  const realGit = Bun.which("git")
  expect(realGit).not.toBeNull()
  writeFileSync(join(bin, "git"), `#!/bin/sh
if [ "$3" = status ]; then exec cat ${JSON.stringify(join(bin, "status"))}; fi
exec ${JSON.stringify(realGit)} "$@"
`, { mode: 0o755 })
  const old = process.env.PATH
  process.env.PATH = `${bin}:${old}`
  try {
    const result = collectNativeChanges(dir)
    expect(result).toMatchObject({ status: "available", complete: true })
    expect(result.files.map(({ path, type }) => [path, type]).sort()).toEqual([
      ["first-copy", copy === "C  first-copy" ? "added" : "renamed"],
      ["remove", "deleted"], // The rename, not the copy, deletes the original.
      ["second-copy", copy === "C  second-copy" ? "added" : "renamed"],
    ])
  } finally {
    if (old === undefined) delete process.env.PATH
    else process.env.PATH = old
  }
}))

test("native status treats an unmerged UU record as unknown", () => repo((dir, head) => {
  writeFileSync(join(dir, "modify"), "ours\n")
  git(dir, "commit", "-am", "ours")
  const ours = git(dir, "rev-parse", "HEAD")
  git(dir, "checkout", "--detach", head)
  writeFileSync(join(dir, "modify"), "theirs\n")
  git(dir, "commit", "-am", "theirs")
  expect(spawnSync("git", ["merge", ours], { cwd: dir }).status).toBe(1)
  expect(git(dir, "status", "--porcelain=v1")).toContain("UU modify")
  expect(collectNativeChanges(dir)).toMatchObject({ status: "available", complete: true, files: [{ path: "modify", type: "unknown" }] })
}))

test("an existing directory outside any git repo is unavailable, not an empty successful listing", () => {
  // WORK is usually inside the source checkout; Git searches parent directories.
  const outside = parse(import.meta.dir).root
  expect(lstatSync(outside).isDirectory()).toBe(true)
  expect(collectNativeChanges(outside)).toMatchObject({ status: "unavailable", complete: false, files: [] })
  expect(snapshotNative(outside)).toBeUndefined()
})

test("tiny git timeout fails open with an unavailable native result", () => repo(dir => {
  expect(collectNativeChanges(dir, { timeoutMs: 1 })).toMatchObject({ status: "unavailable", complete: false, files: [] })
}))

test("task listing adapter keeps failures and outsideScope but drops excluded entries", () => repo((dir, baseline, parent) => {
  const target = join(parent, "target")
  git(dir, "worktree", "add", "--detach", target, baseline)
  git(target, "mv", "original.test.ts", "renamed.ts")
  writeFileSync(join(target, ".env"), "excluded")
  const listing = reviewTask({ primaryDirectory: dir, directory: target, taskID: "ct_fixture", baseline, scope: ["original.test.ts"] })
  expect(listing.entries.some(e => e.path === ".env" && e.status === "excluded")).toBe(true)
  const result = fromReviewListing(target, { ...listing, completeness: "changed" })
  expect(result).toMatchObject({ source: "task", taskID: "ct_fixture", dir: target, head: baseline, outsideScope: listing.counts.outsideScope, complete: false, completeness: "changed" })
  expect(result.files).toEqual([
    expect.objectContaining({ path: "original.test.ts", type: "deleted" }),
    expect.objectContaining({ path: "renamed.ts", type: "renamed", token: listing.entries.find(e => e.path === "renamed.ts")?.sha256 }),
  ])
  expect(fromReviewListing(target, listing).complete).toBe(true)
}))
