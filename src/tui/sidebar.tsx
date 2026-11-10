/* @jsxImportSource @opentui/solid */
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js"
import { usePlugin } from "@opencode/plugin/tui"
import { crewTasks, parseTasksOutput } from "../snapshot"
import {
  buildSidebar,
  sessionRunning,
  type CrewTaskView,
  type MessageView,
  type SessionView,
  type SidebarView,
} from "./view-model"
import { LIVE_MESSAGES, LiveController, type LiveEvent, type LiveSnapshot } from "./live"
import { Alerts } from "./alerts"
import { Delegations } from "./delegations"
import { Subagents } from "./subagents"
import { Row } from "./rows"

type Block =
  | { kind: "alerts"; rows: SidebarView["alerts"] }
  | { kind: "delegations"; block: NonNullable<SidebarView["delegations"]> }
  | { kind: "subagents"; block: NonNullable<SidebarView["subagents"]> }

const DEBOUNCE_MS = 800

const attempt = <T,>(run: () => T, fallback: T): T => {
  try { return run() } catch { return fallback }
}

/**
 * Crew claim inside the host's `sidebar.content` boundary. Read-only: host
 * session data plus the server's whitelisted crew_task snapshot. Native
 * Todo/Context/footer stay untouched below.
 */
export function Sidebar(props: { sessionID: string }) {
  const context = usePlugin()
  const [tasks, setTasks] = createSignal<CrewTaskView[]>([])
  const [live, setLive] = createSignal<LiveSnapshot>({ views: new Map(), running: new Set(), known: false })
  // Direct children fetched from the server. The host family cache can be
  // empty after a cold start (missed session.created events or a failed
  // hydration), which would hide every Subagents row until a remount.
  const [family, setFamily] = createSignal<SessionView[]>([])
  const [now, setNow] = createSignal(Date.now())

  const location = () => context.location ?? attempt(() => context.data.location.default(), undefined)
  const rootOf = (id: string) => attempt(() => context.data.session.root(id), "") || id

  // session.sync accepts an undocumented {children:true} in the host; it
  // hydrates the root plus its direct children (info incl. busy/idle) on mount
  // and when the family grows. The host caches a successful sync, so this is
  // not a refresh loop.
  const syncSession = context.data.session.sync as (id: string, options?: { children?: boolean }) => Promise<void>
  const quiet = (p: Promise<unknown>) => p.catch(() => {})

  const hydrate = () => {
    const id = props.sessionID
    const rootID = rootOf(id)
    quiet(syncSession(id))
    quiet(context.data.session.message.sync(id))
    quiet(syncSession(rootID, { children: true }))
    for (const sid of attempt(() => context.data.session.family(rootID), [] as string[])) {
      quiet(syncSession(sid))
      quiet(context.data.session.message.sync(sid))
    }
    quiet(context.data.location.agent.sync(location()))
  }

  const storeView = (id: string): SessionView | undefined => {
    const s = attempt(() => context.data.session.get(id), undefined)
    return s
      ? {
        id: s.id,
        parentID: s.parentID,
        agent: s.agent,
        created: s.time.created,
        updated: s.time.updated,
        busy: s.time.busy,
        idle: s.time.idle,
        tokens: s.tokens,
        cost: s.cost,
        model: s.model,
      }
      : undefined
  }

  const toView = (info: Awaited<ReturnType<typeof context.client.session.get>>): SessionView => ({
    id: info.id,
    parentID: info.parentID,
    agent: info.agent,
    created: info.time.created,
    updated: info.time.updated,
    busy: info.time.busy,
    idle: info.time.idle,
    tokens: info.tokens,
    cost: info.cost,
    model: info.model,
  })

  const storeMessages = (id: string): MessageView[] =>
    attempt(() => context.data.session.message.list(id) as unknown as MessageView[], [])

  // Ask the server for the root's direct children instead of trusting only the
  // host's event-maintained family cache. Retries a transient cold-start
  // failure a few times and refreshes on reconnect.
  let familyGen = 0
  let familyRetry: ReturnType<typeof setTimeout> | undefined
  let familyAttempts = 0
  const loadFamily = () => {
    const gen = ++familyGen
    const rootID = rootOf(props.sessionID)
    const retry = () => {
      if (gen !== familyGen || familyRetry !== undefined || familyAttempts >= 4) return
      const delay = 500 * 2 ** familyAttempts++
      familyRetry = setTimeout(() => {
        familyRetry = undefined
        loadFamily()
      }, delay)
    }
    context.client.session
      .list({ parentID: rootID, order: "desc", limit: 200 })
      .then(page => {
        if (gen !== familyGen) return
        familyAttempts = 0
        const children = page.data.filter(s => s.id !== rootID)
        setFamily(children.map(toView))
        for (const s of children) {
          quiet(syncSession(s.id))
          quiet(context.data.session.message.sync(s.id))
        }
      })
      .catch(retry)
  }

  const refresh = async () => {
    const client = context.client.rpc(crewTasks)
    try {
      const options = context.location ? { location: context.location } : undefined
      setTasks(parseTasksOutput(await client.tasks({ sessionID: props.sessionID }, options)))
    } catch {
      setTasks([])
    }
  }

  // Events drive the live snapshot; the controller polls only to repair misses
  // (15s while the family has running work, 60s with an active-set probe only).
  // Register cleanup before creating any resource so a fault during setup (or a
  // recovery remount) cannot leak listeners, timers or the controller.
  let controller: LiveController | undefined
  let unlisten: (() => void) | undefined
  let pending: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => {
    try { controller?.dispose() } catch {}
    try { unlisten?.() } catch {}
    if (pending !== undefined) clearTimeout(pending)
    if (familyRetry !== undefined) clearTimeout(familyRetry)
    familyGen++
  })
  controller = new LiveController({
    rootID: props.sessionID,
    family: () => attempt(() => context.data.session.family(rootOf(props.sessionID)), [] as string[]),
    store: { session: storeView, messages: storeMessages },
    fetch: {
      active: async () => new Set(Object.keys(await context.client.session.active())),
      session: id => context.client.session.get({ sessionID: id }).then(toView).catch(() => undefined),
      // Newest assistant page; the sidebar needs the tail for activity and steps.
      messages: id => context.client.message
        .list({ sessionID: id, limit: LIVE_MESSAGES, order: "desc", type: "assistant" })
        .then(page => [...page.data].reverse() as unknown as MessageView[])
        .catch(() => undefined),
    },
    onChange: snapshot => { setLive(snapshot); setNow(Date.now()) },
    // The crew_task snapshot shares the calibration cadence instead of adding
    // a second timer.
    onCalibration: () => { void refresh() },
  })

  const schedule = () => {
    pending ??= setTimeout(() => {
      pending = undefined
      refresh()
    }, DEBOUNCE_MS)
  }
  unlisten = context.data.listen(({ details }) => {
    const event = details as LiveEvent
    if (event.type === "server.connected") loadFamily()
    controller?.ingest(event)
    schedule()
  })
  createEffect(on(() => props.sessionID, () => {
    setTasks([])
    setFamily([])
    refresh()
    controller?.setRoot(props.sessionID)
    loadFamily()
  }))

  // Keep the reactive session/family caches hydrated for this session.
  createEffect(() => hydrate())

  const statusOf = (id: string) => attempt(() => context.data.session.status(id), "idle" as const)
  const view = createMemo<SidebarView>(() => {
    const rootID = rootOf(props.sessionID)
    const snapshot = live()
    const local = new Map(family().map(s => [s.id, s]))
    const ids = [...new Set([
      rootID,
      ...attempt(() => context.data.session.family(rootID), [] as string[]),
      ...snapshot.views.keys(),
      ...snapshot.running,
      ...local.keys(),
    ])]
    const sessions: SessionView[] = ids.flatMap(id => {
      const session = snapshot.views.get(id)?.session ?? storeView(id) ?? local.get(id)
      return session ? [session] : []
    })
    const agents = attempt(() => context.data.location.agent.list(location()) ?? [], [])
    const stepsOf = (agent: string | undefined) =>
      agents.find(a => a.id === agent)?.steps
      ?? agents.find(a => a.id === "engineer")?.steps
      ?? 80
    return buildSidebar({
      rootID,
      sessions,
      tasks: tasks(),
      now: now(),
      status: statusOf,
      // The server snapshot is authoritative once a probe succeeded; before
      // that, fall back to the host's busy/idle watermarks.
      running: snapshot.known ? s => snapshot.running.has(s.id) : s => sessionRunning(s, statusOf),
      messages: id => snapshot.views.get(id)?.messages ?? storeMessages(id),
      cost: id => snapshot.views.get(id)?.session.cost ?? attempt(() => context.data.session.cost(id), 0),
      lastActivity: id => snapshot.views.get(id)?.lastActivity ?? 0,
      limit: stepsOf,
      known: snapshot.known,
      calibratedAt: snapshot.calibratedAt,
      calibrationIntervalMs: snapshot.calibrationIntervalMs,
    })
  })

  const blocks = createMemo<Block[]>(() => {
    const v = view()
    const out: Block[] = []
    if (v.alerts.length) out.push({ kind: "alerts", rows: v.alerts })
    if (v.delegations) out.push({ kind: "delegations", block: v.delegations })
    if (v.subagents) out.push({ kind: "subagents", block: v.subagents })
    return out
  })

  const render = (block: Block) => {
    if (block.kind === "alerts") return <Alerts rows={block.rows} />
    if (block.kind === "delegations") return <Delegations block={block.block} />
    return <Subagents block={block.block} />
  }

  return (
    <box flexDirection="column">
      <For each={blocks()}>
        {(block, index) => (
          <>
            <Show when={index() > 0}>
              <box height={1} />
            </Show>
            {render(block)}
          </>
        )}
      </For>
      <Show when={view().freshness}>
        <Show when={blocks().length > 0}>
          <box height={1} />
        </Show>
        <Row spans={view().freshness!} />
      </Show>
      <Show when={blocks().length > 0 || view().freshness}>
        <box height={1} />
      </Show>
    </box>
  )
}
