import { test, expect } from "bun:test"
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"

const entry = new URL("../src/index.ts", import.meta.url)
async function plugin() {
  return existsSync(entry) ? (await import(entry.href)).default : { id: "not-implemented", setup: async (_ctx: any) => {} }
}
type Effect = "allow" | "ask" | "deny"
type Rule = { action: string; resource: string; effect: Effect }
const roles = ["architect", "explorer", "reviewer"]
const rule = (action: string, resource: string, effect: Effect): Rule => ({ action, resource, effect })
// New-agent baseline from node_modules/@opencode/schema/dist/agent.js:34-39.
const BASE = [rule("*", "*", "allow"), rule("read", "*.env", "ask"), rule("read", "*.env.*", "ask"), rule("read", "*.env.example", "allow")]
const DENY_ALL = [rule("external_directory", "*", "deny")]
const ASK_ALL = [rule("external_directory", "*", "ask")]
const DENY_SCOPED = [rule("external_directory", "/outside/blocked/*", "deny")]
// Hostile rules model global tail injection, not rules to add to the product.
const HOSTILE_TAIL = ["shell", "edit", "execute", "subagent", "probe_unknown_tool", "*"].map(a => rule(a, "*", "allow"))
const COLLIDE = [rule("read", "*.env", "ask"), rule("crew_s0_sentinel", "*", "ask"), rule("read", "*.env.example", "allow"), ...DENY_SCOPED]
const git = [
  "git --no-optional-locks -c core.fsmonitor=false --no-pager status --porcelain=v1 --untracked-files=all",
  "git --no-optional-locks -c core.fsmonitor=false --no-pager rev-parse HEAD",
  "git --no-optional-locks -c core.fsmonitor=false --no-pager diff --no-ext-diff --no-textconv",
  "git --no-optional-locks -c core.fsmonitor=false --no-pager diff --cached --no-ext-diff --no-textconv",
  "git --no-optional-locks -c core.fsmonitor=false --no-pager log -10 --format=oneline",
]
function fixture(prefix: Rule[] = BASE) {
  const agents = new Map<string, any>([["root", { id: "root", permissions: [] }], ...roles.map(id => [id, { id, permissions: structuredClone(prefix) }] as [string, any])])
  const hooks: any[] = [], runs: Array<() => void> = [], sessions = new Map<string, any>(), calls: any[] = []
  const editor = {
    get: (id: string) => agents.get(id), list: () => [...agents.values()],
    update: (id: string, fn: any) => { const a = agents.get(id) ?? { id, permissions: [] }; fn(a); agents.set(id, a) },
  }
  const ctx: any = {
    options: {}, location: { directory: fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "") },
    agent: { transform: async (fn: any) => { runs.push(() => fn(editor)); return fn(editor) }, reload: async () => {} },
    command: { transform: async (fn: any) => fn({ add: () => {} }) },
    tool: { transform: async (fn: any) => fn({ add: () => {} }) },
    permission: { hook: async (name: string, cb: any) => { hooks.push({ name, cb }); return { dispose: async () => {} } } },
    session: {
      hook: async () => ({ dispose: async () => {} }),
      get: async (input: any) => { calls.push(input); const value = sessions.get(input.sessionID); if (value instanceof Error) throw value; return value },
      switchAgent: async () => {}, switchModel: async () => {}, prompt: async () => {},
    },
  }
  return { ctx, agents, hooks, runs, sessions, calls }
}
async function setup(prefix: Rule[] = BASE) { const f = fixture(prefix); await (await plugin()).setup(f.ctx); return f }
function matches(pattern: string, value: string) {
  return new RegExp("^" + pattern.split("").map(c => c === "*" ? ".*" : c === "?" ? "." : c.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")).join("") + "$").test(value)
}
// Test approximation of findLast, not the host evaluator; no match defaults to ask.
function hostEffect(agent: any, action: string, resource: string): Effect {
  return agent.permissions.filter((r: Rule) => matches(r.action, action) && matches(r.resource, resource)).at(-1)?.effect ?? "ask"
}
const severity: Record<Effect, number> = { allow: 0, ask: 1, deny: 2 }
async function decide(f: ReturnType<typeof fixture>, input: { agent?: any; sessionID: string; action: string; resources: string[] }, hostAgent = input.agent, forced?: Effect) {
  const resources = input.resources.length ? input.resources : ["*"]
  const agent = f.agents.get(hostAgent) ?? { permissions: BASE }
  const effect = forced ?? resources.map(r => hostEffect(agent, input.action, r)).reduce((a, b) => severity[a] >= severity[b] ? a : b)
  const event: any = { ...input, effect }
  for (const hook of f.hooks.filter(h => h.name === "evaluate")) await hook.cb(event)
  return event
}
const query = (agent: string | undefined, action: string, ...resources: string[]) => ({ agent, sessionID: "ses_test", action, resources })
function tail(f: ReturnType<typeof fixture>, rules: Rule[]) { for (const id of roles) f.agents.get(id).permissions.push(...structuredClone(rules)) }

for (const id of roles) {
  test(`A ${id}: baseline external ordinary allow`, async () => {
    const f = await setup(); expect((await decide(f, query(id, "external_directory", "/outside/ok/f.txt"))).effect).toBe("allow")
  })
  for (const [name, global, path, expected] of [
    ["ask before", ASK_ALL, "/outside/ok/f.txt", "ask"], ["deny before", DENY_ALL, "/outside/ok/f.txt", "deny"],
    ["scoped before ordinary", DENY_SCOPED, "/outside/ok/f.txt", "allow"], ["scoped before blocked", DENY_SCOPED, "/outside/blocked/a", "deny"],
  ] as const) test(`A ${id}: ${name}`, async () => {
    const f = await setup([...BASE, ...global]); expect((await decide(f, query(id, "external_directory", path))).effect).toBe(expected)
  })
  for (const [name, global, expected] of [["ask", ASK_ALL, "ask"], ["deny", DENY_ALL, "deny"]] as const) test(`A ${id}: ${name} global after block`, async () => {
    const f = await setup(); tail(f, global); expect((await decide(f, query(id, "external_directory", "/outside/a"))).effect).toBe(expected)
  })
  for (const [path, expected] of [["/outside/ok/a", "allow"], ["/outside/blocked/a", "deny"]] as const) test(`A ${id}: scoped global after block ${path}`, async () => {
    const f = await setup(); tail(f, DENY_SCOPED); expect((await decide(f, query(id, "external_directory", path))).effect).toBe(expected)
  })
  test(`A ${id}: empty prefix stays without allow and external defaults ask`, async () => {
    const f = await setup([]), rules = f.agents.get(id).permissions
    expect(rules.some((r: Rule) => r.action === "*" && r.effect === "allow")).toBe(false)
    expect(rules.some((r: Rule) => r.action === "external_directory")).toBe(false)
    expect(hostEffect(f.agents.get(id), "external_directory", "/outside/a")).toBe("ask")
  })
  test(`B ${id}: host prefix preserved without mutation`, async () => {
    const prefix = [...BASE, ...COLLIDE], original = structuredClone(prefix), f = fixture(prefix)
    const input = f.agents.get(id).permissions
    await (await plugin()).setup(f.ctx)
    expect(input).toEqual(original)
    expect(f.agents.get(id).permissions.slice(0, prefix.length)).toEqual(original)
  })
  test(`B ${id}: block excludes external-matching actions and has explicit denies`, async () => {
    const f = await setup(), block: Rule[] = f.agents.get(id).permissions.slice(BASE.length)
    expect(block.some(r => matches(r.action, "external_directory"))).toBe(false)
    expect(block.some(r => r.action === "*" && r.effect === "allow")).toBe(false)
    for (const action of ["shell", "edit", "execute", "subagent", "question", ...(id === "reviewer" ? ["webfetch", "websearch"] : [])]) expect(block).toContainEqual(rule(action, "*", "deny"))
  })
  for (const action of ["probe_unknown_tool", "execute", "subagent", "question"]) test(`D ${id}: hostile tail cannot allow ${action}`, async () => {
    const f = await setup(); tail(f, HOSTILE_TAIL); expect((await decide(f, query(id, action, "anything"))).effect).toBe("deny")
  })
  for (const [path, expected] of [[".env", "ask"], ["nested/.env.production", "ask"], ["/outside/.env", "ask"], ["/outside/.env.example", "allow"], ["src/a.ts", "allow"]] as const) test(`D ${id}: hostile tail read ${path}`, async () => {
    const f = await setup(); tail(f, HOSTILE_TAIL); expect((await decide(f, query(id, "read", path))).effect).toBe(expected)
  })
  test(`D ${id}: external hook preserves all host effects`, async () => {
    const f = await setup()
    for (const effect of ["allow", "ask", "deny"] as Effect[]) expect((await decide(f, query(id, "external_directory", "/outside/a"), id, effect)).effect).toBe(effect)
  })
  test(`D ${id}: never relax host deny or ask`, async () => {
    const f = await setup()
    for (const effect of ["deny", "ask"] as Effect[]) expect((await decide(f, query(id, "read", "src/a.ts"), id, effect)).effect).toBe(effect)
  })
  test(`D ${id}: multi-resource read uses strictest`, async () => {
    const f = await setup(); tail(f, HOSTILE_TAIL); expect((await decide(f, query(id, "read", "src/a.ts", ".env"))).effect).toBe("ask")
  })
}

test("B architect absolute plans rule occurs once", async () => {
  const f = await setup(); expect(f.agents.get("architect").permissions.filter((r: Rule) => r.action === "edit" && r.resource === `${f.ctx.location.directory}/plans/**` && r.effect === "allow")).toHaveLength(1)
})
test("C exactly one evaluate hook, not per transform replay", async () => {
  const f = await setup(); expect(f.hooks.filter(h => h.name === "evaluate")).toHaveLength(1); f.runs[0](); f.runs[0](); expect(f.hooks.filter(h => h.name === "evaluate")).toHaveLength(1)
})
for (const mode of ["reject", "missing"]) test(`C hook ${mode} aborts before read role registration`, async () => {
  const f = fixture(); for (const id of roles) f.agents.delete(id)
  f.ctx.permission.hook = mode === "reject" ? async () => { throw new Error("hook unavailable") } : undefined
  await expect((await plugin()).setup(f.ctx)).rejects.toThrow()
  for (const id of roles) expect(f.agents.has(id)).toBe(false)
})
test("D reviewer retains exactly five allowed git commands under hostile tail", async () => {
  const f = await setup(); const shell = f.agents.get("reviewer").permissions.filter((r: Rule) => r.action === "shell" && r.effect === "allow")
  expect(shell.map((r: Rule) => r.resource)).toEqual(git); tail(f, HOSTILE_TAIL)
  for (const command of git) {
    expect((await decide(f, query("reviewer", "shell", command))).effect).toBe("allow")
    expect((await decide(f, query("reviewer", "shell", command + " --help"))).effect).toBe("deny")
  }
  for (const command of ["git status", "git push", "sh -c id"]) expect((await decide(f, query("reviewer", "shell", command))).effect).toBe("deny")
  expect((await decide(f, query("reviewer", "shell", git[0], "git push"))).effect).toBe("deny")
})
test("D architect edits only lexical plans; other read roles never edit or shell", async () => {
  const f = await setup(); tail(f, HOSTILE_TAIL)
  for (const path of ["plans/a.md", `${f.ctx.location.directory}/plans/a.md`]) expect((await decide(f, query("architect", "edit", path))).effect).toBe("allow")
  for (const path of ["src/a.ts", `${f.ctx.location.directory}/src/a.ts`, "/outside/plans/a.md"]) expect((await decide(f, query("architect", "edit", path))).effect).toBe("deny")
  for (const id of ["explorer", "reviewer"]) expect((await decide(f, query(id, "edit", "plans/a.md"))).effect).toBe("deny")
  for (const id of ["explorer", "architect"]) expect((await decide(f, query(id, "shell", "git status"))).effect).toBe("deny")
})
test("D empty resources evaluated as star", async () => {
  const f = await setup(); tail(f, HOSTILE_TAIL)
  for (const action of ["execute", "edit"]) expect((await decide(f, query("architect", action))).effect).toBe("deny")
})
test("regression: local plans and env boundaries without hostile tail", async () => {
  const f = await setup(), a = f.agents.get("architect")
  expect(hostEffect(a, "edit", "plans/a.md")).toBe("allow")
  expect(hostEffect(a, "edit", "/outside/plans/a.md")).toBe("deny")
  for (const id of roles) {
    expect(hostEffect(f.agents.get(id), "read", "/outside/.env")).toBe("ask")
    expect(hostEffect(f.agents.get(id), "read", "/outside/.env.example")).toBe("allow")
  }
})
test("E explicit reviewer takes precedence over engineer session", async () => {
  const f = await setup(); tail(f, HOSTILE_TAIL); f.sessions.set("ses_test", { agent: "engineer" })
  expect((await decide(f, query("reviewer", "shell", "git push"))).effect).toBe("deny")
  expect(f.calls).toHaveLength(0)
})
for (const id of ["root", "engineer", "custom"]) test(`E explicit ${id} ignores reviewer session`, async () => {
  const f = await setup(); f.sessions.set("ses_test", { agent: "reviewer" })
  expect((await decide(f, query(id, "edit", "src/a.ts"), id, "allow")).effect).toBe("allow")
  expect(f.calls).toHaveLength(0)
})
test("E missing agent falls back to reviewer session", async () => {
  const f = await setup(); tail(f, HOSTILE_TAIL); f.sessions.set("ses_test", { agent: "reviewer" })
  for (const [action, resource] of [["probe_unknown_tool", "x"], ["shell", "git push"]]) expect((await decide(f, query(undefined, action, resource), "reviewer")).effect).toBe("deny")
  expect(f.calls).toContainEqual({ sessionID: "ses_test" })
})
test("E missing agent with engineer session does not intervene", async () => {
  const f = await setup(); f.sessions.set("ses_test", { agent: "engineer" })
  expect((await decide(f, query(undefined, "edit", "src/a.ts"), "engineer", "allow")).effect).toBe("allow")
})
for (const [name, value] of [["throws", new Error("unavailable")], ["missing", {}], ["non-string", { agent: 42 }]] as const) test(`E unidentified session ${name}: deny and preserve external`, async () => {
  const f = await setup(); f.sessions.set("ses_test", value)
  const result = await decide(f, query(undefined, "edit", "src/a.ts"), "engineer", "allow")
  expect(result.effect).toBe("deny"); expect(typeof result.message === "string" && result.message.length > 0).toBe(true)
  for (const effect of ["allow", "ask", "deny"] as Effect[]) expect((await decide(f, query(undefined, "external_directory", "/outside/a"), "engineer", effect)).effect).toBe(effect)
})
test("F fixed array transform replay preserves prefix and is idempotent", async () => {
  const f = await setup(); const before = structuredClone(f.agents.get("architect").permissions)
  f.runs[0](); f.runs[0](); expect(f.agents.get("architect").permissions).toEqual(before)
  expect(before.slice(0, BASE.length)).toEqual(BASE)
})
test("F simulated fresh-baseline reload replay, not a live host reload", async () => {
  const f = await setup()
  for (const prefix of [BASE, [...BASE, ...DENY_SCOPED]]) {
    f.agents.get("architect").permissions = structuredClone(prefix); f.runs[0]()
    const first = structuredClone(f.agents.get("architect").permissions)
    f.agents.get("architect").permissions = structuredClone(prefix); f.runs[0]()
    expect(f.agents.get("architect").permissions).toEqual(first)
    expect(first.slice(0, prefix.length)).toEqual(prefix)
  }
})
test("F accumulated block plus global tail replay neither reorders nor duplicates", async () => {
  const f = await setup(); tail(f, DENY_SCOPED)
  const before = structuredClone(f.agents.get("architect").permissions); f.runs[0]()
  expect(f.agents.get("architect").permissions).toEqual(before)
})
test("F colliding prefix survives fixed-array replay without losing count or order", async () => {
  const prefix = [...BASE, ...COLLIDE], f = await setup(prefix); f.runs[0]()
  const rules: Rule[] = f.agents.get("reviewer").permissions
  expect(rules.slice(0, prefix.length)).toEqual(prefix)
  for (const item of prefix) expect(rules.filter(r => JSON.stringify(r) === JSON.stringify(item)).length).toBeGreaterThanOrEqual(prefix.filter(r => JSON.stringify(r) === JSON.stringify(item)).length)
  expect(hostEffect(f.agents.get("reviewer"), "read", ".env")).toBe("ask")
  expect(hostEffect(f.agents.get("reviewer"), "read", ".env.example")).toBe("allow")
  expect(rules.filter(r => r.action === "crew_s0_sentinel")).toHaveLength(1)
  expect(rules.filter(r => JSON.stringify(r) === JSON.stringify(DENY_SCOPED[0]))).toHaveLength(1)
})
