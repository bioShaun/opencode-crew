import { test, expect } from "bun:test"
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"

const snapEntry = new URL("../src/snapshot.ts", import.meta.url)
const buildEntry = new URL("../src/tasks-snapshot.ts", import.meta.url)
const MISSING = !existsSync(fileURLToPath(snapEntry)) || !existsSync(fileURLToPath(buildEntry))
async function snap() { return MISSING ? {} : await import(snapEntry.href) }
async function build() { return MISSING ? {} : await import(buildEntry.href) }

const record = (extra: any = {}) => ({
  taskID: "ct_demo", ownerSessionID: "root-1", state: "submitted", sessionID: "sess-1",
  input: { key: "demo", directory: "/repo/wt", baseline: "a".repeat(40), scope: ["src/a.ts", "src/b.ts"], goal: "g", acceptance: "a", check: "bun test" },
  requestDigest: "d", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
  ...extra,
})
const entry = (extra: any = {}) => ({ record: record(extra.record), lifecycle: "active", periodID: "pd_1", ...extra })
const assistant = (texts: string[]) => ({ type: "assistant", content: texts.map(text => ({ type: "text", text })) })

test("buildTaskSnapshot emits only whitelisted fields", async () => {
  const m = await build() as any
  if (MISSING) { expect(MISSING).toBe(false); return }
  const view = m.buildTaskSnapshot(entry(), {
    observed: { outcome: "failed" },
    report: { status: "failed", reason: "bun test 退出 1" },
    steps: 80, tokens: 640000, cost: 1.41,
    permissions: [{ action: "edit", resources: ["/repo/wt/src/api.ts"] }],
  })
  expect(view).toEqual({
    taskID: "ct_demo", sessionID: "sess-1", directory: "/repo/wt", scopes: 2,
    state: "submitted", lifecycle: "active", check: "bun test",
    observed: { outcome: "failed" },
    report: { status: "failed", reason: "bun test 退出 1" },
    steps: 80, tokens: 640000, cost: 1.41,
    permissions: [{ action: "edit", resources: ["/repo/wt/src/api.ts"] }],
  })
  expect("ownerSessionID" in view).toBe(false)
  expect("input" in view).toBe(false)
  expect("requestDigest" in view).toBe(false)
  expect("closeout" in view).toBe(false)
})

test("buildTaskSnapshot tolerates missing session data", async () => {
  const m = await build() as any
  if (MISSING) { expect(MISSING).toBe(false); return }
  const view = m.buildTaskSnapshot(entry({ record: record({ sessionID: undefined }) }), {})
  expect(view.taskID).toBe("ct_demo")
  expect(view.sessionID).toBeUndefined()
  expect(view.steps).toBe(0)
  expect(view.permissions).toEqual([])
  expect(view.report).toBeUndefined()
})

test("extractReport reads the latest Report line and its reason", async () => {
  const m = await build() as any
  if (MISSING) { expect(MISSING).toBe(false); return }
  const messages = [
    assistant(["Report: progress\n在做第一部分"]),
    assistant(["收尾\nReport: blocked 缺少 ledger fixture\n详见 log"]),
  ]
  expect(m.extractReport(messages)).toEqual({ status: "blocked", reason: "缺少 ledger fixture" })
  expect(m.extractReport([assistant(["Report: ready"])])).toEqual({ status: "ready" })
  expect(m.extractReport([assistant(["Report: blocked"])])).toEqual({ status: "blocked" })
  expect(m.extractReport([assistant(["Report: failed\nbun test 退出 1"])])).toEqual({ status: "failed", reason: "bun test 退出 1" })
  expect(m.extractReport([assistant(["没有报告"])])).toBeUndefined()
  expect(m.extractReport([])).toBeUndefined()
})

test("parseTasksOutput validates and whitelists the RPC payload", async () => {
  const m = await snap() as any
  if (MISSING) { expect(MISSING).toBe(false); return }
  expect(m.parseTasksOutput(undefined)).toEqual([])
  expect(m.parseTasksOutput({})).toEqual([])
  expect(m.parseTasksOutput({ tasks: "x" })).toEqual([])
  const parsed = m.parseTasksOutput({
    tasks: [{
      taskID: "ct_a", sessionID: "s1", directory: "/repo/wt", scopes: 2,
      state: "submitted", lifecycle: "active", check: "bun test",
      report: { status: "blocked", reason: "缺 fixture" },
      observed: { outcome: "failed" },
      steps: 17, tokens: 640000, cost: 1.41,
      permissions: [{ action: "edit", resources: ["/repo/wt/src/api.ts"] }],
      internal: "drop-me",
    }, { bogus: true }, "junk"],
    extra: "drop-me",
  })
  expect(parsed.length).toBe(1)
  expect(parsed[0]).toEqual({
    taskID: "ct_a", sessionID: "s1", directory: "/repo/wt", scopes: 2,
    state: "submitted", lifecycle: "active", check: "bun test",
    report: { status: "blocked", reason: "缺 fixture" },
    observed: { outcome: "failed" },
    steps: 17, tokens: 640000, cost: 1.41,
    permissions: [{ action: "edit", resources: ["/repo/wt/src/api.ts"] }],
  })
  expect("internal" in parsed[0]).toBe(false)
})
