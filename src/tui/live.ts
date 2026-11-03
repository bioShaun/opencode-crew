// Live snapshot for the crew sidebar.
//
// Events own freshness: a streamed step/tool/text/usage event updates the local
// snapshot from the host's reactive store, coalesced in a fixed 250ms window.
// Nothing here turns a delta into an HTTP request. Calibration polling only
// repairs what events missed: every 15s while the family has running work, and
// every 60s (an active-set probe only) while it is idle. Server responses are
// merged monotonically, so a slow reply can never roll back a newer event.

import { lastActivityOf, messageStamp, type MessageView, type SessionView } from "./view-model"

export const ACTIVE_CALIBRATION_MS = 15_000
export const IDLE_CALIBRATION_MS = 60_000
export const FLUSH_MS = 250
export const LIVE_MESSAGES = 100
export const MAX_CONCURRENT_PULLS = 3

const MAX_DEPTH = 8
const TERMINAL = new Set([
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
])
const MESSAGE_EVENTS = new Set([
  "session.step.started",
  "session.step.streamed",
  "session.step.ended",
  "session.step.failed",
  "session.text.started",
  "session.text.delta",
  "session.text.ended",
  "session.reasoning.started",
  "session.reasoning.delta",
  "session.reasoning.ended",
  "session.tool.input.started",
  "session.tool.input.delta",
  "session.tool.input.ended",
  "session.tool.called",
  "session.tool.progress",
  "session.tool.success",
  "session.tool.failed",
])

export interface LiveEvent {
  readonly type: string
  readonly created?: number
  readonly data?: {
    readonly sessionID?: string
    readonly assistantMessageID?: string
    readonly agent?: string
    readonly cost?: number
    readonly tokens?: SessionView["tokens"]
  }
}

export interface LiveEntry {
  session: SessionView
  messages: MessageView[]
  /** Last confirmed output (message/tool/part) or server update, never the poll time. */
  lastActivity: number
}

export interface LiveSnapshot {
  readonly views: ReadonlyMap<string, LiveEntry>
  readonly running: ReadonlySet<string>
  /** False until the first active-set probe succeeds; callers should use the host status then. */
  readonly known: boolean
}

export interface LiveStore {
  session(id: string): SessionView | undefined
  messages(id: string): MessageView[] | undefined
}

export interface LiveFetch {
  active(): Promise<ReadonlySet<string>>
  session(id: string): Promise<SessionView | undefined>
  /** Newest page, chronological order. */
  messages(id: string): Promise<MessageView[] | undefined>
}

export interface LiveClock {
  now(): number
  schedule(fn: () => void, ms: number): unknown
  cancel(handle: unknown): void
}

const realClock: LiveClock = {
  now: () => Date.now(),
  schedule: (fn, ms) => setTimeout(fn, ms),
  cancel: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

const totalTokens = (s: SessionView | undefined): number => {
  const t = s?.tokens
  return t ? (t.input ?? 0) + (t.output ?? 0) + (t.reasoning ?? 0) + (t.cache?.write ?? 0) : 0
}

const tokensOf = (a?: SessionView["tokens"], b?: SessionView["tokens"]) =>
  totalTokens({ id: "", created: 0, updated: 0, tokens: b }) > totalTokens({ id: "", created: 0, updated: 0, tokens: a }) ? b : a

/** Union by id; a later stamp replaces in place, older duplicates are dropped. */
export function mergeMessages(base: MessageView[], incoming: MessageView[]): MessageView[] {
  const byID = new Map<string, MessageView>()
  const rest: MessageView[] = []
  for (const m of [...base, ...incoming]) {
    if (!m.id) { rest.push(m); continue }
    const held = byID.get(m.id)
    if (!held || messageStamp(m) >= messageStamp(held)) byID.set(m.id, m)
  }
  const merged = [...byID.values(), ...rest]
  return merged.sort((a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0) || (a.id ?? "").localeCompare(b.id ?? ""))
}

/** Monotonic merge: counters and timestamps only move forward, ids stay put. */
export function mergeSession(local: SessionView | undefined, remote: SessionView): SessionView {
  if (!local) return remote
  return {
    id: local.id,
    parentID: remote.parentID ?? local.parentID,
    agent: remote.agent ?? local.agent,
    created: local.created || remote.created,
    updated: Math.max(local.updated, remote.updated),
    busy: remote.busy === undefined ? local.busy : Math.max(local.busy ?? 0, remote.busy),
    idle: remote.idle === undefined ? local.idle : Math.max(local.idle ?? 0, remote.idle),
    tokens: tokensOf(local.tokens, remote.tokens),
    cost: Math.max(local.cost ?? 0, remote.cost ?? 0),
  }
}

export interface LiveOptions {
  rootID: string
  store: LiveStore
  fetch: LiveFetch
  /** Cached host family, used to avoid ownership lookups for known members. */
  family(): string[]
  onChange(snapshot: LiveSnapshot): void
  /** Runs on every calibration tick, so other polled snapshots share this cadence. */
  onCalibration?: () => void
  clock?: LiveClock
  flushMs?: number
  activeMs?: number
  idleMs?: number
  concurrency?: number
}

export class LiveController {
  private readonly clock: LiveClock
  private readonly flushMs: number
  private readonly activeMs: number
  private readonly idleMs: number
  private readonly concurrency: number

  private rootID: string
  private generation = 0
  private disposed = false

  private readonly views = new Map<string, LiveEntry>()
  private readonly running = new Set<string>()
  private readonly dirty = new Set<string>()
  private readonly finalPending = new Set<string>()
  private readonly member = new Map<string, boolean>()
  private readonly resolving = new Map<string, Promise<boolean>>()
  /** Message ids seen in events but not yet present in the local snapshot. */
  private readonly awaiting = new Map<string, Set<string>>()
  private readonly missed = new Map<string, Set<string>>()
  private readonly pulls = new Map<string, Promise<void>>()
  private readonly lastPullAt = new Map<string, number>()

  private activeKnown = false
  private flushTimer: unknown
  private calibrationTimer: unknown
  private calibrationDue = 0
  private draining = false
  private trailing = false

  constructor(private readonly options: LiveOptions) {
    this.clock = options.clock ?? realClock
    this.flushMs = options.flushMs ?? FLUSH_MS
    this.activeMs = options.activeMs ?? ACTIVE_CALIBRATION_MS
    this.idleMs = options.idleMs ?? IDLE_CALIBRATION_MS
    this.concurrency = options.concurrency ?? MAX_CONCURRENT_PULLS
    this.rootID = options.rootID
  }

  /** Switch to another root: old responses and timers become invalid. */
  setRoot(rootID: string): void {
    this.generation++
    this.clearTimers()
    this.views.clear()
    this.running.clear()
    this.dirty.clear()
    this.finalPending.clear()
    this.member.clear()
    this.awaiting.clear()
    this.missed.clear()
    this.resolving.clear()
    this.pulls.clear()
    this.lastPullAt.clear()
    this.activeKnown = false
    this.trailing = false
    this.rootID = rootID
    this.emit()
    this.refreshNow()
  }

  dispose(): void {
    this.disposed = true
    this.generation++
    this.clearTimers()
    this.views.clear()
    this.running.clear()
    this.dirty.clear()
    this.finalPending.clear()
    this.awaiting.clear()
    this.missed.clear()
    this.resolving.clear()
    this.pulls.clear()
    this.lastPullAt.clear()
  }

  /** Mount, reconnect, or an explicit "get current" request. */
  refreshNow(): void {
    if (this.disposed) return
    void this.tick()
  }

  ingest(event: LiveEvent): void {
    if (this.disposed) return
    if (event.type === "server.connected") { this.refreshNow(); return }
    const id = event.data?.sessionID
    if (!id) return
    if (id === this.rootID) {
      // The sidebar renders the family, not the root transcript: track its
      // execution state for cadence, but never pull its messages.
      if (event.type === "session.execution.started") this.start(id)
      else if (TERMINAL.has(event.type)) this.end(id)
      return
    }
    // The host family is the cheap synchronous answer; only truly unknown ids
    // need an ownership lookup.
    if (id === this.rootID || this.options.family().includes(id)) this.member.set(id, true)
    const known = this.member.get(id)
    if (known === false) return
    if (known === true) { this.handle(id, event); return }
    // Unknown session: one ownership check, then replay what arrived meanwhile.
    if (MESSAGE_EVENTS.has(event.type)) {
      if (event.data?.assistantMessageID) this.pending(id).add(event.data.assistantMessageID)
    } else {
      this.missedEvents(id).add(event.type)
    }
    if (!this.resolving.has(id)) void this.resolve(id)
  }

  private pending(id: string): Set<string> {
    const held = this.awaiting.get(id)
    if (held) return held
    const created = new Set<string>()
    this.awaiting.set(id, created)
    return created
  }

  private missedEvents(id: string): Set<string> {
    const held = this.missed.get(id)
    if (held) return held
    const created = new Set<string>()
    this.missed.set(id, created)
    return created
  }

  private async resolve(id: string): Promise<boolean> {
    const pending = this.resolving.get(id)
    if (pending) return pending
    const check = (async () => {
      const belongs = await this.belongs(id)
      if (this.disposed) return false
      this.resolving.delete(id)
      if (!belongs) {
        this.member.set(id, false)
        this.awaiting.delete(id)
        this.missed.delete(id)
        return false
      }
      this.member.set(id, true)
      for (const type of this.missed.get(id) ?? []) this.handle(id, { type })
      this.missed.delete(id)
      for (const messageID of this.awaiting.get(id) ?? []) this.touchMessage(id, messageID, this.clock.now())
      return true
    })()
    this.resolving.set(id, check)
    return check
  }

  private async belongs(id: string): Promise<boolean> {
    if (id === this.rootID) return true
    const host = this.options.family()
    if (host.includes(id)) return true
    let current = id
    for (let depth = 0; depth < MAX_DEPTH; depth++) {
      if (current === this.rootID) return true
      const known = this.options.store.session(current)
      const info = known ?? await this.options.fetch.session(current)
      if (this.disposed) return false
      if (!info) return false
      if (host.includes(info.id)) return true
      if (!info.parentID) return false
      current = info.parentID
    }
    return false
  }

  private handle(id: string, event: LiveEvent): void {
    if (event.type === "session.deleted") { this.forget(id); return }
    if (event.type === "session.created") {
      this.ensure(id)
      this.dirty.add(id)
      this.flushSoon()
      return
    }
    if (event.type === "session.execution.started") { this.start(id); return }
    if (TERMINAL.has(event.type)) { this.end(id); return }
    if (event.type === "session.usage.updated") {
      const view = this.ensure(id)
      if (view) {
        view.session = mergeSession(view.session, {
          ...view.session,
          tokens: event.data?.tokens ?? view.session.tokens,
          cost: Math.max(view.session.cost ?? 0, event.data?.cost ?? 0),
        })
      }
      this.flushSoon()
      return
    }
    if (event.type === "session.agent.selected") {
      const view = this.ensure(id)
      if (view && event.data?.agent) view.session = { ...view.session, agent: event.data.agent }
      this.flushSoon()
      return
    }
    if (MESSAGE_EVENTS.has(event.type)) {
      const at = event.created ?? this.clock.now()
      this.touchMessage(id, event.data?.assistantMessageID ?? "", at)
    }
  }

  private start(id: string): void {
    this.running.add(id)
    this.finalPending.delete(id)
    if (id !== this.rootID) {
      this.ensure(id)
      this.dirty.add(id)
      void this.drain(true)
    }
    this.emit()
    this.arm()
  }

  private end(id: string): void {
    this.running.delete(id)
    this.finalPending.delete(id)
    if (id !== this.rootID) {
      this.finalPending.add(id)
      this.ensure(id)
      this.dirty.add(id)
      void this.drain(true)
    }
    this.emit()
    this.arm()
  }

  private forget(id: string): void {
    this.views.delete(id)
    this.running.delete(id)
    this.dirty.delete(id)
    this.finalPending.delete(id)
    this.awaiting.delete(id)
    this.missed.delete(id)
    this.member.delete(id)
    this.lastPullAt.delete(id)
    this.emit()
  }

  private ensure(id: string): LiveEntry | undefined {
    const held = this.views.get(id)
    if (held) return held
    const session = this.options.store.session(id)
    if (!session) return undefined
    const entry: LiveEntry = { session, messages: [], lastActivity: session.updated }
    this.views.set(id, entry)
    return entry
  }

  private touchMessage(id: string, messageID: string, at: number): void {
    const entry = this.ensure(id)
    const list = this.options.store.messages(id)
    if (entry) {
      if (list?.length) entry.messages = mergeMessages(entry.messages, list)
      entry.lastActivity = Math.max(entry.lastActivity, at, lastActivityOf(entry.messages))
    }
    if (messageID) {
      this.pending(id).add(messageID)
      if (!this.views.get(id)?.messages.some(m => m.id === messageID)) this.dirty.add(id)
    }
    this.flushSoon()
  }

  private settle(id: string): void {
    const waiting = this.awaiting.get(id)
    if (!waiting?.size) return
    const held = new Set((this.views.get(id)?.messages ?? []).map(m => m.id))
    for (const messageID of [...waiting]) if (held.has(messageID)) waiting.delete(messageID)
    if (!waiting.size) this.awaiting.delete(id)
  }

  private flushSoon(): void {
    if (this.flushTimer !== undefined) return
    this.flushTimer = this.clock.schedule(() => {
      this.flushTimer = undefined
      this.flush()
    }, this.flushMs)
  }

  private flush(): void {
    if (this.disposed) return
    for (const id of new Set([...this.views.keys(), ...this.dirty])) {
      const entry = this.views.get(id)
      if (!entry) continue
      const session = this.options.store.session(id)
      if (session) entry.session = mergeSession(entry.session, session)
      const list = this.options.store.messages(id)
      if (list?.length) entry.messages = mergeMessages(entry.messages, list)
      entry.lastActivity = Math.max(entry.lastActivity, lastActivityOf(entry.messages))
      this.settle(id)
    }
    // A store miss means the event's message baseline is not local yet: one
    // targeted pull, coalesced with the calibration queue rather than per delta.
    for (const id of this.awaiting.keys()) this.dirty.add(id)
    if (this.dirty.size || this.finalPending.size) void this.drain(false)
    this.emit()
    this.arm()
  }

  private async tick(): Promise<void> {
    if (this.disposed) return
    if (this.calibrationTimer !== undefined) {
      this.clock.cancel(this.calibrationTimer)
      this.calibrationTimer = undefined
    }
    this.calibrationDue = 0
    const pulse = this.options.onCalibration
    if (pulse) { try { pulse() } catch { /* a failed side poll must not stop calibration */ } }
    await this.probe()
    await this.drain(true)
    if (this.disposed) return
    this.emit()
    this.arm()
  }

  private async probe(): Promise<void> {
    let ids: ReadonlySet<string>
    try {
      ids = await this.options.fetch.active()
    } catch {
      return
    }
    if (this.disposed) return
    this.activeKnown = true
    const next = new Set<string>()
    for (const id of ids) if (await this.belongs(id)) next.add(id)
    if (this.disposed) return
    for (const id of [...this.running]) {
      if (next.has(id)) continue
      this.running.delete(id)
      if (id === this.rootID) continue
      // A missed terminal event still needs its final values.
      this.finalPending.add(id)
      this.dirty.add(id)
    }
    for (const id of next) {
      if (id === this.rootID) { this.running.add(id); continue }
      if (this.running.has(id)) {
        // Calibration also re-reads the running members: a lost event must not
        // freeze steps/cost until the next execution boundary.
        this.dirty.add(id)
        continue
      }
      this.running.add(id)
      this.dirty.add(id)
      this.finalPending.delete(id)
      this.ensure(id)
    }
  }

  private async drain(force: boolean): Promise<void> {
    if (this.disposed) return
    if (this.draining) { this.trailing = true; return }
    this.draining = true
    try {
      const ids = [...new Set([...this.dirty, ...this.finalPending])]
      for (let index = 0; index < ids.length; index += this.concurrency) {
        await Promise.all(ids.slice(index, index + this.concurrency).map(id => this.pull(id, force)))
        if (this.disposed) return
      }
    } finally {
      this.draining = false
    }
    if (this.trailing) {
      this.trailing = false
      if (!this.disposed) { this.emit(); this.arm() }
    }
  }

  private pull(id: string, force: boolean): Promise<void> {
    const held = this.pulls.get(id)
    if (held) return held
    // Event-driven repairs are rate limited to one per calibration window so a
    // sustained stream whose baseline never reaches the store cannot turn the
    // 250ms flush into an HTTP loop. Calibration ticks bypass the limit.
    if (!force && this.clock.now() - (this.lastPullAt.get(id) ?? Number.NEGATIVE_INFINITY) < this.activeMs) {
      return Promise.resolve()
    }
    const generation = this.generation
    const work = (async () => {
      this.lastPullAt.set(id, this.clock.now())
      const [session, messages] = await Promise.all([
        this.options.fetch.session(id).catch(() => undefined),
        this.options.fetch.messages(id).catch(() => undefined),
      ])
      if (this.disposed || generation !== this.generation) return
      const entry = this.views.get(id)
      if (entry) {
        if (session) entry.session = mergeSession(entry.session, session)
        if (messages?.length) entry.messages = mergeMessages(entry.messages, messages)
        entry.lastActivity = Math.max(entry.lastActivity, lastActivityOf(entry.messages))
      } else if (session) {
        this.views.set(id, {
          session,
          messages: messages ?? [],
          lastActivity: Math.max(session.updated, lastActivityOf(messages ?? [])),
        })
      }
      this.settle(id)
      if (!this.awaiting.has(id) && messages !== undefined) this.dirty.delete(id)
      // Keep the pending marker when the final message page failed, so the
      // next calibration retries instead of silently keeping stale values.
      if (session && messages !== undefined && this.finalPending.has(id) && !this.running.has(id)) {
        this.finalPending.delete(id)
      }
      this.emit()
    })()
    this.pulls.set(id, work)
    void work.finally(() => {
      if (this.pulls.get(id) === work) this.pulls.delete(id)
    })
    return work
  }

  private arm(): void {
    if (this.disposed) return
    const busy = this.running.size > 0 || this.dirty.size > 0 || this.finalPending.size > 0
    const delay = busy ? this.activeMs : this.idleMs
    const due = this.clock.now() + delay
    if (this.calibrationTimer !== undefined && this.calibrationDue <= due) return
    if (this.calibrationTimer !== undefined) this.clock.cancel(this.calibrationTimer)
    this.calibrationDue = due
    this.calibrationTimer = this.clock.schedule(() => { void this.tick() }, delay)
  }

  private clearTimers(): void {
    if (this.flushTimer !== undefined) this.clock.cancel(this.flushTimer)
    if (this.calibrationTimer !== undefined) this.clock.cancel(this.calibrationTimer)
    this.flushTimer = undefined
    this.calibrationTimer = undefined
    this.calibrationDue = 0
  }

  private emit(): void {
    if (this.disposed) return
    this.options.onChange({
      views: new Map(this.views),
      running: new Set(this.running),
      known: this.activeKnown,
    })
  }
}
