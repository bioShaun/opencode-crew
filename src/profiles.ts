// Crew profile directory: read-only loading of `<name>.json` files plus the `active` pointer.
// This module never reads or writes `opencode.json(c)`. The only write path is the
// pointer file (and the directory created for it); profile files stay user-owned.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import {
  PROFILE_NAME_MAX,
  assertProfileName,
  fail,
  isProfileName,
  parseCrewConfig,
  profileLabel,
  type CrewConfig,
} from "./config"

export { PROFILE_NAME_MAX, assertProfileName, isProfileName }

export type ProfileSource = "user" | "package"

/** One directory to scan. `exists` is filled by `loadProfiles` for display only. */
export type ProfileRoot = { dir: string; source: ProfileSource; exists?: boolean }

export type ProfileErrorKind =
  | "invalid-name" | "not-found" | "unreadable" | "invalid-json" | "invalid-config"
export type ProfileError = { kind: ProfileErrorKind; name: string; path: string; message: string }

export type Profile = { name: string; path: string; source: ProfileSource; config: CrewConfig }
export type ProfileSet = { profiles: Profile[]; errors: ProfileError[]; dirs: ProfileRoot[] }

/** Injection seam for failure paths only; the default implementation wraps node:fs. */
export type ProfileFs = {
  existsSync(path: string): boolean
  readFileSync(path: string, encoding: "utf8"): string
  writeFileSync(path: string, data: string, options: { flag: string; mode: number }): void
  renameSync(from: string, to: string): void
  unlinkSync(path: string): void
  mkdirSync(path: string, options: { recursive: true; mode: number }): void
  readdirSync(path: string): string[]
}

export const nodeProfileFs: ProfileFs = {
  existsSync: path => existsSync(path),
  readFileSync: (path, encoding) => readFileSync(path, encoding),
  writeFileSync: (path, data, options) => writeFileSync(path, data, options),
  renameSync: (from, to) => renameSync(from, to),
  unlinkSync: path => unlinkSync(path),
  mkdirSync: (path, options) => mkdirSync(path, options),
  readdirSync: path => readdirSync(path),
}

export const ACTIVE_FILE = "active"
export const PROFILE_MAX_BYTES = 1024 * 1024

type Deps = { fs?: ProfileFs; dirs?: ProfileRoot[] }

/** Resolved on every call so tests can vary the environment per case. */
export function profileDirs(env: NodeJS.ProcessEnv = process.env): ProfileRoot[] {
  const configured = env.OPENCODE_CREW_PROFILES_DIR
  if (configured !== undefined) {
    const dir = configured.trim()
    // Empty means "explicitly no profile directory"; used by tests for isolation.
    return dir ? [{ dir, source: "user" }] : []
  }
  const base = env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config")
  return [{ dir: join(base, "opencode", "crew-profiles"), source: "user" }]
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))
const safeExists = (fs: ProfileFs, path: string) => {
  try { return fs.existsSync(path) } catch { return false }
}
const byName = (a: { name: string }, b: { name: string }) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)

/** Reads every profile file; a broken file or directory never aborts the scan. */
export function loadProfiles(deps: Deps = {}): ProfileSet {
  const fs = deps.fs ?? nodeProfileFs
  const dirs = deps.dirs ?? profileDirs()
  const profiles: Profile[] = [], errors: ProfileError[] = [], roots: ProfileRoot[] = []
  for (const root of dirs) {
    const exists = safeExists(fs, root.dir)
    roots.push({ dir: root.dir, source: root.source, exists })
    if (!exists) continue
    let files: string[]
    try { files = fs.readdirSync(root.dir) } catch (error) {
      errors.push({ kind: "unreadable", name: "", path: root.dir, message: `档目录不可读（${root.dir}）：${message(error)}` })
      continue
    }
    for (const file of [...files].sort()) {
      // Atomic-write temp files and hidden files start with ".".
      if (file.startsWith(".")) continue
      const match = /^(.+)\.json$/i.exec(file)
      if (!match) continue
      const name = match[1], path = join(root.dir, file)
      if (!isProfileName(name)) {
        errors.push({ kind: "invalid-name", name, path, message: `[opencode-crew] 档名 "${name}" 不合法（只允许小写字母 a-z、数字 0-9 与 . _ -，最多 ${PROFILE_NAME_MAX} 字符）` })
        continue
      }
      let text: string
      try { text = fs.readFileSync(path, "utf8") } catch (error) {
        errors.push({ kind: "unreadable", name, path, message: `[opencode-crew] 档 "${name}" 不可读：${message(error)}` })
        continue
      }
      const bytes = Buffer.byteLength(text, "utf8")
      if (bytes > PROFILE_MAX_BYTES) {
        errors.push({ kind: "invalid-config", name, path, message: `[opencode-crew] 档 "${name}" 超过 1MB（${bytes} 字节）` })
        continue
      }
      let json: unknown
      try { json = JSON.parse(text) } catch {
        errors.push({ kind: "invalid-json", name, path, message: `[opencode-crew] 档 "${name}" 不是合法 JSON` })
        continue
      }
      try {
        profiles.push({ name, path, source: root.source, config: parseCrewConfig(json, profileLabel(name)) })
      } catch (error) {
        errors.push({ kind: "invalid-config", name, path, message: message(error) })
      }
    }
  }
  profiles.sort(byName)
  return { profiles, errors, dirs: roots }
}

export type ProfileLookup =
  | { ok: true; profile: Profile }
  | { ok: false; error: ProfileError }

/** A same-name broken profile reports its original error instead of `not-found`. */
export function findProfile(set: ProfileSet, name: string): ProfileLookup {
  const profile = set.profiles.find(candidate => candidate.name === name)
  if (profile) return { ok: true, profile }
  const error = set.errors.find(candidate => candidate.name === name)
  return { ok: false, error: error ?? { kind: "not-found", name, path: "", message: `[opencode-crew] 档 "${name}" 不存在` } }
}

export type ActivePointer = { name: string | null; path: string; raw: string | null; error: string | null }

function activeDir(deps: Deps): string | undefined {
  return (deps.dirs ?? profileDirs())[0]?.dir
}

/** Four distinguishable states: missing, blank, invalid content, read failure. */
export function readActive(deps: Deps = {}): ActivePointer {
  const fs = deps.fs ?? nodeProfileFs
  const dir = activeDir(deps)
  if (!dir) return { name: null, path: "", raw: null, error: null }
  const path = join(dir, ACTIVE_FILE)
  if (!safeExists(fs, path)) return { name: null, path, raw: null, error: null }
  let raw: string
  try { raw = fs.readFileSync(path, "utf8") } catch (error) {
    return { name: null, path, raw: null, error: `无法读取 active 指针（${path}）：${message(error)}` }
  }
  const trimmed = raw.trim()
  if (!trimmed) return { name: null, path, raw, error: null }
  if (!isProfileName(trimmed)) {
    return { name: null, path, raw, error: "active 指针内容非法（只允许 a-z 0-9 . _ -，最多 64 字符）" }
  }
  return { name: trimmed, path, raw, error: null }
}

/**
 * Writes the pointer atomically (`name === null` removes it). Throws on failure so the
 * caller can keep memory and agent definitions unchanged; never writes a profile file.
 */
export function writeActive(name: string | null, deps: Deps = {}): void {
  if (name !== null) assertProfileName(name)
  const fs = deps.fs ?? nodeProfileFs
  const dir = activeDir(deps)
  if (!dir) {
    if (name === null) return
    fail("没有可用的档目录，无法保存 active 指针")
  }
  const target = join(dir, ACTIVE_FILE)
  if (name === null) {
    try { fs.unlinkSync(target) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
    return
  }
  try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }) } catch { /* let the write report it */ }
  const unique = `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`
  const temp = join(dir, `.${name}.${unique}.tmp`)
  try {
    fs.writeFileSync(temp, `${name}\n`, { flag: "wx", mode: 0o600 })
    fs.renameSync(temp, target)
  } catch (error) {
    try { fs.unlinkSync(temp) } catch { /* stale temp files are skipped by the loader anyway */ }
    throw error
  }
}
