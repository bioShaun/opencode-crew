import { test, expect } from "bun:test"
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"

const entry = new URL("../src/tui/view-model.ts", import.meta.url)
// Missing implementation returns a semantic red light rather than an import error.
async function vm() {
  return existsSync(entry) ? await import(entry.href) : {}
}
const MISSING = !existsSync(fileURLToPath(entry))
const plain = (spans: any[]) => spans.map((s: any) => s.text).join("")

const tok = (input: number, output: number, reasoning = 0, write = 0, read = 0) => ({ input, output, reasoning, cache: { read, write } })
const session = (id: string, extra: any = {}) => ({ id, agent: "engineer", created: 1000, updated: 60_000_000, tokens: tok(10, 10), ...extra })
const assistant = (content: any[], extra: any = {}) => ({ type: "assistant", time: { created: 1 }, content, ...extra })
const tool = (name: string, status: string, input: any = {}) => ({ type: "tool", name, state: { status, input }, time: { created: 1 } })
const reasoning = (completed: number | undefined = 1) => ({ type: "reasoning", text: "…", time: { created: 1, completed } })
const text = (t: string) => ({ type: "text", text: t })
const task = (extra: any = {}) => ({ taskID: "ct_x", directory: "/repo/wt", scopes: 2, state: "submitted", lifecycle: "active", check: "bun test", permissions: [], ...extra })

function input(over: any = {}) {
  const { sessions = [], messages = {}, statuses = {}, costs = {}, limits, ...rest } = over
  const lim: Record<string, number> = limits ?? { architect: 40, engineer: 80, explorer: 30, reviewer: 30 }
  return {
    rootID: "root", sessions, boundary: 0, tasks: [], now: 60_000_000,
    status: (id: string) => statuses[id] ?? "idle",
    messages: (id: string) => messages[id] ?? [],
    cost: (id: string) => costs[id] ?? 0,
    limit: (agent: string | undefined) => lim[agent ?? ""] ?? lim.engineer,
    ...rest,
  }
}

test("cells counts CJK as two columns and truncates with ellipsis", async () => {
  const m = await vm() as any
  if (MISSING) { expect(MISSING).toBe(false); return }
  expect(m.cells("abc")).toBe(3)
  expect(m.cells("无输出")).toBe(6)
  expect(m.truncateCells("abcdefghij", 6)).toBe("abcde…")
  expect(m.truncateCells("无输出六分钟整", 7)).toBe("无输出…")
  expect(m.padEndCells("eng", 6)).toBe("eng   ")
  expect(m.padEndCells("无输出", 8)).toBe("无输出  ")
  expect(m.padStartCells("~1/80", 6)).toBe(" ~1/80")
})

test("busyLabel mirrors the host: reasoning, running and streaming tools", async () => {
  const m = await vm() as any
  if (MISSING) { expect(MISSING).toBe(false); return }
  expect(m.busyLabel(reasoning(undefined))).toBe("Thinking…")
  expect(m.busyLabel(tool("shell", "running"))).toBe("Running command…")
  expect(m.busyLabel(tool("bash", "running"))).toBe("Running command…")
  expect(m.busyLabel(tool("execute", "running"))).toBe("Running code…")
  expect(m.busyLabel(tool("read", "running"))).toBe("Running read…")
  expect(m.busyLabel(tool("write", "streaming"))).toBe("Preparing write…")
  expect(m.busyLabel(tool("task", "running"))).toBe("Running subagent…")
})

test("sessionActivity picks the active part of the latest assistant message", async () => {
  const m = await vm() as any
  if (MISSING) { expect(MISSING).toBe(false); return }
  const msgs = [
    assistant([reasoning()], { time: { created: 1, completed: 2 } }),
    assistant([tool("grep", "running")]),
  ]
  expect(m.sessionActivity(msgs)).toBe("Running grep…")
  expect(m.sessionActivity([assistant([text("done")], { time: { created: 1, completed: 2 } })])).toBe("Thinking…")
  expect(m.sessionActivity([assistant([reasoning(undefined)])])).toBe("Thinking…")
  expect(m.sessionActivity([])).toBe("Thinking…")
})

test("countSteps and tokenTotal follow the documented approximation", async () => {
  const m = await vm() as any
  if (MISSING) { expect(MISSING).toBe(false); return }
  expect(m.countSteps([assistant([]), { type: "user" }, assistant([])])).toBe(2)
  expect(m.tokenTotal(tok(1, 2, 4, 8, 16))).toBe(15)
  expect(m.tokenTotal(undefined)).toBe(0)
})

test("compactTokens and money format the Subagents columns", async () => {
  const m = await vm() as any
  if (MISSING) { expect(MISSING).toBe(false); return }
  expect(m.compactTokens(999)).toBe("999")
  expect(m.compactTokens(38000)).toBe("38k")
  expect(m.compactTokens(1240000)).toBe("1.2M")
  expect(m.compactTokens(2000000)).toBe("2M")
  expect(m.money(0.42)).toBe("$0.42")
  expect(m.money(12.3)).toBe("$12.30")
})

test("subagentAnomalies implements all four warning rules with floors", async () => {
  const m = await vm() as any
  if (MISSING) { expect(MISSING).toBe(false); return }
  const stat = (role: string, extra: any = {}) => ({ role, calls: 1, tokens: 1000, cost: 0.05, fullSteps: 0, ...extra })
  const quiet = [stat("engineer", { calls: 3, tokens: 300000, cost: 0.6 }), stat("explorer", { calls: 2 })]
  expect(m.subagentAnomalies(quiet).size).toBe(0)
  const full = [stat("engineer"), stat("explorer", { fullSteps: 1 })]
  expect(m.subagentAnomalies(full).has("explorer")).toBe(true)
  const calls = [stat("engineer", { calls: 2 }), stat("explorer", { calls: 5 })]
  expect(m.subagentAnomalies(calls).has("explorer")).toBe(true)
  const callsLow = [stat("engineer"), stat("explorer", { calls: 4 })]
  expect(m.subagentAnomalies(callsLow).size).toBe(0)
  const tokens = [stat("engineer", { tokens: 200000 }), stat("explorer", { tokens: 500000 })]
  expect(m.subagentAnomalies(tokens).has("explorer")).toBe(true)
  const tokensLow = [stat("engineer", { tokens: 100000 }), stat("explorer", { tokens: 250000 })]
  expect(m.subagentAnomalies(tokensLow).size).toBe(0)
  const cost = [stat("engineer", { cost: 0.4 }), stat("explorer", { cost: 1.0 })]
  expect(m.subagentAnomalies(cost).has("explorer")).toBe(true)
  const anomaly = [stat("architect", { tokens: 38000, cost: 0.15 }), stat("engineer", { tokens: 290000, cost: 0.44 }), stat("explorer", { calls: 9, tokens: 640000, cost: 1.41, fullSteps: 1 })]
  expect(m.subagentAnomalies(anomaly).has("explorer")).toBe(true)
  expect(m.subagentAnomalies(anomaly).has("engineer")).toBe(false)
})

test("active state: nested running rows, running count and +N done", async () => {
  const m = await vm() as any
  if (MISSING) { expect(MISSING).toBe(false); return }
  const view = m.buildSidebar(input({
    sessions: [
      session("root", { agent: "root" }),
      session("eng", { created: 2000 }),
      session("exp", { agent: "explorer", parentID: "eng", created: 3000 }),
      session("old1", { agent: "reviewer", created: 1500 }),
      session("old2", { agent: "architect", created: 1600 }),
    ],
    statuses: { eng: "running", exp: "running" },
    messages: {
      eng: [assistant([tool("shell", "running")])],
      exp: [assistant([tool("read", "running")])],
    },
  }))
  expect(view.delegations.runningCount).toBe(2)
  expect(view.delegations.rows.length).toBe(3)
  expect(plain(view.delegations.rows[0])).toBe("engineer   Running command…     ~1/80")
  expect(plain(view.delegations.rows[1])).toBe("  explorer Running read…        ~1/30")
  expect(plain(view.delegations.rows[2])).toBe("+2 done")
  expect(view.alerts.length).toBe(0)
})

test("idle state: delegations hidden, subagents still listed", async () => {
  const m = await vm() as any
  if (MISSING) { expect(MISSING).toBe(false); return }
  const view = m.buildSidebar(input({
    boundary: 5000,
    sessions: [
      session("root", { agent: "root" }),
      session("eng", { created: 2000, tokens: tok(200000, 212000), cost: 0 }),
      session("rev", { agent: "reviewer", created: 3000, tokens: tok(30000, 22000) }),
    ],
    costs: { eng: 0.62, rev: 0.21 },
  }))
  expect(view.delegations).toBeUndefined()
  expect(view.subagents).toBeDefined()
  expect(plain(view.subagents!.title)).toBe("Subagents (2 calls · $0.83)")
  const rows = view.subagents!.rows.map(plain)
  expect(rows.some((r: string) => r.startsWith("engineer"))).toBe(true)
  expect(rows.some((r: string) => r.startsWith("reviewer"))).toBe(true)
})

test("calls are counted from subagent tool calls, not sessions", async () => {
  const m = await vm() as any
  if (MISSING) { expect(MISSING).toBe(false); return }
  const view = m.buildSidebar(input({
    sessions: [
      session("root", { agent: "root" }),
      session("eng", { created: 2000, agent: "engineer" }),
    ],
    messages: {
      root: [
        assistant([tool("subagent", "completed", { agent: "engineer" }), tool("task", "completed", { agent: "engineer", sessionID: "eng" })]),
        assistant([tool("subagent", "completed", { agent: "explorer", sessionID: "missing" })]),
      ],
      eng: [assistant([tool("subagent", "completed", { agent: "explorer" })])],
    },
  }))
  const rows = Object.fromEntries(view.subagents!.rows.map((r: any[]) => [plain(r).trim().split(/\s+/)[0], r]))
  expect(plain(rows.engineer)).toContain("2")
  expect(plain(view.subagents!.title)).toContain("4 calls")
})

test("stalled running session shows 无输出 and the whole row is warning", async () => {
  const m = await vm() as any
  if (MISSING) { expect(MISSING).toBe(false); return }
  const now = 10 * 60_000
  const view = m.buildSidebar(input({
    now,
    sessions: [
      session("root", { agent: "root" }),
      session("eng", { created: 2000, updated: now - 6 * 60_000 }),
    ],
    statuses: { eng: "running" },
    messages: { eng: [assistant([tool("shell", "running")])] },
  }))
  const row = view.delegations.rows[0]
  expect(plain(row)).toContain("无输出 6m")
  expect(row.every((s: any) => s.tone === "warning")).toBe(true)
})

test("a delegation row warns at 80% of the step limit", async () => {
  const m = await vm() as any
  if (MISSING) { expect(MISSING).toBe(false); return }
  const steps = Array.from({ length: 26 }, () => assistant([reasoning()]))
  const view = m.buildSidebar(input({
    sessions: [session("root", { agent: "root" }), session("exp", { agent: "explorer", created: 2000 })],
    statuses: { exp: "running" },
    messages: { exp: [...steps, assistant([tool("grep", "running")])] },
  }))
  const row = view.delegations.rows[0]
  expect(plain(row)).toContain("~27/30")
  expect(row.every((s: any) => s.tone === "warning")).toBe(true)
})

test("crew_task rows: two lines, report colors, check/next and budget warning", async () => {
  const m = await vm() as any
  if (MISSING) { expect(MISSING).toBe(false); return }
  const view = m.buildSidebar(input({
    sessions: [session("root", { agent: "root" })],
    tasks: [
      task({ taskID: "ct_fixture", report: { status: "blocked", reason: "缺少 fixture" }, steps: 17 }),
      task({ taskID: "ct_migrate", report: { status: "failed", reason: "bun test 退出 1" }, steps: 80 }),
      task({ taskID: "ct_api", report: { status: "waiting" }, steps: 23 }),
      task({ taskID: "ct_done", report: { status: "ready" }, steps: 40 }),
      task({ taskID: "ct_drop", report: { status: "dropped" }, steps: 4 }),
    ],
  }))
  expect(view.delegations.runningCount).toBe(1)
  const rows = view.delegations.rows.map(plain)
  const i = rows.findIndex((r: string) => r.startsWith("ct_fixture"))
  expect(rows[i]).toBe("ct_fixture             blocked ~17/80")
  expect(plain(view.delegations.rows[i + 1])).toBe("next 缺少 fixture")
  const j = rows.findIndex((r: string) => r.startsWith("ct_migrate"))
  expect(rows[j]).toBe("ct_migrate              failed ~80/80")
  const head = view.delegations.rows[j]
  expect(head.find((s: any) => s.text === "failed").tone).toBe("error")
  expect(head.filter((s: any) => s.tone === "warning").length).toBeGreaterThan(0)
  const k = rows.findIndex((r: string) => r.startsWith("ct_api"))
  expect(plain(view.delegations.rows[k + 1])).toBe("check bun test")
  const l = rows.findIndex((r: string) => r.startsWith("ct_done"))
  expect(plain(view.delegations.rows[l + 1])).toBe("next Root 验收证据")
  expect(rows.some((r: string) => r.startsWith("ct_drop"))).toBe(false)
})

test("alerts come only from crew_task permissions, blocked and failed", async () => {
  const m = await vm() as any
  if (MISSING) { expect(MISSING).toBe(false); return }
  const view = m.buildSidebar(input({
    sessions: [session("root", { agent: "root" })],
    tasks: [
      task({ taskID: "ct_api", sessionID: "s1", directory: "/repo/wt", permissions: [{ action: "edit", resources: ["/repo/wt/src/api.ts"] }] }),
      task({ taskID: "ct_fixture", report: { status: "blocked", reason: "缺少 fixture" } }),
      task({ taskID: "ct_migrate", report: { status: "failed" } }),
      task({ taskID: "ct_ok", report: { status: "progress" } }),
    ],
  }))
  const rows = view.alerts.map((a: any) => plain(a.spans))
  expect(rows).toContain("! ct_api        权限 edit src/api.ts")
  expect(rows.some((r: string) => /^! ct_fixture +blocked/.test(r))).toBe(true)
  expect(rows.some((r: string) => /^! ct_migrate +failed/.test(r))).toBe(true)
  expect(rows.some((r: string) => r.includes("ct_ok"))).toBe(false)
  const perm = view.alerts[0]
  expect(perm.spans[0]).toEqual({ text: "!", tone: "warning" })
  expect(perm.sessionID).toBe("s1")
  const failed = view.alerts.find((a: any) => plain(a.spans).includes("ct_migrate"))
  expect(failed.spans.find((s: any) => s.text === "failed").tone).toBe("error")
})

test("anomaly state: warning rows in both Delegations and Subagents", async () => {
  const m = await vm() as any
  if (MISSING) { expect(MISSING).toBe(false); return }
  const expSteps = Array.from({ length: 26 }, () => assistant([reasoning()]))
  const view = m.buildSidebar(input({
    sessions: [
      session("root", { agent: "root" }),
      session("eng", { created: 2000, tokens: tok(100000, 190000) }),
      session("exp", { agent: "explorer", parentID: "eng", created: 3000, tokens: tok(300000, 340000) }),
      session("done1", { agent: "explorer", created: 2500, tokens: tok(1000, 1000) }),
    ],
    statuses: { eng: "running", exp: "running" },
    costs: { eng: 0.44, exp: 1.40, done1: 0.01 },
    messages: {
      eng: [assistant([tool("edit", "running")])],
      exp: [...expSteps, assistant([tool("grep", "running")])],
      root: [
        ...Array.from({ length: 9 }, () => assistant([tool("subagent", "completed", { agent: "explorer" })])),
        assistant([tool("subagent", "completed", { agent: "engineer" })]),
      ],
    },
  }))
  const expRow = view.delegations.rows[1]
  expect(plain(expRow)).toContain("~27/30")
  expect(expRow.every((s: any) => s.tone === "warning")).toBe(true)
  const sa = view.subagents!.rows.find((r: any[]) => plain(r).startsWith("explorer"))
  expect(sa.every((s: any) => s.tone === "warning")).toBe(true)
  expect(plain(view.subagents!.title)).toContain("10 calls")
})

test("crew_task sessions count as one engineer call each in Subagents", async () => {
  const m = await vm() as any
  if (MISSING) { expect(MISSING).toBe(false); return }
  const view = m.buildSidebar(input({
    sessions: [session("root", { agent: "root" })],
    tasks: [
      task({ taskID: "ct_a", report: { status: "progress" }, steps: 3, tokens: 5000, cost: 0.10 }),
      task({ taskID: "ct_b", report: { status: "ready" }, steps: 81, tokens: 7000, cost: 0.20 }),
    ],
  }))
  const eng = view.subagents!.rows.find((r: any[]) => plain(r).startsWith("engineer"))
  expect(plain(eng)).toContain("2")
  expect(plain(eng)).toContain("12k")
  expect(plain(eng)).toContain("$0.30")
  expect(eng.every((s: any) => s.tone === "warning")).toBe(true)
})

test("long identifiers are truncated inside their columns", async () => {
  const m = await vm() as any
  if (MISSING) { expect(MISSING).toBe(false); return }
  const view = m.buildSidebar(input({
    sessions: [session("root", { agent: "root" })],
    tasks: [
      task({ taskID: "ct_sidebar-permission-bridge-for-detached-engineer-sessions", report: { status: "progress" }, steps: 41, check: "bun test test/sidebar-permission-bridge.test.ts --timeout 120000 --bail" }),
    ],
  }))
  const head = view.delegations.rows[0]
  expect(plain(head)).toBe("ct_sidebar-permissio… progress ~41/80")
  expect(m.cells(plain(head))).toBe(37)
  expect(m.cells(plain(view.delegations.rows[1]))).toBeLessThanOrEqual(37)
})

test("truncation keeps rows at or under 37 cells", async () => {
  const m = await vm() as any
  if (MISSING) { expect(MISSING).toBe(false); return }
  const view = m.buildSidebar(input({
    sessions: [
      session("root", { agent: "root" }),
      session("eng", { created: 2000, agent: "security-auditor-extended" }),
    ],
    statuses: { eng: "running" },
    messages: { eng: [assistant([tool("sidebar_permission_bridge_inspect", "running")])] },
  }))
  for (const row of view.delegations.rows) expect(m.cells(plain(row))).toBeLessThanOrEqual(37)
})
