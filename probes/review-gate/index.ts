import type { Plugin } from "@opencode/plugin"
import { appendFileSync } from "node:fs"
import { join } from "node:path"

export default {
  id: "review-gate-probe",
  async setup(ctx: Plugin.Context) {
    const file = join(ctx.location.directory, "review-gate-probe.ndjson")
    const log = (data: Record<string, unknown>) => { try { appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), ...data }) + "\n") } catch {} }
    const injected = new Set<string>()
    const register = async (hook: string, fn: () => Promise<unknown>) => { try { await fn() } catch (e) { log({ hook, kind: "register", error: String(e) }) } }
    log({ hook: "load" })
    await register("context", () => ctx.session.hook("context", async e => { log({ hook: "context", sessionID: e.sessionID, agent: e.agent, messageCount: e.messages.length }) }))
    await register("experimental.idle", () => ctx.session.hook("experimental.idle", async e => {
      log({ hook: "experimental.idle", kind: "enter", sessionID: e.sessionID, background: e.background })
      try { const s = await ctx.session.get({ sessionID: e.sessionID }); log({ hook: "experimental.idle", kind: "session", sessionID: e.sessionID, session: { id: s.id, agent: s.agent, parentID: s.parentID, time: s.time, outcome: s.outcome } }) } catch (error) { log({ hook: "experimental.idle", kind: "session", error: String(error) }) }
      try { const p = await ctx.session.list({ parentID: e.sessionID, limit: 200 }); log({ hook: "experimental.idle", kind: "children", sessionID: e.sessionID, children: p.data.map(s => ({ id: s.id, agent: s.agent, parentID: s.parentID, time: s.time, outcome: s.outcome })) }) } catch (error) { log({ hook: "experimental.idle", kind: "children", error: String(error) }) }
      try { const c = await ctx.session.context({ sessionID: e.sessionID }); log({ hook: "experimental.idle", kind: "stored-context", sessionID: e.sessionID, context: c }) } catch (error) { log({ hook: "experimental.idle", kind: "stored-context", error: String(error) }) }
      if (process.env.CREW_PROBE_SLEEP === "1") await new Promise(resolve => setTimeout(resolve, 2000))
      const delivery = process.env.CREW_PROBE_DELIVERY
      if ((delivery === "queue" || delivery === "steer") && !injected.has(e.sessionID)) {
        injected.add(e.sessionID)
        try { const result = await ctx.session.synthetic({ sessionID: e.sessionID, text: "Probe follow-up: respond with PROBE_FOLLOWUP and stop.", description: "isolated probe", delivery }); log({ hook: "experimental.idle", kind: "synthetic", sessionID: e.sessionID, delivery, result }) } catch (error) { log({ hook: "experimental.idle", kind: "synthetic", sessionID: e.sessionID, delivery, error: String(error) }) }
      }
      log({ hook: "experimental.idle", kind: "exit", sessionID: e.sessionID })
    }))
  },
} satisfies Plugin.Plugin
