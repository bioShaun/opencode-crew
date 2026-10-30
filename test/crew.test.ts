import { test, expect } from "bun:test"
import { readFileSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"

const entry = new URL("../src/index.ts", import.meta.url)
// Missing implementation returns a semantic red light rather than an import error.
async function plugin() {
  return existsSync(entry) ? (await import(entry.href)).default : { id: "not-implemented", setup: async () => {} }
}
function fixture(options: any = {}) {
  const agents = new Map<string, any>()
  const commands: any[] = [], calls: any[] = []
  const ctx: any = {
    options, location: { directory: fileURLToPath(new URL("..", import.meta.url)) },
    agent: { transform: async (fn: any) => fn({
      get: (id: string) => agents.get(id), list: () => [...agents.values()],
      update: (id: string, fn: any) => { const a = agents.get(id) ?? { id, permissions: [] }; fn(a); agents.set(id, a) },
    }), reload: async () => calls.push("reload") },
    command: { transform: async (fn: any) => fn({ add: (c: any) => commands.push(c) }) },
    session: {
      switchAgent: async (a: any) => calls.push(["agent", a]),
      switchModel: async (a: any) => calls.push(["model", a]),
      prompt: async (a: any) => calls.push(["prompt", a]),
    },
  }
  return { ctx, agents, commands, calls }
}
const models = { root: "example/root#high", engineer: "example/worker#medium", reviewer: "other/review", explorer: "fast/search" }
function effect(agent: any, action: string, resource = "*") {
  // Exact resources + '*' suffice for these test cases; not a replacement for the host evaluator.
  return agent.permissions.filter((p: any) => (p.action === action || p.action === "*") && (p.resource === resource || p.resource === "*")).at(-1)?.effect
}

test("registers Crew and five distinct Markdown-backed roles", async () => {
  const p = await plugin(), f = fixture({ models }); await p.setup(f.ctx)
  expect(p.id).toBe("opencode-crew")
  expect([...f.agents.keys()].sort()).toEqual(["architect", "engineer", "explorer", "reviewer", "root"])
  for (const [id, a] of f.agents) {
    expect(a.system).toBe(readFileSync(new URL(`../agents/${id}.md`, import.meta.url), "utf8").split(/^---\s*$/m).slice(2).join("---").trim())
  }
})
test("Root can edit, execute and delegate; native policy permits direct verified work", async () => {
  const f = fixture(); await (await plugin()).setup(f.ctx)
  const a = f.agents.get("root"); expect(a).toBeDefined()
  expect(a.mode).toBe("primary")
  for (const tool of ["edit", "shell", "execute", "subagent"]) expect(effect(a, tool)).not.toBe("deny")
  expect(a.system).toContain("可直接完成修改与验证")
  expect(a.system).toContain("一次委派")
})
test("configured models are parsed; omitted model inherits, no concrete defaults", async () => {
  const f = fixture({ models }); await (await plugin()).setup(f.ctx)
  expect(f.agents.get("root")?.model).toEqual({ providerID: "example", id: "root", variant: "high" })
  expect(f.agents.get("engineer")?.model).toEqual({ providerID: "example", id: "worker", variant: "medium" })
  expect(f.agents.get("architect")).toBeDefined()
  expect(f.agents.get("architect").model).toBeUndefined()
})
test("reviewer keeps exactly five read-only git commands and no write/delegation", async () => {
  const f = fixture(); await (await plugin()).setup(f.ctx)
  const a = f.agents.get("reviewer"); expect(a).toBeDefined()
  for (const tool of ["edit", "execute", "subagent"]) expect(effect(a, tool)).toBe("deny")
  expect(effect(a, "shell", "git status")).toBe("deny")
  const git = a.permissions.filter((p: any) => p.action === "shell" && p.effect === "allow")
  expect(git).toHaveLength(5)
  expect(git.every((p: any) => p.resource.startsWith("git --no-optional-locks -c core.fsmonitor=false --no-pager "))).toBe(true)
})
test("explorer cannot execute/write; architect only edits plans and cannot shell/Code Mode", async () => {
  const f = fixture(); await (await plugin()).setup(f.ctx)
  for (const id of ["explorer", "architect"]) {
    const a = f.agents.get(id); expect(a).toBeDefined()
    for (const tool of ["shell", "execute", "subagent"]) expect(effect(a, tool)).toBe("deny")
  }
  expect(effect(f.agents.get("explorer"), "edit")).toBe("deny")
  const a = f.agents.get("architect")
  expect(effect(a, "edit", "src/main.ts")).toBe("deny")
  expect(effect(a, "edit", "plans/**")).toBe("allow")
})
test("/crew switches Root, preserves attachments and delivery, optionally selects configured model", async () => {
  const f = fixture({ models }); await (await plugin()).setup(f.ctx)
  const c = f.commands.find(c => c.name === "crew"); expect(c).toBeDefined()
  const prompt = { text: "fix", files: [{ uri: "file:///project/input" }], skills: ["abc"] }
  await c.execute({ sessionID: "ses_test", prompt, delivery: "queue" })
  expect(f.calls[0]).toEqual(["agent", { sessionID: "ses_test", agent: "root" }])
  expect(f.calls[1][0]).toBe("model")
  expect(f.calls[2]).toEqual(["prompt", { ...prompt, sessionID: "ses_test", delivery: "queue" }])
  const g = fixture(); await (await plugin()).setup(g.ctx)
  await g.commands[0].execute({ sessionID: "ses_test", prompt: { text: "hi" }, delivery: "steer" })
  expect(g.calls.some(c => c[0] === "model")).toBe(false)
})
test("invalid or unknown options fail before registering any agent", async () => {
  const p = await plugin()
  for (const options of [{ models: { root: "bad" } }, { models: { typo: "p/m" } }, { models: { root: "/empty" } }, { workerSteps: 50 }]) {
    const f = fixture(options)
    await expect(p.setup(f.ctx)).rejects.toThrow("opencode-crew")
    expect(f.agents.size).toBe(0)
  }
})
test("bare /crew switches role without sending an empty model request", async () => {
  const f = fixture({ models }); await (await plugin()).setup(f.ctx)
  await f.commands[0].execute({ sessionID: "ses_test", prompt: { text: "" }, delivery: "steer" })
  expect(f.calls.map(c => c[0])).toEqual(["agent", "model"])
})
test("engineer has verification and BLOCKED rules and cannot recursively delegate", async () => {
  const f = fixture(); await (await plugin()).setup(f.ctx)
  const a = f.agents.get("engineer"); expect(a).toBeDefined()
  expect(effect(a, "subagent")).toBe("deny")
  expect(a.system).toContain("BLOCKED")
  expect(a.system).toContain("先只写测试")
  expect(a.steps).toBe(80)
})
