import { test, expect } from "bun:test"
import { PROFILE_MEMORY_KEY, refreshProfile, rememberProfile, runProfileCommand } from "../src/tui/profile-actions"
import type { CrewProfilesView, CrewSwitchView } from "../src/profile-rpc"

const profilesView: CrewProfilesView = {
  active: "fast",
  dirs: [{ dir: "/p/profiles", source: "user", exists: true }],
  profiles: [{ name: "fast", source: "user", models: 2, steps: 1, instructions: 0, rootModel: "p/r", roles: ["root", "engineer"] }],
  errors: [],
}
const offView: CrewProfilesView = { dirs: profilesView.dirs, profiles: profilesView.profiles, errors: [] }
const switchOk: CrewSwitchView = { ok: true, active: "fast", changed: true, warnings: [], profiles: profilesView }
const switchFailed: CrewSwitchView = { ok: false, changed: false, code: "NOT_FOUND", message: '档 "ghost" 不存在。', warnings: [], profiles: profilesView }
const offOk: CrewSwitchView = { ok: true, changed: true, warnings: [], profiles: offView }

function fakeContext() {
  const calls: any[] = [], alerts: any[] = [], toasts: any[] = [], selects: any[] = []
  const memory = new Map<string, any>()
  const state: { list?: unknown; switch?: unknown; off?: unknown; select?: unknown; listThrows?: boolean } = {}
  const ctx: any = {
    location: { directory: "/p" },
    client: {
      rpc: () => ({
        list: async (_input: any, options: any) => {
          calls.push(["list", options])
          if (state.listThrows) throw new Error("rpc down")
          return state.list
        },
        switch: async (input: any, options: any) => {
          calls.push(["switch", input, options])
          return state.switch
        },
        off: async (input: any, options: any) => {
          calls.push(["off", input, options])
          return state.off
        },
      }),
    },
    ui: {
      dialog: {
        alert: async (options: any) => { alerts.push(options) },
        select: async (options: any) => { selects.push(options); return state.select },
      },
      toast: { show: (options: any) => { toasts.push(options) } },
    },
    storage: {
      memory: (key: string, options: { initial: any }) => {
        if (!memory.has(key)) memory.set(key, structuredClone(options.initial))
        const store = memory.get(key)
        return [store, (mutate: (draft: any) => void) => mutate(store)]
      },
    },
  }
  return { ctx, calls, alerts, toasts, selects, memory, state }
}

const readMemory = (memory: Map<string, any>) => memory.get(PROFILE_MEMORY_KEY)

test("menu selects a profile, switches through RPC and updates the footer cache", async () => {
  const f = fakeContext()
  f.state.list = profilesView
  f.state.select = { kind: "profile", name: "fast" }
  f.state.switch = switchOk
  await runProfileCommand(f.ctx, "")
  expect(f.selects).toHaveLength(1)
  expect(f.selects[0]).toMatchObject({ title: "Crew 配置档", current: { kind: "profile", name: "fast" } })
  expect(f.calls.filter(call => call[0] === "switch")).toEqual([["switch", { name: "fast" }, { location: { directory: "/p" } }]])
  expect(f.toasts.at(-1)).toMatchObject({ variant: "success" })
  expect(f.toasts.at(-1).message).toContain('已切换到档 "fast"')
  expect(f.toasts.at(-1).message).toContain("下一次请求")
  expect(readMemory(f.memory)).toMatchObject({ active: "fast", error: "" })
  expect(readMemory(f.memory).at).toBeGreaterThan(0)
})

test("Esc in the menu cancels without any write", async () => {
  const f = fakeContext()
  f.state.list = profilesView
  f.state.select = undefined
  await runProfileCommand(f.ctx, "")
  expect(f.calls.filter(call => call[0] === "switch" || call[0] === "off")).toHaveLength(0)
  expect(f.toasts).toHaveLength(0)
  expect(f.alerts).toHaveLength(0)
})

test("menu off entry closes the profile", async () => {
  const f = fakeContext()
  f.state.list = profilesView
  f.state.select = { kind: "off" }
  f.state.off = offOk
  await runProfileCommand(f.ctx, "")
  expect(f.calls.some(call => call[0] === "off")).toBe(true)
  expect(f.toasts.at(-1).message).toContain("已关闭档位")
  expect(readMemory(f.memory).active).toBe("")
})

test("a failed switch explains itself and mirrors the server view into the footer cache", async () => {
  const f = fakeContext()
  f.state.switch = switchFailed
  await runProfileCommand(f.ctx, "ghost")
  expect(f.alerts).toEqual([{ title: "切换失败", message: '档 "ghost" 不存在。' }])
  expect(f.toasts).toHaveLength(0)
  // The response still carries the unchanged active profile, so the footer stays truthful.
  expect(readMemory(f.memory)).toMatchObject({ active: "fast" })
})

test("a malformed switch response is reported instead of trusted", async () => {
  const f = fakeContext()
  f.state.switch = { nonsense: true }
  await runProfileCommand(f.ctx, "fast")
  expect(f.alerts[0].title).toBe("切换失败")
  expect(f.alerts[0].message).toContain("无法识别")
})

test("warnings surface as a warning toast after a successful switch", async () => {
  const f = fakeContext()
  f.state.switch = { ...switchOk, warnings: ["配置已切换，但宿主 agent 重载失败；将在下次宿主动作后生效"] }
  await runProfileCommand(f.ctx, "fast")
  expect(f.toasts.map(t => t.variant)).toEqual(["success", "warning"])
})

test("off reports a no-op switch honestly", async () => {
  const f = fakeContext()
  f.state.off = { ...offOk, changed: false }
  await runProfileCommand(f.ctx, "off")
  expect(f.toasts.at(-1).message).toContain("已是关闭状态")
})

test("list shows the directory, profiles and errors in one alert", async () => {
  const f = fakeContext()
  f.state.list = { ...profilesView, errors: [{ name: "broken", message: "bad json" }] }
  await runProfileCommand(f.ctx, "list")
  expect(f.alerts).toHaveLength(1)
  expect(f.alerts[0].title).toBe("Crew 配置档")
  expect(f.alerts[0].message).toContain("/p/profiles")
  expect(f.alerts[0].message).toContain("broken")
  expect(f.calls.filter(call => call[0] === "list")).toHaveLength(1)
})

test("help and invalid input only show usage", async () => {
  const f = fakeContext()
  await runProfileCommand(f.ctx, "help")
  expect(f.alerts[0]).toMatchObject({ title: "Crew 配置档" })
  expect(f.alerts[0].message).toContain("/crew-profile")
  await runProfileCommand(f.ctx, "fast slow")
  expect(f.alerts[1].title).toBe("用法")
  expect(f.alerts[1].message).toContain("/crew-profile")
  expect(f.calls).toHaveLength(0)
})

test("refreshProfile never throws and reports an unavailable host", async () => {
  const f = fakeContext()
  f.state.listThrows = true
  await expect(refreshProfile(f.ctx)).resolves.toBeUndefined()
  await runProfileCommand(f.ctx, "")
  expect(f.alerts[0].message).toContain("宿主不支持 RPC")
  await runProfileCommand(f.ctx, "list")
  expect(f.alerts[1].message).toContain("宿主不支持 RPC")
})

test("rememberProfile ignores missing views and survives a broken store", () => {
  const f = fakeContext()
  rememberProfile(f.ctx, undefined)
  expect(readMemory(f.memory)).toBeUndefined()
  const broken: any = { ...f.ctx, storage: { memory: () => { throw new Error("no store") } } }
  expect(() => rememberProfile(broken, offView)).not.toThrow()
})
