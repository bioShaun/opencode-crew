import { test, expect } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createCrewProfiles } from "../src/profile-state"
import {
  crewProfiles,
  parseProfilesView,
  parseSwitchView,
  registerProfileRpc,
  toProfilesView,
  toSwitchView,
} from "../src/profile-rpc"
import { writeActive } from "../src/profiles"

const baseline = { models: {}, steps: {}, engineerInstructions: [] }

function fixture(body: unknown = { models: { root: "p/root#high", engineer: "p/eng" }, steps: { engineer: 12 }, engineerInstructions: ["a rule"] }) {
  const path = mkdtempSync(join(tmpdir(), "crew-rpc-"))
  writeFileSync(join(path, "fast.json"), JSON.stringify(body))
  writeFileSync(join(path, "broken.json"), "{oops")
  const dirs = [{ dir: path, source: "user" as const }]
  const profiles = createCrewProfiles({ baseline, dirs, reload: async () => {} })
  return { path, dirs, profiles }
}

function fakeCtx() {
  const registered: any[] = []
  const ctx: any = {
    rpc: {
      register: async (definition: any, handlers: any) => {
        registered.push({ definition, handlers })
        return { events: { emit: async () => {} }, dispose: async () => {} }
      },
    },
  }
  return { ctx, registered }
}

test("crewProfiles is a separate write-capable definition with no null in its schema", () => {
  expect(crewProfiles.id).toBe("opencode-crew-profiles")
  expect(Object.keys(crewProfiles.methods).sort()).toEqual(["list", "off", "switch"])
  expect(crewProfiles.events).toEqual({})
  const schema = JSON.stringify(crewProfiles)
  expect(schema).not.toContain('"null"')
  expect(crewProfiles.methods.switch.input.required).toEqual(["name"])
  expect(crewProfiles.methods.switch.input.properties.name.maxLength).toBe(64)
  expect(crewProfiles.methods.list.input.additionalProperties).toBe(false)
})

test("toProfilesView projects the active profile, directories and per-profile errors", () => {
  const { path, dirs, profiles } = fixture()
  writeActive("fast", { dirs })
  const info = profiles.info()
  const view = toProfilesView(info)
  expect(view.active).toBe("fast")
  expect(view.dirs).toEqual([{ dir: path, source: "user", exists: true }])
  expect(view.profiles).toHaveLength(1)
  expect(view.profiles[0]).toMatchObject({
    name: "fast",
    source: "user",
    models: 2,
    steps: 1,
    instructions: 1,
    rootModel: "p/root#high",
    roles: ["root", "engineer"],
  })
  expect(view.errors.map(error => error.name)).toEqual(["broken"])
  expect(view.error).toBeUndefined()
})

test("a fallback keeps requested and error in the projection", () => {
  const { dirs, profiles } = fixture()
  writeActive("ghost", { dirs })
  const view = toProfilesView(profiles.info())
  expect(view.active).toBeUndefined()
  expect(view.requested).toBe("ghost")
  expect(view.error).toContain("不存在")
})

test("parseProfilesView drops malformed data instead of trusting the wire", () => {
  expect(parseProfilesView(undefined)).toEqual({ dirs: [], profiles: [], errors: [] })
  expect(parseProfilesView("nope")).toEqual({ dirs: [], profiles: [], errors: [] })
  expect(parseProfilesView({ active: 5, dirs: "x", profiles: {}, errors: null })).toEqual({ dirs: [], profiles: [], errors: [] })
  const parsed = parseProfilesView({
    active: "fast",
    requested: "ghost",
    error: "boom",
    dirs: [{ dir: "/a", source: "user", exists: true }, { dir: 5, source: "user" }, { dir: "/b", source: "weird" }],
    profiles: [
      { name: "fast", source: "user", models: 2, steps: 1, instructions: 0, roles: ["root", "nope", 7], rootModel: "p/r" },
      { name: 42, source: "user" },
      { name: "pkg", source: "package", models: -1, steps: "x", instructions: 1.9, roles: [] },
    ],
    errors: [{ name: "bad", message: "m" }, { name: "bad" }],
  })
  expect(parsed.active).toBe("fast")
  expect(parsed.requested).toBe("ghost")
  expect(parsed.error).toBe("boom")
  expect(parsed.dirs).toEqual([{ dir: "/a", source: "user", exists: true }])
  expect(parsed.profiles).toHaveLength(2)
  expect(parsed.profiles[0]).toMatchObject({ name: "fast", roles: ["root"], rootModel: "p/r" })
  expect(parsed.profiles[1]).toMatchObject({ name: "pkg", source: "package", models: 0, steps: 0, instructions: 1 })
  expect(parsed.profiles[1].rootModel).toBeUndefined()
  expect(parsed.errors).toEqual([{ name: "bad", message: "m" }])
})

test("parseSwitchView requires ok and degrades the rest", () => {
  expect(parseSwitchView(undefined)).toBeUndefined()
  expect(parseSwitchView({ profiles: {} })).toBeUndefined()
  const parsed = parseSwitchView({ ok: true, changed: "yes", warnings: ["w", 3], profiles: undefined })
  expect(parsed).toEqual({ ok: true, changed: false, warnings: ["w"], profiles: { dirs: [], profiles: [], errors: [] } })
  const failing = parseSwitchView({ ok: false, active: "fast", code: "NOT_FOUND", message: "m", changed: true })
  expect(failing).toMatchObject({ ok: false, active: "fast", changed: true, code: "NOT_FOUND", message: "m" })
})

test("registerProfileRpc is optional and registers list/switch/off", async () => {
  await expect(registerProfileRpc({} as any, createCrewProfiles({ baseline, dirs: [] }))).resolves.toBeUndefined()
  const { ctx, registered } = fakeCtx()
  const { dirs, profiles } = fixture()
  await registerProfileRpc(ctx, profiles)
  expect(registered).toHaveLength(1)
  expect(registered[0].definition.id).toBe("opencode-crew-profiles")
  const handlers = registered[0].handlers
  expect(Object.keys(handlers).sort()).toEqual(["list", "off", "switch"])

  const list = await handlers.list({})
  expect(list.profiles.map((p: any) => p.name)).toEqual(["fast"])
  const bad = await handlers.switch({ name: "../escape" })
  expect(bad).toMatchObject({ ok: false, code: "INVALID_NAME" })
  const missing = await handlers.switch({ name: "ghost" })
  expect(missing).toMatchObject({ ok: false, code: "NOT_FOUND" })
  const ok = await handlers.switch({ name: "fast" })
  expect(ok).toMatchObject({ ok: true, active: "fast" })
  expect(ok.profiles.active).toBe("fast")
  const off = await handlers.off({})
  expect(off).toMatchObject({ ok: true, changed: true })
  expect(off.profiles.active).toBeUndefined()
  expect(dirs[0].dir).toBeTruthy()
})

test("handlers never surface a host exception body", async () => {
  const { ctx, registered } = fakeCtx()
  const exploding: any = {
    baseline,
    config() { return baseline },
    info() { return { active: null, requested: null, error: null, config: baseline, set: { profiles: [], errors: [], dirs: [] } } },
    async switch() { throw new Error("secret host body") },
    async off() { throw new Error("secret host body") },
  }
  await registerProfileRpc(ctx, exploding)
  const handlers = registered[0].handlers
  const failed = await handlers.switch({ name: "fast" })
  expect(failed).toMatchObject({ ok: false, code: "HOST_ERROR" })
  expect(JSON.stringify(failed)).not.toContain("secret host body")
  const off = await handlers.off({})
  expect(off).toMatchObject({ ok: false, code: "HOST_ERROR" })
  expect(JSON.stringify(off)).not.toContain("secret host body")
})

test("a broken register call does not reject plugin setup", async () => {
  const ctx: any = { rpc: { register: async () => { throw new Error("no rpc here") } } }
  await expect(registerProfileRpc(ctx, createCrewProfiles({ baseline, dirs: [] }))).resolves.toBeUndefined()
})

test("toSwitchView keeps the switch result shape the TUI expects", () => {
  const { dirs, profiles } = fixture()
  const view = toSwitchView({
    ok: true,
    active: "fast",
    changed: true,
    warnings: ["w"],
    info: profiles.info(),
  })
  expect(view).toMatchObject({ ok: true, active: "fast", changed: true, warnings: ["w"] })
  expect(view.profiles.profiles[0].name).toBe("fast")
  expect(dirs).toHaveLength(1)
})
