import { test, expect } from "bun:test"
import { fileURLToPath } from "node:url"
import plugin from "../src/index.ts"

type Effect = "allow" | "ask" | "deny"
const effects: Effect[] = ["allow", "ask", "deny"]
const source = { type: "tool", messageID: "m", id: "c" }
async function fixture() {
  const agents = new Map<string, any>(["root", "architect", "explorer", "reviewer"].map(id => [id, { id, permissions: [] }]))
  const hooks: any[] = [], runs: Array<() => void> = [], sessions = new Map<string, any>()
  const editor = { get: (id: string) => agents.get(id), list: () => [...agents.values()], update: (id: string, fn: any) => { const a = agents.get(id) ?? { id, permissions: [] }; fn(a); agents.set(id, a) } }
  const ctx: any = {
    options: {}, location: { directory: fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "") },
    agent: { transform: async (fn: any) => { runs.push(() => fn(editor)); return fn(editor) }, reload: async () => {} },
    command: { transform: async (fn: any) => fn({ add: () => {} }) },
    tool: { transform: async (fn: any) => fn({ add: () => {} }) },
    permission: { hook: async (name: string, cb: any) => { hooks.push({ name, cb }); return { dispose: async () => {} } } },
    session: { hook: async () => ({ dispose: async () => {} }), get: async ({ sessionID }: any) => { const value = sessions.get(sessionID); if (value instanceof Error) throw value; return value }, switchAgent: async () => {}, switchModel: async () => {}, prompt: async () => {} },
  }
  await plugin.setup(ctx)
  async function decide(agent: string | undefined, action = "subagent", resources = ["engineer"], effect: Effect = "allow", extra = {}) {
    const event: any = { agent, sessionID: "ses_x", action, resources, effect, ...extra }
    for (const hook of hooks.filter(h => h.name === "evaluate")) await hook.cb(event)
    return event
  }
  return { agents, hooks, runs, sessions, decide }
}
for (const agent of ["build", "plan", "my-primary"]) for (const effect of ["allow", "ask"] as Effect[]) test(`1 ${agent} engineer ${effect} denied`, async () => {
  const f = await fixture(), result = await f.decide(agent, "subagent", ["engineer"], effect)
  expect(result.effect).toBe("deny"); expect(result.message).toBe(`Crew：engineer 只能由 Root 派发（调用者：${agent}）。请用 /crew 切到 Root，或改派 explorer / architect / reviewer。`)
})
test("2 other targets retain host effect", async () => {
  const f = await fixture()
  for (const agent of ["build", "plan", "my-primary"]) for (const target of ["reviewer", "explorer", "architect"]) for (const effect of ["allow", "ask"] as Effect[]) expect((await f.decide(agent, "subagent", [target], effect)).effect).toBe(effect)
})
test("3 multi-resource matches engineer, empty does not", async () => {
  const f = await fixture()
  expect((await f.decide("build", "subagent", ["reviewer", "engineer"])).effect).toBe("deny")
  expect((await f.decide("build", "subagent", [])).effect).toBe("allow")
  expect((await f.decide("build", "subagent", ["other/engineer"])).effect).toBe("allow")
})
test("4 root internal asserts and crew task actions retain host decisions", async () => {
  const f = await fixture()
  for (const effect of effects) {
    expect((await f.decide("root", "subagent", ["engineer"], effect, { source })).effect).toBe(effect)
    for (const agent of ["root", "build"]) for (const action of ["crew_task_start", "crew_task_status", "crew_task_stop"]) expect((await f.decide(agent, action, [fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "")], effect, { source })).effect).toBe(effect)
  }
})
test("5 root preserves effect and message", async () => {
  const f = await fixture()
  for (const effect of effects) { const result = await f.decide("root", "subagent", ["engineer"], effect); expect(result.effect).toBe(effect); expect(result.message).toBeUndefined() }
})
test("6 hostile global allow cannot permit build", async () => {
  const f = await fixture(); expect((await f.decide("build")).effect).toBe("deny")
})
test("7 missing identity falls back to build", async () => {
  const f = await fixture(); f.sessions.set("ses_x", { agent: "build" }); expect((await f.decide(undefined)).effect).toBe("deny")
})
test("7 missing identity root and lookup error", async () => {
  const f = await fixture(); f.sessions.set("ses_x", { agent: "root" }); expect((await f.decide(undefined)).effect).toBe("allow")
  f.sessions.set("ses_x", new Error("unavailable")); expect((await f.decide(undefined)).effect).toBe("deny")
})
test("8 Code Mode root retains effect", async () => {
  const f = await fixture(); expect((await f.decide("root", "subagent", ["engineer"], "allow", { source })).effect).toBe("allow")
})
test("8 Code Mode build denied", async () => {
  const f = await fixture(); expect((await f.decide("build", "subagent", ["engineer"], "allow", { source })).effect).toBe("deny")
})
test("9 crew roles retain host deny", async () => {
  const f = await fixture(); for (const agent of ["engineer", "reviewer"]) expect((await f.decide(agent, "subagent", ["engineer"], "deny")).effect).toBe("deny")
})
test("10 one evaluate hook after replay and no root permissions added", async () => {
  const f = await fixture(); expect(f.hooks.filter(h => h.name === "evaluate")).toHaveLength(1); f.runs[0](); f.runs[0]()
  expect(f.hooks.filter(h => h.name === "evaluate")).toHaveLength(1); expect(f.agents.get("root").permissions).toEqual([])
})
