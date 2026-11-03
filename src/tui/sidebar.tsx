/* @jsxImportSource @opentui/solid */
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js"
import { usePlugin } from "@opencode/plugin/tui"
import { crewTasks, parseTasksOutput } from "../snapshot"
import {
  buildSidebar,
  type CrewTaskView,
  type MessageView,
  type SidebarView,
  type SessionView,
} from "./view-model"
import { Alerts } from "./alerts"
import { Delegations } from "./delegations"
import { Subagents } from "./subagents"

type Block =
  | { kind: "alerts"; rows: SidebarView["alerts"] }
  | { kind: "delegations"; block: NonNullable<SidebarView["delegations"]> }
  | { kind: "subagents"; block: NonNullable<SidebarView["subagents"]> }

const POLL_MS = 5_000
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

  const location = () => context.location ?? attempt(() => context.data.location.default(), undefined)

  const refresh = async () => {
    const client = context.client.rpc(crewTasks)
    try {
      const options = context.location ? { location: context.location } : undefined
      setTasks(parseTasksOutput(await client.tasks({ sessionID: props.sessionID }, options)))
    } catch {
      setTasks([])
    }
  }

  let pending: ReturnType<typeof setTimeout> | undefined
  const schedule = () => {
    pending ??= setTimeout(() => {
      pending = undefined
      refresh()
    }, DEBOUNCE_MS)
  }
  const unlisten = context.data.listen(() => schedule())
  const timer = setInterval(refresh, POLL_MS)
  onCleanup(() => {
    unlisten()
    clearInterval(timer)
    if (pending !== undefined) clearTimeout(pending)
  })
  createEffect(on(() => props.sessionID, () => {
    setTasks([])
    refresh()
  }))

  // Keep the reactive session/family caches hydrated for this session.
  createEffect(() => {
    const id = props.sessionID
    const quiet = (p: Promise<void>) => p.catch(() => {})
    quiet(context.data.session.sync(id))
    quiet(context.data.session.message.sync(id))
    for (const sid of context.data.session.family(id) ?? []) {
      quiet(context.data.session.sync(sid))
      quiet(context.data.session.message.sync(sid))
    }
    quiet(context.data.location.agent.sync(location()))
  })

  const view = createMemo<SidebarView>(() => {
    const rootID = attempt(() => context.data.session.root(props.sessionID), "") || props.sessionID
    const ids = [...new Set([rootID, ...(attempt(() => context.data.session.family(rootID), [] as string[]))])]
    const sessions: SessionView[] = ids.flatMap(id => {
      const s = context.data.session.get(id)
      return s ? [{ id: s.id, parentID: s.parentID, agent: s.agent, created: s.time.created, updated: s.time.updated, tokens: s.tokens }] : []
    })
    const boundary = Math.max(
      0,
      ...attempt(() => context.data.session.message.list(rootID) as unknown as MessageView[], [] as MessageView[])
        .filter(m => m.type === "user")
        .map(m => m.time?.created ?? 0),
    )
    const agents = context.data.location.agent.list(location()) ?? []
    const stepsOf = (agent: string | undefined) =>
      agents.find(a => a.id === agent)?.steps
      ?? agents.find(a => a.id === "engineer")?.steps
      ?? 80
    return buildSidebar({
      rootID,
      sessions,
      boundary,
      tasks: tasks(),
      now: Date.now(),
      status: id => attempt(() => context.data.session.status(id), "idle" as const),
      messages: id => attempt(() => context.data.session.message.list(id) as unknown as MessageView[], []),
      cost: id => attempt(() => context.data.session.cost(id), 0),
      limit: stepsOf,
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
      <Show when={blocks().length > 0}>
        <box height={1} />
      </Show>
    </box>
  )
}
