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

/** Hard stall and step-budget warnings skip the model cell and the gap after it. */
function expectDelegationWarning(row: any[]) {
  expect(row[2].tone).toBe("muted")
  expect(row[3].tone).toBe("muted")
  expect(row.filter((_: any, i: number) => i !== 2 && i !== 3).every((s: any) => s.tone === "warning")).toBe(true)
}

const tok = (input: number, output: number, reasoning = 0, write = 0, read = 0) => ({ input, output, reasoning, cache: { read, write } })
const session = (id: string, extra: any = {}) => ({
  id, agent: "engineer", created: 1000, updated: 60_000_000, tokens: tok(10, 10),
  model: { id: "gpt-5", providerID: "openai" },
  ...extra,
})
const assistant = (content: any[], extra: any = {}) => ({ type: "assistant", time: { created: 1 }, content, ...extra })
const tool = (name: string, status: string, input: any = {}) => ({ type: "tool", name, state: { status, input }, time: { created: 1 } })
const reasoning = (completed: number | undefined = 1) => ({ type: "reasoning", text: "…", time: { created: 1, completed } })
const text = (t: string) => ({ type: "text", text: t })
const task = (extra: any = {}) => ({ taskID: "ct_x", directory: "/repo/wt", scopes: 2, state: "submitted", lifecycle: "active", check: "bun test", permissions: [], ...extra })

function input(over: any = {}) {
  const { sessions = [], messages = {}, statuses = {}, costs = {}, limits, ...rest } = over
  const lim: Record<string, number> = limits ?? { architect: 40, engineer: 80, explorer: 30, reviewer: 30 }
  return {
    rootID: "root", sessions, tasks: [], now: 60_000_000,
    status: (id: string) => statuses[id] ?? "idle",
    messages: (id: string) => messages[id] ?? [],
    cost: (id: string) => costs[id] ?? 0,
    limit: (agent: string | undefined) => lim[agent ?? ""] ?? lim.engineer,
    ...rest,
  }
}

test("cells counts CJK as two columns and truncates with ellipsis", async () => {
  const m = await vm() as any
  if (MISSING) { expect(MISSING as boolean).toBe(false); return }
  expect(m.cells("abc")).toBe(3)
  expect(m.cells("无输出")).toBe(6)
  expect(m.truncateCells("abcdefghij", 6)).toBe("abcde…")
  expect(m.truncateCells("无输出六分钟整", 7)).toBe("无输出…")
  expect(m.padEndCells("eng", 6)).toBe("eng   ")
  expect(m.padEndCells("无输出", 8)).toBe("无输出  ")
  expect(m.padStartCells("~1/80", 6)).toBe(" ~1/80")
})

test("busyLabel uses the compact sidebar form: noun only, prep for streaming", async () => {
  const m = await vm() as any
  if (MISSING) { expect(MISSING as boolean).toBe(false); return }
  expect(m.busyLabel(reasoning(undefined))).toBe("thinking…")
  expect(m.busyLabel(tool("shell", "running"))).toBe("command…")
  expect(m.busyLabel(tool("bash", "running"))).toBe("command…")
  expect(m.busyLabel(tool("execute", "running"))).toBe("code…")
  expect(m.busyLabel(tool("read", "running"))).toBe("read…")
  expect(m.busyLabel(tool("write", "streaming"))).toBe("prep write…")
  expect(m.busyLabel(tool("task", "running"))).toBe("subagent…")
})

test("sessionActivity picks the active part of the latest assistant message", async () => {
  const m = await vm() as any
  if (MISSING) { expect(MISSING as boolean).toBe(false); return }
  const msgs = [
    assistant([reasoning()], { time: { created: 1, completed: 2 } }),
    assistant([tool("grep", "running")]),
  ]
  expect(m.sessionActivity(msgs)).toBe("grep…")
  expect(m.sessionActivity([assistant([text("done")], { time: { created: 1, completed: 2 } })])).toBe("thinking…")
  expect(m.sessionActivity([assistant([reasoning(undefined)])])).toBe("thinking…")
  expect(m.sessionActivity([])).toBe("thinking…")
})

test("countSteps and tokenTotal follow the documented approximation", async () => {
  const m = await vm() as any
  if (MISSING) { expect(MISSING as boolean).toBe(false); return }
  expect(m.countSteps([assistant([]), { type: "user" }, assistant([])])).toBe(2)
  expect(m.tokenTotal(tok(1, 2, 4, 8, 16))).toBe(15)
  expect(m.tokenTotal(undefined)).toBe(0)
})

test("compactTokens and money format the Subagents columns", async () => {
  const m = await vm() as any
  if (MISSING) { expect(MISSING as boolean).toBe(false); return }
  expect(m.compactTokens(999)).toBe("999")
  expect(m.compactTokens(38000)).toBe("38k")
  expect(m.compactTokens(1240000)).toBe("1.2M")
  expect(m.compactTokens(2000000)).toBe("2M")
  expect(m.money(0.42)).toBe("$0.42")
  expect(m.money(12.3)).toBe("$12.30")
})

test("subagentAnomalies implements all four warning rules with floors", async () => {
  const m = await vm() as any
  if (MISSING) { expect(MISSING as boolean).toBe(false); return }
  const stat = (role: string, extra: any = {}) => ({ role, sessions: 1, tokens: 1000, cost: 0.05, fullSteps: 0, ...extra })
  const quiet = [stat("engineer", { sessions: 3, tokens: 300000, cost: 0.6 }), stat("explorer", { sessions: 2 })]
  expect(m.subagentAnomalies(quiet).size).toBe(0)
  const full = [stat("engineer"), stat("explorer", { fullSteps: 1 })]
  expect(m.subagentAnomalies(full).has("explorer")).toBe(true)
  const runs = [stat("engineer", { sessions: 2 }), stat("explorer", { sessions: 5 })]
  expect(m.subagentAnomalies(runs).has("explorer")).toBe(true)
  const runsLow = [stat("engineer"), stat("explorer", { sessions: 4 })]
  expect(m.subagentAnomalies(runsLow).size).toBe(0)
  const tokens = [stat("engineer", { tokens: 200000 }), stat("explorer", { tokens: 500000 })]
  expect(m.subagentAnomalies(tokens).has("explorer")).toBe(true)
  const tokensLow = [stat("engineer", { tokens: 100000 }), stat("explorer", { tokens: 250000 })]
  expect(m.subagentAnomalies(tokensLow).size).toBe(0)
  const cost = [stat("engineer", { cost: 0.4 }), stat("explorer", { cost: 1.0 })]
  expect(m.subagentAnomalies(cost).has("explorer")).toBe(true)
  const anomaly = [stat("architect", { tokens: 38000, cost: 0.15 }), stat("engineer", { tokens: 290000, cost: 0.44 }), stat("explorer", { sessions: 9, tokens: 640000, cost: 1.41, fullSteps: 1 })]
  expect(m.subagentAnomalies(anomaly).has("explorer")).toBe(true)
  expect(m.subagentAnomalies(anomaly).has("engineer")).toBe(false)
})

test("active state: nested running rows and running count", async () => {
  const m = await vm() as any
  if (MISSING) { expect(MISSING as boolean).toBe(false); return }
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
  expect(view.delegations.rows.length).toBe(2)
  expect(plain(view.delegations.rows[0])).toBe("engineer   gpt-5   command…     ~1/80")
  expect(plain(view.delegations.rows[1])).toBe("  explorer gpt-5   read…        ~1/30")
  expect(view.alerts.length).toBe(0)
})

test("inline model column shows the alias between role and activity", async () => {
  const m = await vm() as any
  if (MISSING) { expect(MISSING as boolean).toBe(false); return }
  const view = m.buildSidebar(input({
    modelDisplay: "inline",
    modelAliases: {
      "deepseek/deepseek-v4.1-flash": "ds4.1",
      "anthropic/claude-haiku-4-5": "h4-lite",
    },
    sessions: [
      session("root", { agent: "root" }),
      session("eng", {
        created: 2000,
        model: { id: "deepseek-v4.1-flash", providerID: "deepseek", variant: "xhigh" },
      }),
      session("exp", {
        agent: "explorer",
        created: 3000,
        model: { id: "claude-haiku-4-5", providerID: "anthropic", variant: "low" },
      }),
    ],
    statuses: { eng: "running", exp: "running" },
    messages: {
      eng: [...Array.from({ length: 40 }, () => assistant([])), assistant([tool("edit", "running")])],
      exp: [...Array.from({ length: 7 }, () => assistant([])), assistant([tool("read", "running")])],
    },
  }))
  expect(plain(view.delegations.rows[0])).toBe("engineer   ds4.1   edit…       ~41/80")
  expect(plain(view.delegations.rows[1])).toBe("explorer   h4-lite read…        ~8/30")
  for (const row of view.delegations.rows) {
    expect(m.cells(plain(row))).toBe(37)
    expect(row[2].tone).toBe("muted")
    expect(row[3].tone).toBe("muted")
  }
  expect(plain(view.delegations.rows[0])).not.toContain("xhigh")
  expect(plain(view.delegations.rows[1])).not.toContain("low")
})

test("an unaliased model id is truncated to 7 cells", async () => {
  const m = await vm() as any
  if (MISSING) { expect(MISSING as boolean).toBe(false); return }
  const view = m.buildSidebar(input({
    sessions: [
      session("root", { agent: "root" }),
      session("eng", {
        created: 2000,
        model: { id: "deepseek-v4.1-flash", providerID: "deepseek", variant: "xhigh" },
      }),
    ],
    statuses: { eng: "running" },
    messages: { eng: [assistant([tool("shell", "running")])] },
  }))
  const row = view.delegations.rows[0]
  expect(plain(row)).toBe("engineer   deepse… command…     ~1/80")
  expect(row[2].text).toBe("deepse…")
  expect(m.cells(plain(row))).toBe(37)
  expect(plain(row)).not.toContain("xhigh")
})

test("a missing model renders an em dash in a 37-cell row", async () => {
  const m = await vm() as any
  if (MISSING) { expect(MISSING as boolean).toBe(false); return }
  const view = m.buildSidebar(input({
    sessions: [
      session("root", { agent: "root" }),
      session("eng", { created: 2000, model: undefined }),
    ],
    statuses: { eng: "running" },
    messages: { eng: [assistant([tool("shell", "running")])] },
  }))
  const row = view.delegations.rows[0]
  expect(plain(row)).toBe("engineer   —       command…     ~1/80")
  expect(m.cells(plain(row))).toBe(37)
  expect(row[2].tone).toBe("faint")
  expect(row[3].tone).toBe("faint")
})

test("modelDisplay off restores the 19-cell activity column", async () => {
  const m = await vm() as any
  if (MISSING) { expect(MISSING as boolean).toBe(false); return }
  const view = m.buildSidebar(input({
    modelDisplay: "off",
    sessions: [
      session("root", { agent: "root" }),
      session("eng", { created: 2000 }),
      session("exp", { agent: "explorer", parentID: "eng", created: 3000 }),
    ],
    statuses: { eng: "running", exp: "running" },
    messages: {
      eng: [assistant([tool("shell", "running")])],
      exp: [assistant([tool("read", "running")])],
    },
  }))
  const eng = view.delegations.rows[0]
  const exp = view.delegations.rows[1]
  expect(plain(eng)).toBe("engineer   command…             ~1/80")
  expect(plain(exp)).toBe("  explorer read…                ~1/30")
  expect(m.cells(eng.find((s: any) => String(s.text).includes("command")).text)).toBe(19)
  expect(m.cells(exp.find((s: any) => String(s.text).includes("read")).text)).toBe(19)
  expect(m.cells(plain(eng))).toBe(37)
  expect(m.cells(plain(exp))).toBe(37)
})

test("idle state: delegations hidden, subagents still listed", async () => {
  const m = await vm() as any
  if (MISSING) { expect(MISSING as boolean).toBe(false); return }
  const view = m.buildSidebar(input({
    sessions: [
      session("root", { agent: "root" }),
      session("eng", { created: 2000, tokens: tok(200000, 212000), cost: 0 }),
      session("rev", { agent: "reviewer", created: 3000, tokens: tok(30000, 22000) }),
    ],
    costs: { eng: 0.62, rev: 0.21 },
  }))
  expect(view.delegations).toBeUndefined()
  expect(view.subagents).toBeDefined()
  expect(plain(view.subagents!.title)).toBe("Subagents (2 sessions · $0.83)")
  const rows = view.subagents!.rows.map(plain)
  expect(rows.some((r: string) => r.startsWith("engineer"))).toBe(true)
  expect(rows.some((r: string) => r.startsWith("reviewer"))).toBe(true)
})

test("Subagents counts native sessions and folds crew_task usage into engineer", async () => {
  const m = await vm() as any
  if (MISSING) { expect(MISSING as boolean).toBe(false); return }
  const view = m.buildSidebar(input({
    sessions: [
      session("root", { agent: "root" }),
      session("eng", { created: 2000, agent: "engineer" }),
      session("eng2", { created: 2100, agent: "engineer" }),
    ],
    tasks: [
      task({ taskID: "ct_a", report: { status: "progress" }, steps: 3, tokens: 5000, cost: 0.10 }),
    ],
  }))
  const eng = view.subagents!.rows.find((r: any[]) => plain(r).startsWith("engineer"))
  expect(plain(eng)).toContain("     2 ")
  expect(plain(eng)).toContain("$0.10")
  expect(m.cells(plain(eng))).toBe(37)
  expect(m.cells(plain(view.subagents!.header))).toBe(37)
  expect(plain(view.subagents!.title)).toContain("2 sessions")
})

test("Subagents keeps the cache suffix when the token pair outgrows the column", async () => {
  const m = await vm() as any
  if (MISSING) { expect(MISSING as boolean).toBe(false); return }
  const wide = m.buildSidebar(input({
    sessions: [
      session("root", { agent: "root" }),
      session("eng", { agent: "engineer", tokens: tok(3748269, 0, 0, 0, 157507712) }),
    ],
    costs: { eng: 13.68 },
  }))
  const eng = wide.subagents!.rows.find((r: any[]) => plain(r).startsWith("engineer"))
  expect(plain(eng)).toContain("3.7M+158M")
  expect(m.cells(plain(eng))).toBe(37)

  const huge = m.buildSidebar(input({
    sessions: [
      session("root", { agent: "root" }),
      session("eng", { agent: "engineer", tokens: tok(123456789, 0, 0, 0, 1234567890) }),
    ],
  }))
  const row = huge.subagents!.rows.find((r: any[]) => plain(r).startsWith("engineer"))
  expect(plain(row)).toContain("123M+1.2B")
  expect(m.cells(plain(row))).toBe(37)
  expect(m.cells(plain(huge.subagents!.header))).toBe(37)
})

test("soft stall shows 无输出 in info; hard stall escalates the whole row to warning", async () => {
  const m = await vm() as any
  if (MISSING) { expect(MISSING as boolean).toBe(false); return }
  const softNow = 10 * 60_000
  const soft = m.buildSidebar(input({
    now: softNow,
    sessions: [
      session("root", { agent: "root" }),
      session("eng", { created: 2000, updated: softNow - 6 * 60_000 }),
    ],
    statuses: { eng: "running" },
    messages: { eng: [assistant([tool("shell", "running")])] },
  }))
  const softRow = soft.delegations.rows[0]
  expect(plain(softRow)).toContain("无输出 6m")
  expect(softRow.find((s: any) => String(s.text).includes("无输出")).tone).toBe("info")
  expect(softRow.every((s: any) => s.tone === "warning")).toBe(false)

  const hardNow = 20 * 60_000
  const hard = m.buildSidebar(input({
    now: hardNow,
    sessions: [
      session("root", { agent: "root" }),
      session("eng", { created: 2000, updated: hardNow - 16 * 60_000 }),
    ],
    statuses: { eng: "running" },
    messages: { eng: [assistant([tool("shell", "running")])] },
  }))
  const hardRow = hard.delegations.rows[0]
  expect(plain(hardRow)).toContain("无输出 16m")
  expectDelegationWarning(hardRow)
})

test("stale host updated with recent message activity is not 无输出", async () => {
  const m = await vm() as any
  if (MISSING) { expect(MISSING as boolean).toBe(false); return }
  const now = 10 * 60_000
  const base = {
    now,
    sessions: [
      session("root", { agent: "root" }),
      // The host stops advancing session.updated for step/tool events.
      session("eng", { created: 2000, updated: now - 6 * 60_000 }),
    ],
    statuses: { eng: "running" },
  }
  const active = m.buildSidebar(input({
    ...base,
    messages: { eng: [assistant([tool("shell", "running")], { time: { created: now - 1_000 } })] },
  }))
  expect(plain(active.delegations.rows[0])).not.toContain("无输出")

  const tracked = m.buildSidebar(input({ ...base, messages: {}, lastActivity: () => now - 1_000 }))
  expect(plain(tracked.delegations.rows[0])).not.toContain("无输出")

  // A poll that fetched nothing is not activity: no override and no message time.
  const silent = m.buildSidebar(input({ ...base, messages: {} }))
  expect(plain(silent.delegations.rows[0])).toContain("无输出 6m")
})

test("a delegation row warns at 80% of the step limit", async () => {
  const m = await vm() as any
  if (MISSING) { expect(MISSING as boolean).toBe(false); return }
  const steps = Array.from({ length: 26 }, () => assistant([reasoning()]))
  const view = m.buildSidebar(input({
    sessions: [session("root", { agent: "root" }), session("exp", { agent: "explorer", created: 2000 })],
    statuses: { exp: "running" },
    messages: { exp: [...steps, assistant([tool("grep", "running")])] },
  }))
  const row = view.delegations.rows[0]
  expect(plain(row)).toContain("~27/30")
  expectDelegationWarning(row)
})

test("crew_task rows: two lines, report colors, check/next and budget warning", async () => {
  const m = await vm() as any
  if (MISSING) { expect(MISSING as boolean).toBe(false); return }
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

test("alerts come from crew_task permissions, waiting, blocked and failed", async () => {
  const m = await vm() as any
  if (MISSING) { expect(MISSING as boolean).toBe(false); return }
  const view = m.buildSidebar(input({
    sessions: [session("root", { agent: "root" })],
    tasks: [
      task({ taskID: "ct_api", sessionID: "s1", directory: "/repo/wt", permissions: [{ action: "edit", resources: ["/repo/wt/src/api.ts"] }] }),
      task({ taskID: "ct_wait", sessionID: "s2", report: { status: "waiting", reason: "等人确认口径" } }),
      task({ taskID: "ct_wait2", sessionID: "s3", report: { status: "waiting" } }),
      task({ taskID: "ct_fixture", report: { status: "blocked", reason: "缺少 fixture" } }),
      task({ taskID: "ct_migrate", report: { status: "failed" } }),
      task({ taskID: "ct_ok", report: { status: "progress" } }),
      task({ taskID: "ct_ready", report: { status: "ready" } }),
    ],
  }))
  const rows = view.alerts.map((a: any) => plain(a.spans))
  expect(rows).toContain("! ct_api        权限 edit src/api.ts")
  expect(rows.some((r: string) => /^! ct_wait +waiting 等人确认口径$/.test(r))).toBe(true)
  expect(rows.some((r: string) => /^! ct_wait2 +waiting 等待外部输入$/.test(r))).toBe(true)
  expect(rows.some((r: string) => /^! ct_fixture +blocked/.test(r))).toBe(true)
  expect(rows.some((r: string) => /^! ct_migrate +failed/.test(r))).toBe(true)
  expect(rows.some((r: string) => r.includes("ct_ok"))).toBe(false)
  expect(rows.some((r: string) => r.includes("ct_ready"))).toBe(false)
  // hard failures first, then permission, then waiting (human-priority but not louder than fail)
  expect(view.alerts.map((a: any) => a.kind)).toEqual([
    "failed", "blocked", "permission", "waiting", "waiting",
  ])
  const failed = view.alerts[0]
  expect(failed.spans.find((s: any) => s.text === "failed").tone).toBe("error")
  const blocked = view.alerts.find((a: any) => a.kind === "blocked")
  expect(blocked.spans.find((s: any) => s.text === "blocked").tone).toBe("error")
  const perm = view.alerts.find((a: any) => a.kind === "permission")
  expect(perm.spans[0]).toEqual({ text: "!", tone: "warning" })
  expect(perm.sessionID).toBe("s1")
  const waiting = view.alerts.find((a: any) => plain(a.spans).includes("ct_wait "))
  expect(waiting.sessionID).toBe("s2")
  expect(waiting.spans.find((s: any) => s.text === "waiting").tone).toBe("warning")
})

test("anomaly state: warning rows in both Delegations and Subagents", async () => {
  const m = await vm() as any
  if (MISSING) { expect(MISSING as boolean).toBe(false); return }
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
  expectDelegationWarning(expRow)
  const sa = view.subagents!.rows.find((r: any[]) => plain(r).startsWith("explorer"))
  expect(sa.every((s: any) => s.tone === "warning")).toBe(true)
  expect(plain(view.subagents!.title)).toContain("3 sessions")
})

test("Subagents shows work tokens plus cache.read", async () => {
  const m = await vm() as any
  if (MISSING) { expect(MISSING as boolean).toBe(false); return }
  const view = m.buildSidebar(input({
    sessions: [
      session("root", { agent: "root" }),
      session("exp", { agent: "explorer", created: 2000, tokens: tok(300000, 20000, 0, 0, 5_000_000) }),
    ],
    costs: { exp: 0.15 },
    statuses: { exp: "running" },
    messages: { exp: [assistant([tool("grep", "running")])] },
  }))
  const row = view.subagents!.rows.find((r: any[]) => plain(r).startsWith("explorer"))
  expect(plain(row)).toContain("320k+5M")
})

test("crew_task usage adds to engineer without a session count", async () => {
  const m = await vm() as any
  if (MISSING) { expect(MISSING as boolean).toBe(false); return }
  const view = m.buildSidebar(input({
    sessions: [session("root", { agent: "root" })],
    tasks: [
      task({ taskID: "ct_a", report: { status: "progress" }, steps: 3, tokens: 5000, cacheRead: 1_000_000, cost: 0.10 }),
      task({ taskID: "ct_b", report: { status: "ready" }, steps: 81, tokens: 7000, cost: 0.20 }),
    ],
  }))
  const eng = view.subagents!.rows.find((r: any[]) => plain(r).startsWith("engineer"))
  expect(plain(eng)).toContain("     0 ")
  expect(plain(eng)).toContain("12k+1M")
  expect(plain(eng)).toContain("$0.30")
  expect(eng.every((s: any) => s.tone === "warning")).toBe(true)
})

test("a stale running status is vetoed by the record's idle watermark", async () => {
  const m = await vm() as any
  if (MISSING) { expect(MISSING as boolean).toBe(false); return }
  const view = m.buildSidebar(input({
    sessions: [
      session("root", { agent: "root" }),
      session("arch", { agent: "architect", created: 2000, busy: 3000, idle: 4000 }),
      session("eng", { created: 2500, busy: 6000, idle: 4000 }),
    ],
    statuses: { arch: "running" },
    messages: {
      arch: [assistant([tool("read", "completed")])],
      eng: [assistant([tool("shell", "running")])],
    },
  }))
  expect(view.delegations.runningCount).toBe(1)
  expect(view.delegations.rows.length).toBe(1)
  expect(plain(view.delegations.rows[0])).toBe("engineer   gpt-5   command…     ~1/80")
})

test("an idle-only record is hidden even with a stale running status", async () => {
  const m = await vm() as any
  if (MISSING) { expect(MISSING as boolean).toBe(false); return }
  const view = m.buildSidebar(input({
    sessions: [
      session("root", { agent: "root" }),
      session("arch", { agent: "architect", created: 2000, idle: 4000 }),
    ],
    statuses: { arch: "running" },
    messages: { arch: [assistant([tool("read", "completed")])] },
  }))
  expect(view.delegations).toBeUndefined()
})

test("status() still decides when the record has no execution watermarks", async () => {
  const m = await vm() as any
  if (MISSING) { expect(MISSING as boolean).toBe(false); return }
  const view = m.buildSidebar(input({
    sessions: [session("root", { agent: "root" }), session("eng", { created: 2000 })],
    statuses: { eng: "running" },
    messages: { eng: [assistant([tool("shell", "running")])] },
  }))
  expect(view.delegations.runningCount).toBe(1)
  expect(plain(view.delegations.rows[0])).toBe("engineer   gpt-5   command…     ~1/80")
})

test("an authoritative running set overrides the watermarks in both directions", async () => {
  const m = await vm() as any
  if (MISSING) { expect(MISSING as boolean).toBe(false); return }
  const view = m.buildSidebar(input({
    sessions: [
      session("root", { agent: "root" }),
      session("arch", { agent: "architect", created: 2000, busy: 6000, idle: 4000 }),
      session("eng", { created: 2500, busy: 3000, idle: 4000 }),
    ],
    statuses: { arch: "running", eng: "idle" },
    running: (s: any) => s.id === "eng",
    messages: {
      arch: [assistant([tool("read", "completed")])],
      eng: [assistant([tool("shell", "running")])],
    },
  }))
  expect(view.delegations.runningCount).toBe(1)
  expect(view.delegations.rows.length).toBe(1)
  expect(plain(view.delegations.rows[0])).toBe("engineer   gpt-5   command…     ~1/80")
})

test("overflowing step counts keep delegation rows at 37 cells", async () => {
  const m = await vm() as any
  if (MISSING) { expect(MISSING as boolean).toBe(false); return }
  const view = m.buildSidebar(input({
    sessions: [
      session("root", { agent: "root" }),
      session("eng", { created: 2000 }),
    ],
    statuses: { eng: "running" },
    tasks: [task({ steps: 324, report: { status: "progress" } })],
    messages: { eng: Array.from({ length: 324 }, () => assistant([])) },
  }))
  expect(plain(view.delegations.rows[0])).toContain("~324/80")
  for (const row of view.delegations.rows) expect(m.cells(plain(row))).toBeLessThanOrEqual(37)
})

test("long identifiers are truncated inside their columns", async () => {
  const m = await vm() as any
  if (MISSING) { expect(MISSING as boolean).toBe(false); return }
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
  if (MISSING) { expect(MISSING as boolean).toBe(false); return }
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

test("freshness line: 未校准, recent calibrate, and 可能滞后", async () => {
  const m = await vm() as any
  if (MISSING) { expect(MISSING as boolean).toBe(false); return }
  const none = m.buildSidebar(input({ sessions: [session("root", { agent: "root" })] }))
  expect(plain(none.freshness)).toBe("未校准")

  const fresh = m.buildSidebar(input({
    sessions: [session("root", { agent: "root" })],
    now: 60_000,
    known: true,
    calibratedAt: 57_000,
    calibrationIntervalMs: 15_000,
  }))
  expect(plain(fresh.freshness)).toBe("校准 3s 前")
  expect(fresh.freshness[0].tone).toBe("faint")

  const lag = m.buildSidebar(input({
    sessions: [session("root", { agent: "root" })],
    now: 60_000,
    known: true,
    calibratedAt: 20_000,
    calibrationIntervalMs: 15_000,
  }))
  expect(plain(lag.freshness)).toContain("可能滞后")
  expect(lag.freshness[0].tone).toBe("warning")
})

test("Subagents footnote documents tok+cache and points at sidebar-ui", async () => {
  const m = await vm() as any
  if (MISSING) { expect(MISSING as boolean).toBe(false); return }
  const view = m.buildSidebar(input({
    sessions: [
      session("root", { agent: "root" }),
      session("eng", { created: 2000, tokens: tok(10, 10, 0, 0, 100) }),
    ],
    costs: { eng: 0.01 },
  }))
  expect(view.subagents).toBeTruthy()
  expect(plain(view.subagents.footnote)).toContain("cache.read")
  expect(plain(view.subagents.footnote)).toContain("sidebar-ui")
  expect(view.subagents.footnote[0].tone).toBe("faint")
})
