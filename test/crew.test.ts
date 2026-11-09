import { test, expect } from "bun:test"
import { readFileSync, existsSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { splitRoleBody } from "../src/model-family"

const entry = new URL("../src/index.ts", import.meta.url)
// Missing implementation returns a semantic red light rather than an import error.
async function plugin() {
  return existsSync(entry) ? (await import(entry.href)).default : { id: "not-implemented", setup: async () => {} }
}
function fixture(options: any = {}, rootPermissions: any[] = [], seeds: Record<string, any[]> = {}) {
  const agents = new Map<string, any>([["root", { id: "root", permissions: rootPermissions }], ...Object.entries(seeds).map(([id, permissions]) => [id, { id, permissions }] as [string, any])])
  const commands: any[] = [], calls: any[] = []
  const ctx: any = {
    options, location: { directory: fileURLToPath(new URL("..", import.meta.url)) },
    agent: { transform: async (fn: any) => fn({
      get: (id: string) => agents.get(id), list: () => [...agents.values()],
      update: (id: string, fn: any) => { const a = agents.get(id) ?? { id, permissions: [] }; fn(a); agents.set(id, a) },
    }), reload: async () => calls.push("reload") },
    command: { transform: async (fn: any) => fn({ add: (c: any) => commands.push(c) }) },
    tool: { transform: async (fn: any) => fn({ add: () => {} }) },
    session: {
      hook: async () => ({ dispose: async () => {} }),
      switchAgent: async (a: any) => calls.push(["agent", a]),
      switchModel: async (a: any) => calls.push(["model", a]),
      prompt: async (a: any) => calls.push(["prompt", a]),
    },
  }
  return { ctx, agents, commands, calls }
}
const models = { root: "example/root#high", engineer: "example/worker#medium", reviewer: "other/review", explorer: "fast/search" }
function roleBody(id: string) {
  return readFileSync(new URL(`../agents/${id}.md`, import.meta.url), "utf8").split(/^---\s*$/m).slice(2).join("---").trim()
}
function effect(agent: any, action: string, resource = "*") {
  // Exact resources + '*' suffice for these test cases; not a replacement for the host evaluator.
  return agent.permissions.filter((p: any) => (p.action === action || p.action === "*") && (p.resource === resource || p.resource === "*")).at(-1)?.effect
}

test("registers Crew and five distinct Markdown-backed roles", async () => {
  const p = await plugin(), f = fixture({ models }); await p.setup(f.ctx)
  expect(p.id).toBe("opencode-crew")
  expect([...f.agents.keys()].sort()).toEqual(["architect", "engineer", "explorer", "reviewer", "root"])
  for (const [id, a] of f.agents) {
    // Unknown/example models keep shared contract only; appendices stay optional.
    expect(a.system).toBe(splitRoleBody(roleBody(id)).base)
    expect(a.system).not.toContain("## 附录")
  }
})
test("model family selects exactly one appendix per role: gpt gets gpt, claude gets claude, unknown gets base only", async () => {
  const f = fixture({ models: { root: "openai/gpt-4o#high", engineer: "openai/gpt-4.1", explorer: "anthropic/claude-sonnet-4" } })
  await (await plugin()).setup(f.ctx)
  const family: Record<string, "gpt" | "claude" | "unknown"> = { root: "gpt", engineer: "gpt", explorer: "claude", architect: "unknown", reviewer: "unknown" }
  for (const [id, a] of f.agents) {
    const parts = splitRoleBody(roleBody(id))
    const familyName = family[id]
    expect(a.system).toBe([parts.base, familyName === "unknown" ? "" : parts[familyName]].filter(Boolean).join("\n\n"))
    const other = familyName === "claude" ? parts.gpt : parts.claude
    if (other) expect(a.system).not.toContain(other)
  }
})
test("Root can edit, execute and delegate; native policy permits direct verified work", async () => {
  const f = fixture(); await (await plugin()).setup(f.ctx)
  const a = f.agents.get("root"); expect(a).toBeDefined()
  expect(a.mode).toBe("primary")
  for (const tool of ["edit", "shell", "execute", "subagent"]) expect(effect(a, tool)).not.toBe("deny")
})
test("Root preserves host rules including asks and denies without adding an allow", async () => {
  const rules = [
    { action: "*", resource: "*", effect: "allow" },
    { action: "read", resource: "secret.env", effect: "ask" },
    { action: "shell", resource: "*", effect: "ask" },
    { action: "execute", resource: "blocked", effect: "deny" },
  ]
  const f = fixture({}, structuredClone(rules)); await (await plugin()).setup(f.ctx)
  const root = f.agents.get("root")
  expect(root.permissions).toEqual(rules)
  expect(effect(root, "read", "secret.env")).toBe("ask")
  expect(effect(root, "shell", "git status")).toBe("ask")
  expect(effect(root, "execute", "blocked")).toBe("deny")
  for (const action of ["edit", "subagent", "execute"]) expect(effect(root, action, "ordinary")).toBe("allow")
  const empty = fixture(); await (await plugin()).setup(empty.ctx)
  expect(empty.agents.get("root").permissions).toEqual([])
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
    expect(f.agents.size).toBe(1)
    expect(f.agents.get("root")).toEqual({ id: "root", permissions: [] })
  }
})
test("bare /crew switches role without sending an empty model request", async () => {
  const f = fixture({ models }); await (await plugin()).setup(f.ctx)
  await f.commands[0].execute({ sessionID: "ses_test", prompt: { text: "" }, delivery: "steer" })
  expect(f.calls.map(c => c[0])).toEqual(["agent", "model"])
})
test("engineer cannot recursively delegate and keeps the configured step cap", async () => {
  const f = fixture(); await (await plugin()).setup(f.ctx)
  const a = f.agents.get("engineer"); expect(a).toBeDefined()
  expect(effect(a, "subagent")).toBe("deny")
  expect(a.steps).toBe(80)
})
test("engineer retains ordered host defaults and custom rules before Crew denies without mutating inputs", async () => {
  const rules = [
    { action: "*", resource: "*", effect: "allow" },
    { action: "read", resource: "*.env", effect: "ask" },
    { action: "read", resource: "*.env.*", effect: "ask" },
    { action: "read", resource: "*.env.example", effect: "allow" },
    { action: "shell", resource: "git push", effect: "deny" },
    { action: "shell", resource: "sensitive", effect: "ask" },
    { action: "subagent", resource: "*", effect: "allow" },
    { action: "question", resource: "*", effect: "allow" },
    { action: "execute", resource: "*", effect: "allow" },
  ]
  const original = structuredClone(rules)
  const f = fixture({}, [], { engineer: rules }); await (await plugin()).setup(f.ctx)
  const a = f.agents.get("engineer")
  expect(a.permissions).toEqual([...original, ...["subagent", "question", "execute"].map(action => ({ action, resource: "*", effect: "deny" }))])
  expect(rules).toEqual(original)
  expect(effect(a, "shell", "git status")).toBe("allow")
  expect(effect(a, "shell", "git push")).toBe("deny")
  expect(effect(a, "shell", "sensitive")).toBe("ask")
  expect(effect(a, "read", "*.env")).toBe("ask")
  for (const action of ["subagent", "question", "execute"]) expect(effect(a, action)).toBe("deny")
})
test("strict roles still replace seeded host permissions", async () => {
  const host = [{ action: "*", resource: "*", effect: "allow" }]
  const f = fixture({}, [], { architect: structuredClone(host), explorer: structuredClone(host), reviewer: structuredClone(host) })
  await (await plugin()).setup(f.ctx)
  for (const id of ["architect", "explorer", "reviewer"]) {
    const a = f.agents.get(id)
    expect(effect(a, "execute")).toBe("deny")
    expect(effect(a, "subagent")).toBe("deny")
    expect(a.permissions[0]).not.toEqual(host[0])
  }
})

// V2 whole-value wildcards, as documented; host path canonicalization is separate.
function wildcardEffect(agent: any, action: string, resource: string) {
  const match = (pattern: string, value: string) => new RegExp('^' + pattern.split('').map(c => c === '*' ? '.*' : c === '?' ? '.' : c.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')).join('') + '$').test(value)
  return agent.permissions.filter((r: any) => match(r.action, action) && match(r.resource, resource)).at(-1)?.effect ?? 'ask'
}
test('strict roles inherit the host external_directory policy instead of overriding it', async () => {
  const f = fixture(); await (await plugin()).setup(f.ctx)
  for (const id of ['architect', 'explorer', 'reviewer']) {
    const a = f.agents.get(id)
    // Agent rules are appended after global rules and the last match wins, so an
    // explicit allow here would silently override a user's external_directory ask/deny.
    expect(a.permissions.some((r: any) => r.action === 'external_directory')).toBe(false)
    expect(wildcardEffect(a, 'skill', 'opencode')).toBe('allow')
    for (const path of ['.env', 'nested/.env.production', '/outside/.env', '/outside/.env.local']) expect(wildcardEffect(a, 'read', path)).toBe('ask')
    for (const path of ['src/index.ts', '/outside/AGENTS.md', '/outside/.env.example']) expect(wildcardEffect(a, 'read', path)).toBe('allow')
    for (const action of ['glob', 'grep']) expect(wildcardEffect(a, action, 'example')).toBe('allow')
    for (const action of ['execute', 'subagent', 'question']) expect(wildcardEffect(a, action, '*')).toBe('deny')
  }
})
test('strict write and fixed shell rules enforce whole-value wildcard boundaries', async () => {
  const f = fixture(); await (await plugin()).setup(f.ctx)
  const architect = f.agents.get('architect'), reviewer = f.agents.get('reviewer'), explorer = f.agents.get('explorer')
  const location = f.ctx.location.directory.replace(/\/$/, '')
  for (const path of ['plans/a.md', `${location}/plans/a.md`]) expect(wildcardEffect(architect, 'edit', path)).toBe('allow')
  for (const path of ['src/a.ts', '/outside/plans/a.md', `${location}/src/a.ts`]) expect(wildcardEffect(architect, 'edit', path)).toBe('deny')
  expect(wildcardEffect(explorer, 'edit', 'plans/a.md')).toBe('deny')
  expect(wildcardEffect(explorer, 'shell', 'git status')).toBe('deny')
  for (const rule of reviewer.permissions.filter((r: any) => r.action === 'shell')) {
    expect(wildcardEffect(reviewer, 'shell', rule.resource)).toBe('allow')
    expect(wildcardEffect(reviewer, 'shell', rule.resource + ' --help')).toBe('deny')
  }
  for (const command of ['git status', 'git push', 'git reset --hard', 'sh -c id']) expect(wildcardEffect(reviewer, 'shell', command)).toBe('deny')
})

test("architect ready means an implementable plan with verification assigned to engineer, not personal execution", () => {
  const base = splitRoleBody(roleBody("architect")).base
  expect(base).toContain("验证步骤已交给 engineer")
  expect(base).toContain("无 shell 权限不构成 blocked")
})

// --- Crew profiles (MVP) -----------------------------------------------------
// These cases point this process at a temporary profile directory for their
// duration; the preloaded test/setup.ts keeps every other case isolated.
function profileDir(files: Record<string, unknown>, active?: string) {
  const dir = mkdtempSync(join(tmpdir(), "crew-profile-case-"))
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(dir, `${name}.json`), typeof body === "string" ? body : JSON.stringify(body))
  }
  if (active !== undefined) writeFileSync(join(dir, "active"), `${active}\n`)
  const previous = process.env.OPENCODE_CREW_PROFILES_DIR
  process.env.OPENCODE_CREW_PROFILES_DIR = dir
  return {
    dir,
    restore: () => {
      if (previous === undefined) delete process.env.OPENCODE_CREW_PROFILES_DIR
      else process.env.OPENCODE_CREW_PROFILES_DIR = previous
    },
  }
}
/** Captures the transform so a test can replay it like `agent.reload()` does. */
function replayable(f: ReturnType<typeof fixture>) {
  const editor = {
    get: (id: string) => f.agents.get(id),
    list: () => [...f.agents.values()],
    update: (id: string, fn: any) => { const a = f.agents.get(id) ?? { id, permissions: [] }; fn(a); f.agents.set(id, a) },
  }
  const runs: Array<() => void> = []
  f.ctx.agent.transform = async (fn: any) => { runs.push(() => fn(editor)); return fn(editor) }
  return runs
}
const profileModels = {
  root: "prof/root#high",
  architect: "prof/architect",
  engineer: "prof/engineer#medium",
  explorer: "prof/explorer",
  reviewer: "prof/reviewer#high",
}

test("an active profile replaces models, steps and engineer instructions for all five roles", async () => {
  const scope = profileDir({ fast: { models: profileModels, steps: { engineer: 12, reviewer: 9 }, engineerInstructions: ["profile rule"] } }, "fast")
  try {
    const f = fixture({ models })
    await (await plugin()).setup(f.ctx)
    expect(f.agents.get("root").model).toEqual({ providerID: "prof", id: "root", variant: "high" })
    expect(f.agents.get("architect").model).toEqual({ providerID: "prof", id: "architect" })
    expect(f.agents.get("explorer").model).toEqual({ providerID: "prof", id: "explorer" })
    expect(f.agents.get("reviewer").model).toEqual({ providerID: "prof", id: "reviewer", variant: "high" })
    expect(f.agents.get("engineer").model).toEqual({ providerID: "prof", id: "engineer", variant: "medium" })
    expect(f.agents.get("engineer").steps).toBe(12)
    expect(f.agents.get("reviewer").steps).toBe(9)
    // Steps not in the profile fall back to Markdown frontmatter.
    expect(f.agents.get("architect").steps).toBe(40)
    // Whole-profile replacement: options.engineerInstructions never stacks.
    expect(f.agents.get("engineer").system).toContain("## 项目补充规则")
    expect(f.agents.get("engineer").system).toContain("profile rule")
  } finally { scope.restore() }
})

test("a profile without models.root keeps the session model on /crew and re-reads after off", async () => {
  const scope = profileDir({ noroot: { steps: { engineer: 20 } } }, "noroot")
  try {
    const f = fixture({ models })
    await (await plugin()).setup(f.ctx)
    const command = f.commands.find(c => c.name === "crew")
    await command.execute({ sessionID: "ses_test", prompt: { text: "hi" }, delivery: "steer" })
    expect(f.calls.map(c => c[0])).toEqual(["agent", "prompt"])
    expect(f.agents.get("engineer").steps).toBe(20)
    expect(f.agents.get("engineer").model).toBeUndefined()

    // /crew-profile off deletes the pointer; the next call sees the options config.
    writeFileSync(join(scope.dir, "active"), "")
    await command.execute({ sessionID: "ses_test", prompt: { text: "hi" }, delivery: "steer" })
    expect(f.calls.filter(c => c[0] === "model")).toHaveLength(1)
    expect(f.calls.find(c => c[0] === "model")[1].model).toEqual({ providerID: "example", id: "root", variant: "high" })
  } finally { scope.restore() }
})

test("agent transforms read the live profile and appends stay idempotent across reloads", async () => {
  const seeded = [
    { action: "*", resource: "*", effect: "allow" },
    { action: "subagent", resource: "*", effect: "allow" },
  ]
  const scope = profileDir({ fast: { steps: { engineer: 15 } } }, undefined)
  try {
    const f = fixture({ models }, [], { engineer: structuredClone(seeded) })
    const runs = replayable(f)
    await (await plugin()).setup(f.ctx)
    expect(runs).toHaveLength(1)
    runs[0]()
    runs[0]()
    const engineer = f.agents.get("engineer")
    const denied = engineer.permissions.filter((p: any) => p.effect === "deny" && ["subagent", "question", "execute"].includes(p.action))
    expect(denied).toHaveLength(3)
    expect(engineer.permissions.filter((p: any) => p.action === "subagent" && p.effect === "allow")).toHaveLength(1)
    const architect = f.agents.get("architect")
    const absolute = architect.permissions.filter((p: any) => p.action === "edit" && p.resource.endsWith("/plans/**"))
    expect(absolute).toHaveLength(1)

    // Switching the pointer is visible to the very next transform.
    writeFileSync(join(scope.dir, "active"), "fast\n")
    runs[0]()
    expect(f.agents.get("engineer").steps).toBe(15)
  } finally { scope.restore() }
})

test("a broken profile never blocks setup; the plugin runs from options", async () => {
  const scope = profileDir({ broken: { models: { root: "not-a-model" } } }, "broken")
  try {
    const f = fixture({ models })
    await expect((await plugin()).setup(f.ctx)).resolves.toBeUndefined()
    expect(f.agents.get("root").model).toEqual({ providerID: "example", id: "root", variant: "high" })
    expect(f.agents.get("engineer").model).toEqual({ providerID: "example", id: "worker", variant: "medium" })
  } finally { scope.restore() }
})
