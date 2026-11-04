import { test, expect } from "bun:test"
import { LiveController, type LiveClock, type LiveEvent, type LiveFetch, type LiveSnapshot, type LiveStore } from "../src/tui/live"
import type { MessageView, SessionView } from "../src/tui/view-model"

const session = (id: string, extra: Partial<SessionView> = {}): SessionView => ({
  id,
  agent: "engineer",
  created: 1_000,
  updated: 1_000,
  cost: 0,
  ...extra,
})

const message = (id: string, extra: Partial<MessageView> = {}): MessageView => ({
  id,
  type: "assistant",
  time: { created: 1_000 },
  content: [{ type: "text", text: "hello" }],
  ...extra,
})

function manualClock() {
  let now = 0
  let seq = 0
  const timers: Array<{ id: number; at: number; run: () => void }> = []
  const turn = async () => { for (let i = 0; i < 25; i++) await Promise.resolve() }
  const clock: LiveClock & { advance(ms: number): Promise<void>; pending(): number } = {
    now: () => now,
    schedule: (run, ms) => {
      const id = ++seq
      timers.push({ id, at: now + ms, run })
      return id
    },
    cancel: handle => {
      const index = timers.findIndex(t => t.id === handle)
      if (index >= 0) timers.splice(index, 1)
    },
    advance: async ms => {
      const target = now + ms
      await turn()
      for (;;) {
        const due = timers.filter(t => t.at <= target).sort((a, b) => a.at - b.at)[0]
        if (!due) break
        timers.splice(timers.indexOf(due), 1)
        now = due.at
        due.run()
        await turn()
      }
      now = target
    },
    pending: () => timers.length,
  }
  return clock
}

function harness(options: {
  family?: string[]
  store?: Partial<LiveStore>
  fetch?: Partial<LiveFetch>
} = {}) {
  const clock = manualClock()
  const family = options.family ?? ["child"]
  const calls = { active: 0, session: 0, messages: 0 }
  const snapshots: LiveSnapshot[] = []
  const store: LiveStore = {
    session: id => (options.store?.session ? options.store.session(id) : id === "child" ? session(id, { parentID: "root" }) : undefined),
    messages: id => (options.store?.messages ? options.store.messages(id) : []),
  }
  const fetch: LiveFetch = {
    active: async () => {
      calls.active++
      return options.fetch?.active ? options.fetch.active() : new Set<string>()
    },
    session: async id => {
      calls.session++
      return options.fetch?.session ? options.fetch.session(id) : store.session(id)
    },
    messages: async id => {
      calls.messages++
      return options.fetch?.messages ? options.fetch.messages(id) : []
    },
  }
  const controller = new LiveController({
    rootID: "root",
    family: () => family,
    store,
    fetch,
    clock,
    onChange: snapshot => snapshots.push(snapshot),
  })
  const latest = () => snapshots[snapshots.length - 1]
  return { controller, clock, calls, snapshots, latest, store, fetch }
}

const tick = async () => { for (let i = 0; i < 25; i++) await Promise.resolve() }

test("stream events update the snapshot from the host store without HTTP", async () => {
  const held = [message("m1", { time: { created: 1_000, streamed: 2_000 } })]
  const h = harness({ store: { messages: () => held } })
  h.controller.ingest({ type: "session.tool.progress", created: 2_000, data: { sessionID: "child", assistantMessageID: "m1" } })
  await h.clock.advance(250)

  const view = h.latest().views.get("child")
  expect(view?.messages.map(m => m.id)).toEqual(["m1"])
  expect(view?.lastActivity).toBe(2_000)
  expect(h.latest().known).toBe(false)
  expect(h.calls.messages).toBe(0)
  expect(h.calls.session).toBe(0)
})

test("deltas inside one 250ms window coalesce and never restart the window", async () => {
  const held = [message("m1", { time: { created: 1_000, streamed: 1_000 } })]
  const h = harness({ store: { messages: () => held } })
  const delta = (at: number) =>
    h.controller.ingest({ type: "session.text.delta", created: at, data: { sessionID: "child", assistantMessageID: "m1" } })
  delta(0)
  await h.clock.advance(100)
  delta(100)
  await h.clock.advance(100)
  delta(200)
  await h.clock.advance(49)
  delta(249)
  await h.clock.advance(1)
  expect(h.snapshots.length).toBe(1)
  await h.clock.advance(500)
  expect(h.snapshots.length).toBe(1)
  expect(h.calls.messages).toBe(0)
})

test("active work calibrates every 15s; idle probes active only every 60s", async () => {
  const active = harness({ fetch: { active: async () => new Set(["child"]) } })
  active.controller.ingest({ type: "session.execution.started", data: { sessionID: "child" } })
  await tick()
  const first = active.calls.active
  await active.clock.advance(14_000)
  expect(active.calls.active).toBe(first)
  await active.clock.advance(1_500)
  expect(active.calls.active).toBeGreaterThan(first)
  active.controller.dispose()

  const idle = harness({ store: { messages: () => [] }, fetch: { active: async () => new Set() } })
  idle.controller.ingest({ type: "session.usage.updated", data: { sessionID: "child", cost: 0.5 } })
  await idle.clock.advance(250)
  const baseline = idle.calls.active
  await idle.clock.advance(59_000)
  expect(idle.calls.active).toBe(baseline)
  await idle.clock.advance(1_200)
  expect(idle.calls.active).toBe(baseline + 1)
  expect(idle.calls.messages).toBe(0)
  idle.controller.dispose()
})

test("a missed started event is discovered by the idle probe", async () => {
  const h = harness({ fetch: { active: async () => new Set(["child"]) } })
  h.controller.ingest({ type: "session.usage.updated", data: { sessionID: "child", cost: 1 } })
  await h.clock.advance(60_500)
  expect(h.latest().running.has("child")).toBe(true)
  expect(h.calls.messages).toBeGreaterThan(0)
})

test("a missed terminal event pulls final values and keeps them", async () => {
  let running = new Set(["child"])
  let final = [message("m1", { id: "m1", time: { created: 1_000, completed: 9_000 } })]
  const h = harness({
    fetch: { active: async () => running, messages: async () => final },
  })
  h.controller.ingest({ type: "session.execution.started", data: { sessionID: "child" } })
  await h.clock.advance(250)
  expect(h.latest().running.has("child")).toBe(true)

  running = new Set()
  final = [message("m1", { time: { created: 1_000, completed: 20_000 }, content: [{ type: "text", text: "done" }] })]
  await h.clock.advance(15_000)

  const view = h.latest().views.get("child")
  expect(h.latest().running.has("child")).toBe(false)
  expect(view?.messages[0]?.time?.completed).toBe(20_000)
  expect(view?.lastActivity).toBe(20_000)
  expect(h.latest().views.has("child")).toBe(true)
})

test("a failed final pull is retried on the next calibration", async () => {
  let running = new Set(["child"])
  let fail = true
  const h = harness({
    fetch: {
      active: async () => running,
      messages: async () => {
        if (fail) throw new Error("offline")
        return [message("m1", { time: { created: 1_000, completed: 30_000 } })]
      },
    },
  })
  h.controller.ingest({ type: "session.execution.started", data: { sessionID: "child" } })
  await h.clock.advance(250)
  running = new Set()
  await h.clock.advance(15_000)
  expect(h.latest().views.get("child")?.messages[0]?.time?.completed).toBeUndefined()

  fail = false
  await h.clock.advance(15_000)
  expect(h.latest().views.get("child")?.messages[0]?.time?.completed).toBe(30_000)
})

test("a slow response cannot roll back a newer streamed message", async () => {
  let release: ((messages: MessageView[]) => void) | undefined
  let held: MessageView[] = []
  const h = harness({
    store: { messages: () => held },
    fetch: {
      messages: () => new Promise(resolve => { release = resolve }),
    },
  })
  h.controller.ingest({ type: "session.execution.started", data: { sessionID: "child" } })
  await tick()
  expect(release).toBeDefined()

  held = [message("m1", { time: { created: 1_000, streamed: 5_000 }, content: [{ type: "text", text: "new" }] })]
  h.controller.ingest({ type: "session.text.delta", created: 5_000, data: { sessionID: "child", assistantMessageID: "m1" } })
  await h.clock.advance(250)
  expect(h.latest().views.get("child")?.messages[0]?.content?.[0]?.text).toBe("new")

  release?.([message("m1", { time: { created: 1_000, streamed: 1_000 }, content: [{ type: "text", text: "old" }] })])
  await tick()
  expect(h.latest().views.get("child")?.messages[0]?.content?.[0]?.text).toBe("new")
})

test("a new execution round keeps its own status despite the previous end", async () => {
  let active = new Set(["child"])
  const h = harness({ fetch: { active: async () => active } })
  h.controller.ingest({ type: "session.execution.started", data: { sessionID: "child" } })
  await h.clock.advance(250)
  h.controller.ingest({ type: "session.execution.succeeded", data: { sessionID: "child" } })
  await tick()
  expect(h.latest().running.has("child")).toBe(false)

  h.controller.ingest({ type: "session.execution.started", data: { sessionID: "child" } })
  await tick()
  expect(h.latest().running.has("child")).toBe(true)

  // A calibration that still sees the new round active must not mark it ended.
  active = new Set(["child"])
  await h.clock.advance(15_000)
  expect(h.latest().running.has("child")).toBe(true)
})

test("foreign sessions are ignored after a single ownership check", async () => {
  const h = harness({
    family: ["child"],
    store: { session: id => (id === "child" ? session(id, { parentID: "root" }) : id === "stranger" ? session(id, { parentID: "other-root" }) : undefined) },
  })
  for (let i = 0; i < 5; i++) {
    h.controller.ingest({ type: "session.text.delta", created: 1_000 + i, data: { sessionID: "stranger", assistantMessageID: "m1" } })
  }
  await h.clock.advance(250)
  expect(h.calls.session).toBe(1)
  expect(h.snapshots.every(snapshot => !snapshot.views.has("stranger"))).toBe(true)
  expect(h.calls.messages).toBe(0)
})

test("dispose cancels timers and ignores late responses", async () => {
  let release: ((messages: MessageView[]) => void) | undefined
  const h = harness({ fetch: { messages: () => new Promise(resolve => { release = resolve }) } })
  h.controller.ingest({ type: "session.execution.started", data: { sessionID: "child" } })
  await tick()
  const count = h.snapshots.length
  h.controller.dispose()
  release?.([message("late")])
  await h.clock.advance(120_000)
  expect(h.snapshots.length).toBe(count)
  expect(h.clock.pending()).toBe(0)
})

test("root switches drop cached views and in-flight writes", async () => {
  let release: ((messages: MessageView[]) => void) | undefined
  const h = harness({ fetch: { messages: () => new Promise(resolve => { release = resolve }) } })
  h.controller.ingest({ type: "session.execution.started", data: { sessionID: "child" } })
  await tick()
  expect(h.latest().views.size).toBe(1)
  h.controller.setRoot("other")
  release?.([message("m1")])
  await tick()
  expect(h.latest().views.has("child")).toBe(false)
})

test("successful calibration stamps calibratedAt on the snapshot", async () => {
  const h = harness({ fetch: { active: async () => new Set(["child"]) } })
  expect(h.latest()?.calibratedAt).toBeUndefined()
  h.controller.ingest({ type: "session.execution.started", data: { sessionID: "child" } })
  await tick()
  await h.clock.advance(15_500)
  expect(h.latest().known).toBe(true)
  expect(h.latest().calibratedAt).toBeGreaterThan(0)
  expect(h.latest().calibrationIntervalMs).toBeDefined()
  h.controller.dispose()
})

test("a failed active probe keeps the last successful calibration time", async () => {
  let down = false
  const h = harness({
    fetch: {
      active: async () => {
        if (down) throw new Error("offline")
        return new Set(["child"])
      },
    },
  })
  h.controller.ingest({ type: "session.execution.started", data: { sessionID: "child" } })
  await tick()
  await h.clock.advance(15_500)
  const stamped = h.latest().calibratedAt ?? 0
  expect(stamped).toBeGreaterThan(0)

  down = true
  await h.clock.advance(15_500)
  expect(h.latest().known).toBe(true)
  expect(h.latest().calibratedAt).toBe(stamped)

  down = false
  await h.clock.advance(15_500)
  expect(h.latest().calibratedAt).toBeGreaterThan(stamped)
  h.controller.dispose()
})
