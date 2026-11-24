import { spawnSync } from "node:child_process"
import { lstatSync } from "node:fs"
import { resolve } from "node:path"
import type { ChangeFile, ChangeSet } from "./review-gate"
import type { ReviewListing } from "./tasks-review"

/** Dirty-record tokens keyed by `path\0type`; a path can have multiple records. */
export interface NativeSnapshot { head: string; files: ReadonlyMap<string, string> }
export interface NativeOptions { baseline?: NativeSnapshot; timeoutMs?: number }
export type NativeChanges = ChangeSet & { source: "native" } & (
  | { status: "available"; head: string; snapshot: NativeSnapshot }
  | { status: "unavailable"; complete: false }
)

type ChangeType = ChangeFile["type"]
const recordKey = ({ path, type }: ChangeFile) => `${path}\0${type}`
const conflicts = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"])
const oid = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/
const deletedToken = "deleted"

function records(text: string): string[] {
  if (!text) return []
  if (!text.endsWith("\0")) throw new Error("incomplete git output")
  return text.slice(0, -1).split("\0")
}

function gitPath(path: string): string {
  if (!path || path.split("/").some(p => !p || p === "." || p === "..")) throw new Error("invalid git path")
  return path
}

function statusFiles(text: string): ChangeFile[] {
  const entries = records(text), files: ChangeFile[] = []
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i], xy = entry.slice(0, 2), path = gitPath(entry.slice(3))
    if (entry[2] !== " ") throw new Error("invalid status record")
    if (xy.includes("R")) {
      files.push({ path: gitPath(entries[++i]), type: "deleted" }, { path, type: "renamed" })
      continue
    }
    if (xy.includes("C")) gitPath(entries[++i]) // Git may emit a copy source; it's not a deletion.
    const type: ChangeType = conflicts.has(xy) ? "unknown" : xy.includes("D") ? "deleted"
      : xy === "??" || /[AC]/.test(xy) ? "added" : /[MT]/.test(xy) ? "modified" : "unknown"
    files.push({ path, type })
  }
  return files
}

function driftFiles(text: string): ChangeFile[] {
  const fields = records(text), files: ChangeFile[] = []
  if (fields.length % 2) throw new Error("invalid name-status records")
  for (let i = 0; i < fields.length; i += 2) {
    const code = fields[i]
    const type: ChangeType = code === "D" ? "deleted" : code === "A" ? "added" : /^[MT]/.test(code) ? "modified" : "unknown"
    files.push({ path: gitPath(fields[i + 1]), type })
  }
  return files
}

export function collectNativeChanges(dir: string, { baseline, timeoutMs = 3000 }: NativeOptions = {}): NativeChanges {
  const unavailable: NativeChanges = { source: "native", dir, files: [], status: "unavailable", complete: false }
  try {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || (baseline && !oid.test(baseline.head))) return unavailable
    const started = performance.now()
    const remaining = () => {
      const ms = timeoutMs - (performance.now() - started)
      if (ms <= 0) throw new Error("git observation timed out")
      return Math.ceil(ms)
    }
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")))
    env.GIT_OPTIONAL_LOCKS = "0"
    const git = (cwd: string, ...args: string[]) => {
      const result = spawnSync("git", ["-c", "core.fsmonitor=false", ...args], {
        cwd, env, timeout: remaining(), maxBuffer: 1024 * 1024,
      })
      if (result.error || result.status !== 0 || result.signal) throw new Error("git observation failed")
      remaining()
      return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(result.stdout)
    }
    const top = git(dir, "rev-parse", "--show-toplevel").replace(/\n$/, "")
    const readHead = () => git(dir, "rev-parse", "--verify", "HEAD").trim()
    const head = readHead()
    if (!oid.test(head)) return unavailable
    const readStatus = () => git(dir, "status", "--porcelain=v1", "-z", "--untracked-files=all", "--renames")
    const status = readStatus()
    const dirty = statusFiles(status)
    const drift = baseline && baseline.head !== head
      ? driftFiles(git(top, "diff", "--name-status", "-z", "--no-renames", "--no-relative", `${baseline.head}..${head}`, "--")) : []

    let complete = true, latestChangeAt: number | undefined
    const deleted = new Set(dirty.filter(file => file.type === "deleted").map(file => file.path))
    const stats = new Map<string, { token: string; mtimeMs?: number }>()
    const stat = (path: string) => {
      remaining()
      try {
        const { size, mtimeMs } = lstatSync(resolve(top, path))
        return { token: `${size}:${mtimeMs}`, mtimeMs }
      } catch (error) {
        if (deleted.has(path) && (error as NodeJS.ErrnoException).code === "ENOENT") return { token: deletedToken }
        complete = false
        return { token: "unreadable" }
      }
    }
    const materialize = (file: ChangeFile) => {
      if (file.type === "deleted") return { token: deletedToken }
      if (!stats.has(file.path)) stats.set(file.path, stat(file.path))
      return stats.get(file.path)!
    }
    const snapshot: NativeSnapshot = { head, files: new Map(dirty.map(file => [recordKey(file), materialize(file).token])) }
    const observed = new Map<string, ChangeFile>()
    const add = (file: ChangeFile, compareBaseline: boolean) => {
      const { token, mtimeMs } = materialize(file)
      const key = recordKey(file)
      if (compareBaseline && baseline?.files.get(key) === token) return
      observed.set(key, { ...file, token })
      if (mtimeMs !== undefined) latestChangeAt = Math.max(latestChangeAt ?? -Infinity, mtimeMs)
    }
    for (const file of dirty) add(file, true)
    for (const file of drift) add(file, false)

    // This bounds obvious races; metadata is not a content snapshot.
    if (readStatus() !== status) complete = false
    for (const [path, old] of stats) if (stat(path).token !== old.token) complete = false
    if (readHead() !== head) complete = false
    return { source: "native", dir, status: "available", head, files: [...observed.values()], snapshot, complete, latestChangeAt, degraded: !baseline }
  } catch {
    return unavailable
  }
}

export function snapshotNative(dir: string, options?: Pick<NativeOptions, "timeoutMs">): NativeSnapshot | undefined {
  const changes = collectNativeChanges(dir, options)
  return changes.status === "available" && changes.complete ? changes.snapshot : undefined
}

export function fromReviewListing(dir: string, listing: ReviewListing): ChangeSet & { completeness: ReviewListing["completeness"] } {
  return {
    source: "task", dir, taskID: listing.taskID, head: listing.head?.to ?? listing.head?.from ?? listing.baseline,
    outsideScope: listing.counts.outsideScope, complete: listing.completeness === "complete", completeness: listing.completeness,
    files: listing.entries.filter(entry => entry.status !== "excluded").map(entry => {
      const change = entry.changeType
      const type = change === "untracked" ? "added"
        : change === "added" || change === "modified" || change === "deleted" || change === "renamed" ? change : "unknown"
      return { path: entry.path, type, token: entry.sha256 ?? entry.status }
    }),
  }
}
