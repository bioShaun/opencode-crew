import type { Plugin } from "@opencode/plugin"
import { appendFileSync } from "node:fs"
import { join } from "node:path"

export default {
  id: "root-only-probe",
  async setup(ctx: Plugin.Context) {
    const file = join(ctx.location.directory, "root-only-probe.ndjson")
    const log = (data: Record<string, unknown>) => { try { appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), ...data }) + "\n") } catch {} }
    const register = async (hook: string, fn: () => Promise<unknown>) => { try { await fn() } catch (e) { log({ hook, kind: "register", error: String(e) }) } }
    log({ hook: "load" })
    await register("evaluate", () => ctx.permission.hook("evaluate", async e => { log({ hook: "evaluate", sessionID: e.sessionID, agent: e.agent, action: e.action, resources: e.resources, source: e.source, effect: e.effect, message: e.message }) }))
    await register("context", () => ctx.session.hook("context", async e => { log({ hook: "context", sessionID: e.sessionID, agent: e.agent, tools: Object.keys(e.tools) }) }))
  },
} satisfies Plugin.Plugin
