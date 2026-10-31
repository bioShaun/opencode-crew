import { lstatSync, realpathSync, statSync } from "node:fs"
import { isAbsolute, relative, resolve, sep } from "node:path"
import { spawnSync } from "node:child_process"

export class TaskRegistryError extends Error {
  constructor(readonly code: TaskRegistryErrorCode = "INVALID_SCOPE") { super(`Task registry: ${code}`); this.name = "TaskRegistryError" }
}

/** Validate scope syntax without consulting the mutable worktree. */
export function normalizeScopeLexical(scope: string[]): string[] {
  const invalid = (): never => { throw new TaskRegistryError() }
  if (!Array.isArray(scope) || scope.length < 1 || scope.length > 32) return invalid()
  for (const item of scope) {
    if (typeof item !== "string" || !item || Buffer.byteLength(item, "utf8") > 4096 || isAbsolute(item) || /[\\\0*?\[\]{}]/.test(item)) return invalid()
    const prefix = item.endsWith("/")
    const parts = (prefix ? item.slice(0, -1) : item).split("/")
    if (parts.some(part => !part || part === "." || part === ".." || part === ".git" ||
      (part !== ".env.example" && (part === ".env" || part.startsWith(".env."))) ||
      [".ssh", ".gnupg", "node_modules", ".cache", ".venv"].includes(part))) return invalid()
  }
  return [...new Set(scope)].sort()
}

/** Validate exact relative files or directory prefixes; this is not an OS sandbox. */
export function normalizeScope(directory: string, scope: string[]): string[] {
  const invalid = (): never => { throw new TaskRegistryError() }
  const normalized = normalizeScopeLexical(scope)
  if (typeof directory !== "string" || !isAbsolute(directory)) return invalid()
  let root: string
  try { root = realpathSync(directory); if (!statSync(root).isDirectory()) return invalid() } catch { return invalid() }
  for (const item of normalized) {
    const prefix = item.endsWith("/")
    const parts = (prefix ? item.slice(0, -1) : item).split("/")

    let current = root, missing = false
    for (let i = 0; i < parts.length; i++) {
      current = resolve(current, parts[i])
      if (missing) continue
      try {
        const info = lstatSync(current)
        if (info.isSymbolicLink() || ((i < parts.length - 1 || prefix) && !info.isDirectory())) return invalid()
        const actual = realpathSync(current), rel = relative(root, actual)
        if (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) return invalid()
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") missing = true
        else return invalid()
      }
    }
  }
  return normalized
}

export type TaskRegistryErrorCode = "INVALID_INPUT" | "IDEMPOTENCY_CONFLICT" | "WRITER_RESERVED" | "CAPACITY_RESERVED" | "INVALID_SCOPE" | "PROJECT_MISMATCH" | "DIRTY_PRIMARY" | "DIRTY_WORKTREE" | "BASELINE_MISMATCH" | "HOST_ERROR" | "REGISTRY_LOCKED" | "REGISTRY_INVALID"
export interface ProjectIdentity { primaryDirectory: string; commonDir: string }
export interface ValidatedWorktree extends ProjectIdentity { directory: string; baseline: string; scope: string[] }

function fail(code: TaskRegistryErrorCode): never { throw new TaskRegistryError(code) }
function canonical(path: string): string {
  if (typeof path !== "string" || !isAbsolute(path)) return fail("PROJECT_MISMATCH")
  try { const p = realpathSync(path); if (!statSync(p).isDirectory()) return fail("PROJECT_MISMATCH"); return p } catch { return fail("PROJECT_MISMATCH") }
}
function git(directory: string, args: string[], code: TaskRegistryErrorCode = "PROJECT_MISMATCH"): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")))
  env.GIT_OPTIONAL_LOCKS = "0"
  const result = spawnSync("git", ["-c", "core.fsmonitor=false", ...args], { cwd: directory, env, encoding: "utf8", timeout: 10000, maxBuffer: 1024 * 1024 })
  if (result.error || result.status !== 0 || result.signal) return fail(code)
  return result.stdout
}
function common(directory: string): string {
  const path = git(directory, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).trimEnd()
  try { return realpathSync(path) } catch { return fail("PROJECT_MISMATCH") }
}
function records(directory: string): { path: string; detached: boolean; bare: boolean }[] {
  const output = git(directory, ["worktree", "list", "--porcelain", "-z"])
  return output.split("\0\0").filter(Boolean).map(record => {
    const fields = record.split("\0"); const first = fields[0]
    if (!first?.startsWith("worktree ")) return fail("PROJECT_MISMATCH")
    const path = first.slice(9)
    if (!isAbsolute(path)) return fail("PROJECT_MISMATCH")
    return { path: resolve(path), detached: fields.includes("detached"), bare: fields.includes("bare") }
  })
}
function contains(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel === "" || (rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel))
}
export function inspectProjectFromWorktree(directory: string): ProjectIdentity {
  const current = canonical(directory)
  if (canonical(git(current, ['rev-parse', '--show-toplevel']).trimEnd()) !== current) return fail('PROJECT_MISMATCH')
  const list = records(current)
  if (!list.length || list[0].bare || !list.some(item => item.path === current)) return fail('PROJECT_MISMATCH')
  return inspectProject(list[0].path)
}
export function inspectProject(primaryDirectory: string): ProjectIdentity {
  const primary = canonical(primaryDirectory)
  if (git(primary, ["rev-parse", "--is-bare-repository"]).trim() !== "false") return fail("PROJECT_MISMATCH")
  if (git(primary, ["rev-parse", "--show-superproject-working-tree"]).trimEnd()) return fail("PROJECT_MISMATCH")
  const root = canonical(git(primary, ["rev-parse", "--show-toplevel"]).trimEnd())
  const commonDir = common(primary), list = records(primary)
  if (root !== primary || !list.length || list[0].bare || list[0].path !== primary) return fail("PROJECT_MISMATCH")
  return { primaryDirectory: primary, commonDir }
}
export function validateWorktree(primaryDirectory: string, directory: string, baseline: string, scope: string[]): ValidatedWorktree {
  const project = inspectProject(primaryDirectory), target = canonical(directory)
  if (contains(project.primaryDirectory, target) || contains(target, project.primaryDirectory) || contains(target, resolve(project.commonDir, "opencode-crew-stage1"))) return fail("PROJECT_MISMATCH")
  const list = records(project.primaryDirectory), entry = list.find(item => item.path === target)
  if (!entry || entry.bare || !entry.detached || common(target) !== project.commonDir || canonical(git(target, ["rev-parse", "--show-toplevel"]).trimEnd()) !== target) return fail("PROJECT_MISMATCH")
  const format = git(project.primaryDirectory, ["rev-parse", "--show-object-format"]).trim()
  const length = format === "sha1" ? 40 : format === "sha256" ? 64 : 0
  if (typeof baseline !== "string" || !length || !new RegExp(`^[0-9a-f]{${length}}$`).test(baseline)) return fail("BASELINE_MISMATCH")
  const commit = git(project.primaryDirectory, ["rev-parse", "--verify", `${baseline}^{commit}`], "BASELINE_MISMATCH").trim()
  if (commit !== baseline || git(project.primaryDirectory, ["rev-parse", "HEAD"]).trim() !== baseline || git(target, ["rev-parse", "HEAD"]).trim() !== baseline) return fail("BASELINE_MISMATCH")
  if (git(project.primaryDirectory, ["status", "--porcelain=v1", "-z", "--untracked-files=all"], "HOST_ERROR") !== "") return fail("DIRTY_PRIMARY")
  if (git(target, ["status", "--porcelain=v1", "-z", "--untracked-files=all"], "HOST_ERROR") !== "") return fail("DIRTY_WORKTREE")
  return { ...project, directory: target, baseline, scope: normalizeScope(target, scope) }
}
