/* @jsxImportSource @opentui/solid */
import { test, expect } from "bun:test"
import { testRender } from "@opentui/solid"
import { createEffect, createSignal, onCleanup, ErrorBoundary } from "solid-js"
import { PluginContextProvider } from "@opencode/plugin/tui"
import plugin from "../src/tui/index"
import { SidebarRecovery, type RecoveryClock } from "../src/tui/sidebar-recovery"
import { mkdir, symlink, copyFile, rm } from "node:fs/promises"
import { join, resolve } from "node:path"

test("native Solid renderer runs effects and cleanup", async () => {
  let effects = 0
  let cleanups = 0
  function Probe() {
    createEffect(() => { effects++ })
    onCleanup(() => { cleanups++ })
    return <text>native sentinel</text>
  }
  const ui = await testRender(() => <Probe />, { width: 60, height: 10 })
  try {
    await ui.renderOnce()
    expect(ui.captureCharFrame()).toContain("native sentinel")
    expect(effects).toBe(1)
  } finally { await ui.dispose() }
  expect(cleanups).toBe(1)
})

function fakeClock() {
  let now = 0, next = 0
  const timers = new Map<number, { at: number; fn: () => void }>()
  const c: RecoveryClock & { advance(ms: number): void; count(): number } = {
    now: () => now,
    schedule: (fn, delay) => { const id = ++next; timers.set(id, { at: now + delay, fn }); return id },
    cancel: id => { timers.delete(id as number) },
    advance: ms => {
      const end = now + ms
      for (;;) {
        const item = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
        if (!item) break
        timers.delete(item[0]); now = item[1].at; item[1].fn()
      }
      now = end
    },
    count: () => timers.size,
  }
  return c
}

function fixture() {
  let failListen = false, failTheme = false, failHydrate = false, listeners = 0, calls = 0
  const [badModel, setBadModel] = createSignal(false)
  const sync = () => { if (failHydrate) throw new Error("hydrate failure"); return Promise.resolve() }
  const children = ["a", "b"].map(id => ({ id, parentID: "root", agent: "explorer", time: { created: 1, updated: 2, busy: 1, idle: 2 }, cost: 0 }))
  const color = "#ffffff"
  const context: any = {
    get theme() { if (failTheme) throw new Error("sensitive secret path"); return { text: { base: color, muted: color, faint: color, feedback: { info: { base: color }, warning: { base: color }, error: { base: color } } } } },
    keymap: { layer: () => {} },
    data: {
      listen: () => { calls++; if (failListen) throw new Error("sensitive secret path"); listeners++; return () => { listeners-- } },
      location: { default: () => undefined, agent: { sync, list: () => badModel() ? [{ get id() { throw new Error("model failure") } }] : [] } },
      session: { sync, root: (id: string) => id, family: () => [], get: () => undefined, status: () => "idle", cost: () => 0,
        message: { sync, list: () => [] } },
    },
    client: { rpc: () => ({ tasks: async () => [] }), session: { list: async ({ parentID }: any) => ({ data: parentID === "root" ? children : [] }), active: async () => ({}), get: async () => undefined }, message: { list: async () => ({ data: [] }) } },
  }
  return { context, failListen: (v: boolean) => { failListen = v }, failTheme: (v: boolean) => { failTheme = v }, failHydrate: (v: boolean) => { failHydrate = v }, setBadModel, listeners: () => listeners, calls: () => calls }
}

// Current main registers two slots (sidebar.content + sidebar.footer) and a
// keymap layer; capture only the Crew sidebar contribution.
function captureSidebar(context: any) {
  let render: any
  context.ui = { slot: (slot: any) => {
    if (slot.prepend === "sidebar.content") render = slot.render
    return () => {}
  } }
  context.keymap = { layer: () => {} }
  plugin.setup(context)
  return () => render
}

const settle = async (ui: Awaited<ReturnType<typeof testRender>>) => {
  for (let i = 0; i < 8; i++) await Promise.resolve()
  await ui.renderOnce()
}

test("real renderer recovers a child render fault to two ended explorer sessions", async () => {
  const f = fixture(), c = fakeClock()
  f.failTheme(true)
  let host = 0
  const ui = await testRender(() => <box flexDirection="column"><text>native sentinel</text>
    <ErrorBoundary fallback={() => { host++; return null }}><PluginContextProvider value={f.context}>
      <SidebarRecovery context={f.context} sessionID="root" clock={c} />
    </PluginContextProvider></ErrorBoundary></box>, { width: 80, height: 20 })
  try {
    await settle(ui)
    expect(ui.captureCharFrame()).toContain("Crew 暂时不可用")
    expect(ui.captureCharFrame()).not.toContain("sensitive secret")
    expect(f.listeners()).toBe(0)
    f.failTheme(false)
    c.advance(1000)
    await settle(ui)
    const frame = ui.captureCharFrame()
    expect(frame).toContain("native sentinel")
    expect(frame).toContain("Subagents (2 sessions")
    expect(frame).toContain("explorer")
    expect(host).toBe(0)
    expect(f.listeners()).toBe(1)
  } finally { await ui.dispose() }
  expect(c.count()).toBe(0)
  expect(f.listeners()).toBe(0)
})

test("hydrate effect fault is isolated and remounts with provider", async () => {
  const f = fixture(), c = fakeClock()
  let host = 0
  f.failHydrate(true)
  const ui = await testRender(() => <ErrorBoundary fallback={() => { host++; return null }}>
    <PluginContextProvider value={f.context}><SidebarRecovery context={f.context} sessionID="root" clock={c} /></PluginContextProvider>
  </ErrorBoundary>, { width: 80, height: 15 })
  try {
    await settle(ui)
    expect(ui.captureCharFrame()).toContain("Crew 暂时不可用")
    expect(host).toBe(0)
    expect(f.listeners()).toBe(0)
    f.failHydrate(false); c.advance(1000); await settle(ui)
    expect(ui.captureCharFrame()).toContain("Subagents (2 sessions")
    expect(f.listeners()).toBe(1)
  } finally { await ui.dispose() }
  expect(c.count()).toBe(0)
})

test("model failure is visible and healthy 60 seconds resets retry budget", async () => {
  const f = fixture(), c = fakeClock()
  f.failListen(true)
  const ui = await testRender(() => <PluginContextProvider value={f.context}>
    <SidebarRecovery context={f.context} sessionID="root" clock={c} />
  </PluginContextProvider>, { width: 80, height: 15 })
  try {
    await settle(ui)
    c.advance(1000); await settle(ui)
    f.failListen(false); c.advance(3000); await settle(ui)
    expect(ui.captureCharFrame()).toContain("Subagents (2 sessions")
    c.advance(60000)
    f.setBadModel(true); await settle(ui)
    expect(ui.captureCharFrame()).toContain("Crew 暂时不可用")
    expect(ui.captureCharFrame()).toContain("自动重试 1/3")
    f.setBadModel(false); c.advance(1000); await settle(ui)
    expect(ui.captureCharFrame()).toContain("Subagents (2 sessions")
  } finally { await ui.dispose() }
  expect(f.listeners()).toBe(0)
  expect(c.count()).toBe(0)
})

test("automatic budget is bounded, manual mouse retries, session change disposes old cycle", async () => {
  const f = fixture(), c = fakeClock()
  f.failListen(true)
  const [id, setID] = createSignal("root")
  const ui = await testRender(() => <PluginContextProvider value={f.context}>
    <SidebarRecovery context={f.context} sessionID={id()} clock={c} />
  </PluginContextProvider>, { width: 80, height: 12 })
  try {
    await settle(ui)
    expect(f.calls()).toBe(1)
    for (const delay of [1000, 3000, 10000]) { c.advance(delay); await settle(ui) }
    expect(f.calls()).toBe(4)
    expect(ui.captureCharFrame()).toContain("自动重试已用尽")
    expect(c.count()).toBe(0)
    await ui.mockMouse.click(2, 3)
    await settle(ui)
    expect(f.calls()).toBe(5)
    await ui.mockMouse.click(2, 3)
    await settle(ui)
    expect(f.calls()).toBe(5)
    setID("other")
    await settle(ui)
    expect(f.calls()).toBe(6)
    expect(c.count()).toBe(1)
    f.failListen(false)
    c.advance(1000)
    await settle(ui)
    expect(f.listeners()).toBe(1)
    expect(ui.captureCharFrame()).not.toContain("Crew 暂时不可用")
    expect(c.count()).toBe(1)
  } finally { await ui.dispose() }
  expect(c.count()).toBe(0)
  expect(f.listeners()).toBe(0)
})

test("switching healthy sessions disposes old listener and stable timer; empty data is normal", async () => {
  const f = fixture(), c = fakeClock()
  const [id, setID] = createSignal("root")
  const ui = await testRender(() => <PluginContextProvider value={f.context}>
    <SidebarRecovery context={f.context} sessionID={id()} clock={c} />
  </PluginContextProvider>, { width: 80, height: 15 })
  try {
    await settle(ui)
    expect(ui.captureCharFrame()).toContain("Subagents (2 sessions")
    expect(f.listeners()).toBe(1)
    expect(c.count()).toBe(1)
    setID("empty"); await settle(ui)
    expect(f.calls()).toBe(2)
    expect(f.listeners()).toBe(1)
    expect(c.count()).toBe(1)
    expect(ui.captureCharFrame()).not.toContain("Crew 暂时不可用")
    expect(ui.captureCharFrame()).not.toContain("Subagents")
  } finally { await ui.dispose() }
  expect(f.listeners()).toBe(0)
  expect(c.count()).toBe(0)
})

test("slot isolates Sidebar listen failure from host and shows fallback", async () => {
  let hostFaults = 0
  let listenCalls = 0
  const context: any = {
    data: { session: { sync: async () => {} }, listen: () => { listenCalls++; throw new Error("listen failed") } },
  }
  const render = captureSidebar(context)()
  function Host() {
    return <box flexDirection="column">
      <text>native sentinel</text>
      <ErrorBoundary fallback={() => { hostFaults++; return null }}>
        <PluginContextProvider value={context}>{render({ sessionID: "root" })}</PluginContextProvider>
      </ErrorBoundary>
    </box>
  }
  const ui = await testRender(() => <Host />, { width: 60, height: 10 })
  try {
    await ui.renderOnce()
    const frame = ui.captureCharFrame()
    expect(frame).toContain("native sentinel")
    expect(listenCalls).toBe(1)
    expect(hostFaults).toBe(0)
    expect(frame).toContain("Crew 暂时不可用")
  } finally { await ui.dispose() }
})

test("formal bundle isolates and automatically recovers a real slot initialization fault", async () => {
  // Run the actual package build in a sandbox: even the old build cannot touch live dist.
  const root = resolve(import.meta.dir, "..")
  const stage = join(root, "test/.work/sidebar-recovery/formal-build")
  await rm(stage, { recursive: true, force: true })
  await mkdir(stage, { recursive: true })
  await copyFile(join(root, "package.json"), join(stage, "package.json"))
  for (const name of ["src", "node_modules", "scripts"]) {
    await symlink(join(root, name), join(stage, name), "dir")
  }
  const out = join(stage, "dist")
  const proc = Bun.spawn(["bun", "run", "build"], { cwd: stage, env: { ...process.env, CREW_BUILD_OUTDIR: out }, stdout: "pipe", stderr: "pipe" })
  const output = await new Response(proc.stderr).text()
  expect({ exit: await proc.exited, output }).toMatchObject({ exit: 0 })
  expect(await Bun.file(join(out, "index.js")).exists()).toBe(true)
  const built = (await import(join(out, "tui.js"))).default
  const f = fixture(); f.failListen(true)
  let render: any, host = 0
  f.context.ui = { slot: (slot: any) => { if (slot.prepend === "sidebar.content") render = slot.render; return () => {} } }
  f.context.keymap = { layer: () => {} }
  built.setup(f.context)
  const ui = await testRender(() => <box flexDirection="column"><text>native sentinel</text>
    <ErrorBoundary fallback={() => { host++; return null }}><PluginContextProvider value={f.context}>
      {render({ sessionID: "root" })}
    </PluginContextProvider></ErrorBoundary></box>, { width: 80, height: 20 })
  try {
    await settle(ui)
    expect(ui.captureCharFrame()).toContain("Crew 暂时不可用")
    expect(host).toBe(0)
    expect(f.listeners()).toBe(0)
    f.failListen(false)
    await new Promise(resolve => setTimeout(resolve, 1100))
    await settle(ui)
    expect(ui.captureCharFrame()).toContain("native sentinel")
    expect(ui.captureCharFrame()).toContain("Subagents (2 sessions")
    expect(ui.captureCharFrame()).toContain("explorer")
    expect(host).toBe(0)
    expect(f.listeners()).toBe(1)
  } finally { await ui.dispose() }
  expect(f.listeners()).toBe(0)
}, 15000)
