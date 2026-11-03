// Server side of the Crew sidebar snapshot: reads the ledger, observes task
// sessions, and exposes a whitelist RPC. The TUI never touches the ledger.

import type { Context } from '@opencode/plugin/promise/plugin'
import { inspectProject } from './tasks-registry'
import { Ledger, type LedgerEntry } from './tasks-state'
import { crewTasks, parseTasksInput, type CrewTaskView } from './snapshot'
import { parseReportStatus } from './report-status'
import { tokenTotal, type MessageView } from './tui/view-model'

type Host = Context

/** Latest `Report: <status>` plus the reason on its line or the next non-empty line. */
export function extractReport(messages: MessageView[]): { status: NonNullable<CrewTaskView['report']>['status']; reason?: string } | undefined {
  for (const message of [...messages].reverse()) {
    if (message.type !== 'assistant') continue
    for (const part of [...(message.content ?? [])].reverse()) {
      if (part.type !== 'text' || typeof part.text !== 'string') continue
      const match = /(?:^|\n)\s*Report:\s*([A-Za-z]+)\b[^\S\n]*(.*)/.exec(part.text)
      if (!match) continue
      const status = parseReportStatus(match[1])
      if (!status) continue
      let reason = match[2]?.replace(/^[\s：:—–\-,，;；]+/, '').trim() ?? ''
      if (!reason) {
        const tail = part.text.slice(match.index + match[0].length)
        reason = tail.split('\n').map(line => line.trim()).find(line => line.length > 0) ?? ''
      }
      return { status, ...(reason ? { reason: reason.slice(0, 200) } : {}) }
    }
  }
  return undefined
}

/** Whitelist projection of a ledger entry plus live session observations. */
export function buildTaskSnapshot(
  entry: LedgerEntry,
  extras: {
    observed?: CrewTaskView['observed']
    report?: CrewTaskView['report']
    steps?: number
    tokens?: number
    cost?: number
    permissions?: { action: string; resources: string[] }[]
  } = {},
): CrewTaskView {
  const t = entry.record
  const view: CrewTaskView = {
    taskID: t.taskID,
    directory: t.input.directory,
    scopes: t.input.scope.length,
    state: t.state,
    lifecycle: entry.lifecycle,
    check: t.input.check,
    steps: extras.steps ?? 0,
    permissions: extras.permissions ?? [],
  }
  if (t.sessionID) view.sessionID = t.sessionID
  if (extras.observed && Object.keys(extras.observed).length) view.observed = extras.observed
  if (extras.report) view.report = extras.report
  if (extras.tokens !== undefined) view.tokens = extras.tokens
  if (extras.cost !== undefined) view.cost = extras.cost
  return view
}

export async function registerTaskSnapshot(ctx: Host) {
  // The sidebar degrades to host data alone when the host exposes no rpc domain.
  await ctx.rpc?.register(crewTasks, {
    async tasks(raw) {
      const input = parseTasksInput(raw)
      if (!input) return { tasks: [] }
      let ledger: Ledger
      try {
        ledger = new Ledger(inspectProject(ctx.location.directory))
      } catch {
        return { tasks: [] }
      }
      const entries = ledger.active(input.sessionID)
      const tasks = await Promise.all(entries.map(async (entry): Promise<CrewTaskView> => {
        const t = entry.record
        if (!t.sessionID) return buildTaskSnapshot(entry)
        const [session, messages, permissions] = await Promise.all([
          ctx.session.get({ sessionID: t.sessionID }).catch(() => undefined),
          ctx.session.context({ sessionID: t.sessionID }).catch(() => undefined),
          ctx.permission.list({ sessionID: t.sessionID }).catch(() => undefined),
        ])
        const observed: CrewTaskView['observed'] = session
          ? {
              ...(session.outcome ? { outcome: session.outcome } : {}),
              ...(session.time?.busy !== undefined ? { busyAt: new Date(session.time.busy).toISOString() } : {}),
              ...(session.time?.idle !== undefined ? { idleAt: new Date(session.time.idle).toISOString() } : {}),
            }
          : { errorCode: 'HOST_ERROR' }
        return buildTaskSnapshot(entry, {
          observed,
          report: messages ? extractReport(messages as MessageView[]) : undefined,
          steps: messages ? (messages as MessageView[]).filter(m => m.type === 'assistant').length : 0,
          tokens: messages ? (messages as MessageView[]).reduce((n, m) => n + tokenTotal(m.tokens), 0) : undefined,
          cost: session?.cost,
          permissions: permissions?.map(p => ({ action: p.action, resources: [...p.resources] })),
        })
      }))
      return { tasks }
    },
  })
}
