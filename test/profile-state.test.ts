import { test, expect } from "bun:test"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createCrewProfiles, RELOAD_WARNING, type CrewProfilesInfo } from "../src/profile-state"
import { ACTIVE_FILE, nodeProfileFs, readActive, writeActive, type ProfileFs, type ProfileRoot } from "../src/profiles"

const baseline = {
  models: { engineer: { providerID: "base", id: "engineer" } },
  steps: { engineer: 80 },
  engineerInstructions: ["baseline rule"],
}

function dir(): string {
  return mkdtempSync(join(tmpdir(), "crew-state-"))
}
function root(path: string): ProfileRoot[] {
  return [{ dir: path, source: "user" }]
}
function write(path: string, name: string, body: unknown) {
  writeFileSync(join(path, `${name}.json`), JSON.stringify(body))
}
function runtime(path: string, extra: { fs?: ProfileFs; baseline?: typeof baseline } = {}) {
  const calls: number[] = []
  const profiles = createCrewProfiles({
    baseline: extra.baseline ?? baseline,
    dirs: root(path),
    ...(extra.fs ? { fs: extra.fs } : {}),
    reload: async () => { calls.push(Date.now()) },
  })
  return { profiles, calls }
}
const fast = {
  models: { root: "p/root#high", engineer: "p/eng#medium" },
  steps: { engineer: 30 },
  engineerInstructions: ["fast rule"],
}

test("S1/S2/S3/S4: no directory, no pointer, or a blank pointer keeps the baseline and no footer signal", () => {
  for (const path of [join(dir(), "absent"), dir()]) {
    const { profiles } = runtime(path)
    const info = profiles.info()
    expect(info.active).toBeNull()
    expect(info.error).toBeNull()
    expect(profiles.config()).toEqual(baseline)
    expect(info.set.profiles).toEqual([])
  }
  const path = dir()
  writeFileSync(join(path, ACTIVE_FILE), "   \n")
  const { profiles } = runtime(path)
  const info = profiles.info()
  expect(info.active).toBeNull()
  expect(info.requested).toBeNull()
  expect(info.error).toBeNull()
  expect(profiles.config()).toEqual(baseline)
})

test("S5/S6/S7: a missing, broken or illegal pointer target falls back with a readable reason", () => {
  const missing = dir()
  writeFileSync(join(missing, ACTIVE_FILE), "ghost\n")
  write(missing, "fast", fast)
  const missingInfo = runtime(missing).profiles.info()
  expect(missingInfo.active).toBeNull()
  expect(missingInfo.requested).toBe("ghost")
  expect(missingInfo.error).toContain('active 档 "ghost" 不存在')
  expect(missingInfo.error).toContain("可用档：fast")
  expect(missingInfo.error).toContain("已回退到 opencode.json")
  expect(missingInfo.config).toEqual(baseline)

  const broken = dir()
  writeFileSync(join(broken, ACTIVE_FILE), "bad\n")
  write(broken, "bad", { models: { root: "nope" } })
  const brokenInfo = runtime(broken).profiles.info()
  expect(brokenInfo.active).toBeNull()
  expect(brokenInfo.error).toContain('active 档 "bad" 校验失败')
  expect(brokenInfo.error).toContain('档 "bad" 的 models.root')
  expect(brokenInfo.config).toEqual(baseline)

  const illegal = dir()
  writeFileSync(join(illegal, ACTIVE_FILE), "../escape\n")
  const illegalInfo = runtime(illegal).profiles.info()
  expect(illegalInfo.active).toBeNull()
  expect(illegalInfo.error).toContain("active 指针内容非法")
  expect(illegalInfo.config).toEqual(baseline)
})

test("S8/S9: an unreadable pointer or directory falls back without throwing", () => {
  const path = dir()
  write(path, "fast", fast)
  writeActive("fast", { dirs: root(path) })
  const failing: ProfileFs = {
    ...nodeProfileFs,
    readFileSync: (file, encoding) => {
      if (file.endsWith(ACTIVE_FILE)) throw Object.assign(new Error("EACCES"), { code: "EACCES" })
      return nodeProfileFs.readFileSync(file, encoding)
    },
  }
  const unreadable = runtime(path, { fs: failing }).profiles.info()
  expect(unreadable.active).toBeNull()
  expect(unreadable.error).toContain("无法读取 active 指针")
  expect(unreadable.config).toEqual(baseline)

  const unscannable: ProfileFs = { ...nodeProfileFs, readdirSync: () => { throw new Error("EACCES") } }
  const blocked = runtime(path, { fs: unscannable }).profiles.info()
  expect(blocked.active).toBeNull()
  expect(blocked.error).toContain("档目录不可读")
  expect(blocked.config).toEqual(baseline)
})

test("S10/S12: a broken non-active profile only shows up in the per-profile error list", () => {
  const path = dir()
  write(path, "fast", fast)
  write(path, "other", { steps: { engineer: -1 } })
  writeActive("fast", { dirs: root(path) })
  const info = runtime(path).profiles.info()
  expect(info.active).toBe("fast")
  expect(info.error).toBeNull()
  expect(info.config.steps.engineer).toBe(30)
  expect(info.set.errors).toHaveLength(1)
  expect(info.set.errors[0].name).toBe("other")

  const exploding: ProfileFs = { ...nodeProfileFs, existsSync: () => { throw new Error("boom") }, readdirSync: () => { throw new Error("boom") } }
  const info2 = (createCrewProfiles({ baseline, dirs: root(path), fs: exploding, reload: async () => {} }) as { info(): CrewProfilesInfo }).info()
  expect(info2.active).toBeNull()
  expect(info2.config).toEqual(baseline)
})

test("config() re-reads the disk every time: hand edits apply immediately", () => {
  const path = dir()
  write(path, "fast", fast)
  writeActive("fast", { dirs: root(path) })
  const { profiles } = runtime(path)
  expect(profiles.config().steps.engineer).toBe(30)
  write(path, "fast", { ...fast, steps: { engineer: 44 } })
  expect(profiles.config().steps.engineer).toBe(44)
  writeFileSync(join(path, ACTIVE_FILE), "off\n")
  expect(profiles.config()).toEqual(baseline)
})

test("C1/C2/C3: invalid name, missing profile and broken profile write nothing", async () => {
  const path = dir()
  write(path, "broken", { models: { root: "nope" } })
  const { profiles, calls } = runtime(path)
  const bad = await profiles.switch("../escape")
  expect(bad).toMatchObject({ ok: false, code: "INVALID_NAME", changed: false })
  expect(readActive({ dirs: root(path) }).raw).toBeNull()

  const missing = await profiles.switch("ghost")
  expect(missing).toMatchObject({ ok: false, code: "NOT_FOUND" })
  expect(missing.message).toContain("当前没有可用档")

  const invalid = await profiles.switch("broken")
  expect(invalid).toMatchObject({ ok: false, code: "INVALID_PROFILE" })
  expect(invalid.message).toContain('档 "broken"')
  expect(readActive({ dirs: root(path) }).raw).toBeNull()
  expect(calls).toHaveLength(0)
})

test("C4/C7: an effective switch writes the pointer, reloads once and reports changed", async () => {
  const path = dir()
  write(path, "fast", fast)
  const { profiles, calls } = runtime(path)
  const result = await profiles.switch("fast")
  expect(result).toMatchObject({ ok: true, active: "fast", changed: true, warnings: [] })
  expect(readFileSync(join(path, ACTIVE_FILE), "utf8")).toBe("fast\n")
  expect(calls).toHaveLength(1)
  expect(result.info.config.steps.engineer).toBe(30)

  const again = await profiles.switch("fast")
  expect(again).toMatchObject({ ok: true, changed: false })
  expect(calls).toHaveLength(1)

  const unknown = await profiles.switch("nope")
  expect(unknown.ok).toBe(false)
  expect(calls).toHaveLength(1)
})

test("C5: a failed pointer write leaves memory and the disk untouched and does not reload", async () => {
  const path = dir()
  write(path, "fast", fast)
  const failing: ProfileFs = { ...nodeProfileFs, renameSync: () => { throw Object.assign(new Error("ENOSPC"), { code: "ENOSPC" }) } }
  const { profiles, calls } = runtime(path, { fs: failing })
  const result = await profiles.switch("fast")
  expect(result).toMatchObject({ ok: false, code: "WRITE_FAILED", active: null, changed: false })
  expect(result.message).toContain("ENOSPC")
  expect(profiles.config()).toEqual(baseline)
  expect(readActive({ dirs: root(path) }).raw).toBeNull()
  expect(calls).toHaveLength(0)
})

test("C6: a write that does not survive the re-read reports APPLY_FAILED", async () => {
  const path = dir()
  write(path, "fast", fast)
  const lying: ProfileFs = { ...nodeProfileFs, readFileSync: (file, encoding) => (file.endsWith(ACTIVE_FILE) ? "" : nodeProfileFs.readFileSync(file, encoding)) }
  const { profiles } = runtime(path, { fs: lying })
  const result = await profiles.switch("fast")
  expect(result).toMatchObject({ ok: false, code: "APPLY_FAILED", changed: true })
  expect(result.warnings).toEqual([])
})

test("C7/C8: a throwing or absent reload downgrades to a warning", async () => {
  const path = dir()
  write(path, "fast", fast)
  const failingReload = createCrewProfiles({ baseline, dirs: root(path), reload: async () => { throw new Error("host down") } })
  const result = await failingReload.switch("fast")
  expect(result).toMatchObject({ ok: true, active: "fast" })
  expect(result.warnings).toEqual([RELOAD_WARNING])
  expect(result.warnings[0]).toContain("下次宿主动作后生效")

  const noReload = createCrewProfiles({ baseline, dirs: root(path) })
  const off = await noReload.off()
  expect(off).toMatchObject({ ok: true, active: null, changed: true })
  expect(off.warnings).toEqual([RELOAD_WARNING])
})

test("C10: off on a fresh directory is a no-op without reload; off clears blank and illegal pointers", async () => {
  const empty = dir()
  const { profiles, calls } = runtime(empty)
  const noop = await profiles.off()
  expect(noop).toMatchObject({ ok: true, changed: false, active: null })
  expect(calls).toHaveLength(0)

  writeFileSync(join(empty, ACTIVE_FILE), "   ")
  const blank = await profiles.off()
  expect(blank).toMatchObject({ ok: true, changed: true })
  expect(readActive({ dirs: root(empty) }).raw).toBeNull()
  expect(calls).toHaveLength(1)

  writeFileSync(join(empty, ACTIVE_FILE), "../escape")
  const illegal = await profiles.off()
  expect(illegal).toMatchObject({ ok: true, changed: true })
  expect(readActive({ dirs: root(empty) }).raw).toBeNull()
  expect(calls).toHaveLength(2)
})

test("off after a switch restores the baseline and reloads once", async () => {
  const path = dir()
  write(path, "fast", fast)
  const { profiles, calls } = runtime(path)
  await profiles.switch("fast")
  expect(profiles.config()).not.toEqual(baseline)
  const result = await profiles.off()
  expect(result).toMatchObject({ ok: true, active: null, changed: true })
  expect(profiles.config()).toEqual(baseline)
  expect(calls).toHaveLength(2)
})

test("changed tracks pointer + the three writable fields and is idempotent", async () => {
  const path = dir()
  const same = {
    models: { root: "p/root#high", engineer: "p/eng#medium" },
    steps: { engineer: 30 },
    engineerInstructions: ["fast rule"],
  }
  write(path, "same", same)
  write(path, "twin", same)
  write(path, "variant", { ...same, engineerInstructions: ["other rule"] })
  const profiles = createCrewProfiles({
    baseline: { models: {}, steps: {}, engineerInstructions: [] },
    dirs: root(path),
    reload: async () => {},
  })
  expect((await profiles.switch("same")).changed).toBe(true)
  expect((await profiles.switch("same")).changed).toBe(false)
  // A hand edit does not need a second write: the pointer already selects this profile.
  write(path, "same", { ...same, steps: { engineer: 31 } })
  expect((await profiles.switch("same")).changed).toBe(false)
  // models/steps identical, engineerInstructions different -> still a real switch.
  expect((await profiles.switch("variant")).changed).toBe(true)
  expect((await profiles.off()).changed).toBe(true)
  expect((await profiles.off()).changed).toBe(false)
})
