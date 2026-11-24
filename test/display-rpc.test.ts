import { test, expect } from "bun:test"
import type { Context } from "@opencode/plugin/promise/plugin"
import { testRender } from "@opentui/solid"
import { PluginContextProvider } from "@opencode/plugin/tui"
import { createComponent } from "solid-js"
import { parseCrewDisplay } from "../src/config"
import { crewDisplay, parseDisplayView, registerDisplayRpc, resolveDisplay } from "../src/display-rpc"
import plugin from "../src/index"
import { Sidebar } from "../src/tui/sidebar"

const cli = { modelAliases: { "acme/long-model": "LOCAL" }, modelDisplay: "inline" }
const server = { modelAliases: { "acme/long-model": "REMOTE" }, modelDisplay: "off" }

function rpcFixture() {
  const registrations = new Map<string, { definition: unknown; handlers: Record<string, () => Promise<unknown>> }>()
  const rpc = { async register(definition: { id: string }, handlers: Record<string, () => Promise<unknown>>) {
    registrations.set(definition.id, { definition, handlers })
  } }
  function display() {
    const entry = registrations.get("opencode-crew-display")
    expect(entry?.definition).toMatchObject({ id: "opencode-crew-display", methods: { get: expect.any(Object) } })
    expect(entry!.definition).toBe(crewDisplay)
    return entry!.handlers.get()
  }
  return { rpc, display }
}

test("display RPC registration is optional and fail-open", async () => {
  const display = parseCrewDisplay(server)
  await registerDisplayRpc({} as Context, display)
  await registerDisplayRpc({ rpc: { register: async () => { throw new Error("unsupported") } } } as unknown as Context, display)
})

test("display RPC get returns the parsed aliases and mode", async () => {
  const f = rpcFixture(), display = parseCrewDisplay(server)
  await registerDisplayRpc({ rpc: f.rpc } as unknown as Context, display)
  expect(await f.display()).toEqual(display)
})

test("server setup exposes display settings in plugin options through RPC", async () => {
  const f = rpcFixture()
  const ctx: any = {
    options: server, location: { directory: process.cwd() }, rpc: f.rpc,
    agent: { transform: async (fn: any) => fn({ update: (_: string, update: any) => update({ permissions: [] }) }) },
    permission: { hook: async () => {} }, command: { transform: async () => {} },
    tool: { transform: async () => {} }, session: { hook: async () => {} },
  }
  await plugin.setup(ctx)
  expect(await f.display()).toEqual({ aliases: { "acme/long-model": "REMOTE" }, display: "off" })
})

test("parseDisplayView drops invalid aliases independently and defaults an invalid mode", () => {
  expect(parseDisplayView({ display: "bad", aliases: {
    "a/good": " ok ", "a/last": "kept", "empty": "bad key", "a/multi/path": "bad key",
    "a/space model": "bad key", "a/control\0key": "bad key", "a/nonstring": 42, "a/blank": " ",
    "a/long": "1234567890123", "a/control": "val\x7fue", "a/newline": "value\n",
  } })).toEqual({ aliases: { "a/good": "ok", "a/last": "kept" }, display: "inline" })
})

test("parseDisplayView keeps at most the first 64 valid aliases", () => {
  const aliases = Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`p/${i}`, "alias"]))
  const result = parseDisplayView({ aliases: { invalid: 1, ...aliases }, display: "off" })
  expect(result.display).toBe("off")
  expect(Object.keys(result.aliases)).toHaveLength(64)
  expect(result.aliases["p/63"]).toBe("alias")
  expect(result.aliases["p/64"]).toBeUndefined()
})

test("resolveDisplay prefers an available RPC view over conflicting CLI settings", () => {
  expect(resolveDisplay(parseCrewDisplay(server), cli)).toEqual(parseCrewDisplay(server))
  expect(resolveDisplay({ aliases: {}, display: "off" }, cli)).toEqual({ aliases: {}, display: "off" })
})

test("resolveDisplay uses CLI aliases when RPC is missing or the payload is malformed", () => {
  expect(resolveDisplay(undefined, cli)).toEqual(parseCrewDisplay(cli))
  expect(resolveDisplay({ aliases: "not a map", display: "off" }, cli)).toEqual(parseCrewDisplay(cli))
})

for (const modelAliases of ["not a map", { "a/b": "1234567890123" }]) {
  test(`invalid CLI modelAliases (${typeof modelAliases}) quietly falls back to defaults`, () => {
    expect(resolveDisplay(undefined, { modelAliases, modelDisplay: "off" })).toEqual({ aliases: {}, display: "inline" })
  })
}

test("sidebar displays the CLI alias immediately, then uses a single asynchronous display RPC", async () => {
  let calls = 0, finish!: (value: unknown) => void
  const response = new Promise(resolve => { finish = resolve })
  const sync = async () => {}, time = Date.now()
  const child = { id: "child", parentID: "root", agent: "engineer", time: { created: time, updated: time, busy: time }, model: { providerID: "acme", id: "long-model" } }
  const color = "#ffffff"
  const context: any = {
    options: cli,
    theme: { text: { base: color, muted: color, faint: color, feedback: { info: { base: color }, warning: { base: color }, error: { base: color } } } },
    data: { listen: () => () => {}, location: { default: () => undefined, agent: { list: () => [], sync } },
      session: { sync, root: () => "root", family: () => ["child"], get: (id: string) => id === "child" ? child : undefined,
        status: (id: string) => id === "child" ? "busy" : "idle", cost: () => 0, message: { sync, list: () => [] } } },
    client: {
      rpc: ({ id }: { id: string }) => id === "opencode-crew-display"
        ? { get: () => { calls++; return response } } : { tasks: async () => [] },
      session: { list: async () => ({ data: [child] }), active: async () => ({ child: {} }), get: async () => child },
      message: { list: async () => ({ data: [] }) },
    },
  }
  const ui = await testRender(() => createComponent(PluginContextProvider, {
    value: context, get children() { return createComponent(Sidebar, { sessionID: "root" }) },
  }), { width: 72, height: 16 })
  try {
    await ui.renderOnce()
    expect(calls).toBe(1)
    expect(ui.captureCharFrame()).toContain("LOCAL")
    finish({ aliases: { "acme/long-model": "REMOTE" }, display: "inline" })
    await Promise.resolve(); await ui.renderOnce(); await ui.renderOnce()
    expect(ui.captureCharFrame()).toContain("REMOTE")
    expect(ui.captureCharFrame()).not.toContain("LOCAL")
    expect(calls).toBe(1)
  } finally { finish(undefined); await ui.dispose() }
})
