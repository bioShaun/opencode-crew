// issue #10 observation probe: log-only. Never changes host decisions, never touches the ledger.
// Mount as a local directory plugin; events land in <project>/issue-10-probe.ndjson.
// See docs/issue-10-host-probes.md for the checklist this probe serves.
import type { Plugin } from "@opencode/plugin"
import { appendFileSync } from "node:fs"
import { join } from "node:path"

export default {
  id: "issue-10-probe",
  async setup(ctx: Plugin.Context) {
    const logFile = join(ctx.location.directory, "issue-10-probe.ndjson")
    const log = (record: Record<string, unknown>) => {
      try {
        appendFileSync(logFile, JSON.stringify({ at: new Date().toISOString(), ...record }) + "\n")
      } catch { /* A broken log path must not take down the host. */ }
    }
    const summary = (s: any) => ({
      id: s.id,
      parentID: s.parentID,
      agent: s.agent,
      title: s.title,
      crewTask: s.metadata?.crewTask,
      time: s.time,
      outcome: s.outcome,
    })
    const sessionOf = async (sessionID: string) => {
      try {
        return summary(await ctx.session.get({ sessionID }))
      } catch (e) {
        return { error: String(e) }
      }
    }
    // Registration itself is a probe result: an unknown hook name on an older
    // host lands in the log instead of failing plugin load.
    const register = async (hook: string, run: () => Promise<unknown>) => {
      try {
        await run()
      } catch (e) {
        log({ hook, kind: "register", error: String(e) })
      }
    }

    log({ hook: "load", directory: ctx.location.directory, logFile })

    await register("fork", () =>
      ctx.session.hook("fork", async event => {
        log({ hook: "fork", sessionID: event.sessionID, session: await sessionOf(event.sessionID) })
        try {
          const page = await ctx.session.list({ limit: 200 })
          log({ hook: "fork", kind: "sessions", sessions: page.data.map(summary) })
        } catch (e) {
          log({ hook: "fork", kind: "sessions", error: String(e) })
        }
      }),
    )

    await register("experimental.idle", () =>
      ctx.session.hook("experimental.idle", async event => {
        log({
          hook: "experimental.idle",
          sessionID: event.sessionID,
          background: event.background,
          session: await sessionOf(event.sessionID),
        })
      }),
    )

    await register("retry", () =>
      ctx.session.hook("retry", async event => {
        // Read-only: crew's own retry hook (src/tasks.ts) owns the decision.
        log({ hook: "retry", sessionID: event.sessionID, session: await sessionOf(event.sessionID) })
      }),
    )
  },
} satisfies Plugin.Plugin