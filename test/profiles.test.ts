import { test, expect } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  ACTIVE_FILE,
  assertProfileName,
  findProfile,
  isProfileName,
  loadProfiles,
  nodeProfileFs,
  profileDirs,
  readActive,
  writeActive,
  type ProfileFs,
  type ProfileRoot,
} from "../src/profiles"

function dir(): string {
  return mkdtempSync(join(tmpdir(), "crew-profiles-"))
}
function root(path: string): ProfileRoot[] {
  return [{ dir: path, source: "user" }]
}
const write = (path: string, name: string, body: unknown) => writeFileSync(join(path, `${name}.json`), JSON.stringify(body))

test("profileDirs: env wins, empty env means no directory, XDG falls back to ~/.config", () => {
  expect(profileDirs({ OPENCODE_CREW_PROFILES_DIR: "/tmp/p", XDG_CONFIG_HOME: "/tmp/xdg" })).toEqual([{ dir: "/tmp/p", source: "user" }])
  expect(profileDirs({ OPENCODE_CREW_PROFILES_DIR: "", XDG_CONFIG_HOME: "/tmp/xdg" })).toEqual([])
  expect(profileDirs({ OPENCODE_CREW_PROFILES_DIR: "   " })).toEqual([])
  expect(profileDirs({ XDG_CONFIG_HOME: "/tmp/xdg" })).toEqual([{ dir: "/tmp/xdg/opencode/crew-profiles", source: "user" }])
  const fallback = profileDirs({})
  expect(fallback).toHaveLength(1)
  expect(fallback[0].dir.endsWith(join(".config", "opencode", "crew-profiles"))).toBe(true)
  expect(fallback[0].source).toBe("user")
})

test("names are whitelisted: no traversal, no separators, no leading dot, bounded length", () => {
  for (const good of ["fast", "gpt-5", "a.b_c-1", "x".repeat(64), "1"]) {
    expect(isProfileName(good)).toBe(true)
    expect(() => assertProfileName(good)).not.toThrow()
  }
  for (const bad of ["", ".", ".hidden", "../x", "a/b", "a\\b", "Fast", "x".repeat(65), "_.-", "a b", 5, null]) {
    expect(isProfileName(bad as string)).toBe(false)
  }
  expect(() => assertProfileName("../escape")).toThrow("opencode-crew")
  expect(() => assertProfileName("../escape")).toThrow("档名")
})

test("loadProfiles reads only *.json, skips dot files, sorts by name and keeps dir existence", () => {
  const path = dir()
  write(path, "slow", { models: { engineer: "p/e" } })
  write(path, "fast", { steps: { engineer: 10 } })
  writeFileSync(join(path, "upper.JSON"), JSON.stringify({ steps: { reviewer: 5 } }))
  write(path, "UPPER", { steps: { reviewer: 1 } })
  writeFileSync(join(path, "notes.txt"), "{}")
  writeFileSync(join(path, ".fast.123.tmp"), JSON.stringify({ steps: { engineer: 1 } }))
  writeFileSync(join(path, ACTIVE_FILE), "fast\n")
  const set = loadProfiles({ dirs: root(path) })
  expect(set.profiles.map(p => p.name)).toEqual(["fast", "slow", "upper"])
  expect(set.errors.map(e => [e.kind, e.name])).toEqual([["invalid-name", "UPPER"]])
  expect(set.dirs).toEqual([{ dir: path, source: "user", exists: true }])
  expect(set.profiles.find(p => p.name === "fast")?.config.steps.engineer).toBe(10)
  expect(set.profiles.find(p => p.name === "upper")?.config.steps.reviewer).toBe(5)
  expect(set.profiles[0].source).toBe("user")
})

test("a broken profile is isolated and reports its own field path", () => {
  const path = dir()
  write(path, "good", {})
  writeFileSync(join(path, "badjson.json"), "{not json")
  write(path, "badschema", { models: { root: "nope" } })
  writeFileSync(join(path, "huge.json"), JSON.stringify({ engineerInstructions: ["a".repeat(1024 * 1024 + 1)] }))
  const set = loadProfiles({ dirs: root(path) })
  expect(set.profiles.map(p => p.name)).toEqual(["good"])
  const byName = Object.fromEntries(set.errors.map(e => [e.name, e]))
  expect(byName.badjson.kind).toBe("invalid-json")
  expect(byName.badschema.kind).toBe("invalid-config")
  expect(byName.badschema.message).toContain('档 "badschema" 的 models.root')
  expect(byName.huge.kind).toBe("invalid-config")
  expect(byName.huge.message).toContain("1MB")
  expect(findProfile(set, "badjson").ok).toBe(false)
  expect((findProfile(set, "badschema") as { error: { kind: string } }).error.kind).toBe("invalid-config")
  expect((findProfile(set, "missing") as { error: { kind: string } }).error.kind).toBe("not-found")
})

test("unreadable profile and unreadable directory degrade without aborting the scan", () => {
  const path = dir()
  write(path, "ok", {})
  const failing: ProfileFs = {
    ...nodeProfileFs,
    readFileSync: (file, encoding) => {
      if (file.endsWith("broken.json")) throw Object.assign(new Error("EACCES"), { code: "EACCES" })
      return nodeProfileFs.readFileSync(file, encoding)
    },
  }
  write(path, "broken", {})
  const set = loadProfiles({ fs: failing, dirs: root(path) })
  expect(set.profiles.map(p => p.name)).toEqual(["ok"])
  expect(set.errors[0].kind).toBe("unreadable")
  expect(set.errors[0].message).toContain("不可读")

  const unscannable: ProfileFs = { ...nodeProfileFs, readdirSync: () => { throw new Error("EACCES") } }
  const blocked = loadProfiles({ fs: unscannable, dirs: root(path) })
  expect(blocked.profiles).toEqual([])
  expect(blocked.errors).toHaveLength(1)
  expect(blocked.errors[0].kind).toBe("unreadable")
  expect(blocked.errors[0].path).toBe(path)
})

test("missing profile directory is an empty set, not an error", () => {
  const set = loadProfiles({ dirs: root(join(dir(), "absent")) })
  expect(set.profiles).toEqual([])
  expect(set.errors).toEqual([])
  expect(set.dirs[0].exists).toBe(false)
})

test("readActive distinguishes missing, blank, invalid and unreadable", () => {
  const path = dir()
  expect(readActive({ dirs: root(path) })).toEqual({ name: null, path: join(path, ACTIVE_FILE), raw: null, error: null })

  writeFileSync(join(path, ACTIVE_FILE), "")
  const blank = readActive({ dirs: root(path) })
  expect(blank).toMatchObject({ name: null, raw: "", error: null })

  writeFileSync(join(path, ACTIVE_FILE), "   \n")
  expect(readActive({ dirs: root(path) })).toMatchObject({ name: null, error: null })

  writeFileSync(join(path, ACTIVE_FILE), "../escape\n")
  const invalid = readActive({ dirs: root(path) })
  expect(invalid.name).toBeNull()
  expect(invalid.error).toContain("active 指针内容非法")

  writeFileSync(join(path, ACTIVE_FILE), "fast\n")
  expect(readActive({ dirs: root(path) })).toMatchObject({ name: "fast", raw: "fast\n", error: null })

  const failing: ProfileFs = {
    ...nodeProfileFs,
    readFileSync: (file, encoding) => {
      if (file.endsWith(ACTIVE_FILE)) throw Object.assign(new Error("EACCES"), { code: "EACCES" })
      return nodeProfileFs.readFileSync(file, encoding)
    },
  }
  const unreadable = readActive({ fs: failing, dirs: root(path) })
  expect(unreadable.name).toBeNull()
  expect(unreadable.error).toContain("无法读取 active 指针")
})

test("writeActive creates a 0700 directory and a 0600 pointer, replacing atomically", () => {
  const base = dir()
  const path = join(base, "crew-profiles")
  writeActive("fast", { dirs: root(path) })
  expect(statSync(path).mode & 0o777).toBe(0o700)
  const pointer = join(path, ACTIVE_FILE)
  expect(statSync(pointer).mode & 0o777).toBe(0o600)
  expect(readFileSync(pointer, "utf8")).toBe("fast\n")
  expect(readdirSync(path).filter(f => f.endsWith(".tmp"))).toEqual([])

  writeActive("slow", { dirs: root(path) })
  expect(readFileSync(pointer, "utf8")).toBe("slow\n")

  writeActive(null, { dirs: root(path) })
  expect(nodeProfileFs.existsSync(pointer)).toBe(false)
  expect(() => writeActive(null, { dirs: root(path) })).not.toThrow()
  expect(() => writeActive("../escape", { dirs: root(path) })).toThrow("档名")
})

test("writeActive cleans its temp file when rename fails and surfaces the error", () => {
  const path = dir()
  const calls: string[] = []
  let temp = ""
  const failing: ProfileFs = {
    ...nodeProfileFs,
    writeFileSync: (file, data, options) => { temp = file; nodeProfileFs.writeFileSync(file, data, options) },
    renameSync: () => { throw new Error("ENOSPC") },
    unlinkSync: file => { calls.push(file); nodeProfileFs.unlinkSync(file) },
  }
  expect(() => writeActive("fast", { fs: failing, dirs: root(path) })).toThrow("ENOSPC")
  expect(calls).toEqual([temp])
  expect(readdirSync(path)).toEqual([])
})

test("a stale temp file never blocks the next write and stays invisible to the loader", () => {
  const path = dir()
  writeFileSync(join(path, ".fast.999.tmp"), "fast\n")
  writeActive("fast", { dirs: root(path) })
  expect(readActive({ dirs: root(path) }).name).toBe("fast")
  expect(loadProfiles({ dirs: root(path) }).errors).toEqual([])
})

test("profile files are never rewritten or re-permissioned", () => {
  const path = dir()
  write(path, "fast", { steps: { engineer: 10 } })
  const file = join(path, "fast.json")
  chmodSync(file, 0o644)
  const before = readFileSync(file, "utf8")
  writeActive("fast", { dirs: root(path) })
  expect(readFileSync(file, "utf8")).toBe(before)
  expect(statSync(file).mode & 0o777).toBe(0o644)
})
