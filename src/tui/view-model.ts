// Read-only display model for the Crew sidebar claim. Pure functions over
// host-shaped data so the counting and warning rules stay unit-testable.

export type Tone = 'base' | 'muted' | 'faint' | 'info' | 'warning' | 'error'
export interface Span { text: string; tone: Tone; bold?: boolean }

export const WIDTH = 37
const WARN_STEP_RATIO = 0.8
/** Soft stall: show "无输出" but keep info tone so brief gaps do not look like hard failures. */
export const STALL_MS = 5 * 60_000
/** Hard stall: escalate the whole Delegations row to warning. */
export const STALL_HARD_MS = 15 * 60_000
const ROLE_ORDER = ['architect', 'engineer', 'explorer', 'reviewer']
const ALERT_RANK: Record<'failed' | 'blocked' | 'permission' | 'waiting', number> = {
  failed: 0, blocked: 1, permission: 2, waiting: 3,
}

export type ReportStatus = 'progress' | 'waiting' | 'ready' | 'blocked' | 'failed' | 'dropped'
const REPORT_TONE: Record<Exclude<ReportStatus, 'dropped'>, Tone> = {
  progress: 'info', waiting: 'warning', ready: 'warning', blocked: 'error', failed: 'error',
}

export interface TokenUsage { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
export interface ModelRefView { id: string; providerID: string; variant?: string }
export interface SessionView {
  id: string
  parentID?: string
  agent?: string
  created: number
  updated: number
  busy?: number
  idle?: number
  tokens?: TokenUsage
  cost?: number
  model?: ModelRefView
}
export interface CrewTaskView {
  taskID: string
  sessionID?: string
  directory: string
  scopes: number
  state: string
  lifecycle: 'active' | 'closed'
  check: string
  observed?: { outcome?: 'succeeded' | 'failed' | 'interrupted'; busyAt?: string; idleAt?: string; errorCode?: string }
  report?: { status: ReportStatus; reason?: string }
  steps: number
  tokens?: number
  cacheRead?: number
  cost?: number
  permissions?: { action: string; resources: string[] }[]
}
export interface PartView {
  type: string
  name?: string
  text?: string
  state?: { status: string; input?: unknown }
  time?: { created?: number; completed?: number }
}
export interface MessageView {
  id?: string
  type: string
  agent?: string
  tokens?: TokenUsage
  time?: { created?: number; streamed?: number; completed?: number }
  content?: PartView[]
}
export interface ViewInput {
  rootID: string
  sessions: SessionView[]
  tasks: CrewTaskView[]
  now: number
  status: (id: string) => 'idle' | 'running'
  /** Authoritative liveness when the caller has one (e.g. the server active snapshot). */
  running?: (session: SessionView) => boolean
  messages: (id: string) => MessageView[]
  cost: (id: string) => number
  /** Last confirmed output from events, when the caller tracks it separately. */
  lastActivity?: (id: string) => number
  limit: (agent: string | undefined) => number
  /** Last successful live calibration; when set, buildSidebar emits a freshness line. */
  calibratedAt?: number
  /** False until the first active-set probe; freshness says 未校准. */
  known?: boolean
  /** Current calibration cadence used for the "可能滞后" threshold. */
  calibrationIntervalMs?: number
}
export interface AlertRow {
  spans: Span[]
  sessionID?: string
  /** Severity for sort/grading; hard failures rank above human-waiting. */
  kind?: 'failed' | 'blocked' | 'permission' | 'waiting'
}
export interface SidebarView {
  alerts: AlertRow[]
  /** Faint/warning line: last calibration age, or 可能滞后 / 未校准. */
  freshness?: Span[]
  delegations?: { title: Span[]; rows: Span[][]; runningCount: number }
  subagents?: { title: Span[]; header: Span[]; rows: Span[][]; footnote?: Span[] }
}

// --- cell width (grapheme-aware, CJK = 2) ---

const graphemes = (s: string): string[] =>
  Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s), x => x.segment)
export const cells = (s: string): number =>
  graphemes(s).reduce((w, g) => w + (/[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/u.test(g) ? 2 : 1), 0)
const take = (s: string, max: number): string => {
  const out: string[] = []
  let w = 0
  for (const g of graphemes(s)) {
    const n = cells(g)
    if (w + n > max) break
    out.push(g)
    w += n
  }
  return out.join('')
}
export const truncateCells = (s: string, max: number): string =>
  cells(s) <= max ? s : take(s, Math.max(0, max - 1)) + '…'
export const padEndCells = (s: string, max: number): string => s + ' '.repeat(Math.max(0, max - cells(s)))
export const padStartCells = (s: string, max: number): string => ' '.repeat(Math.max(0, max - cells(s))) + s

// --- host-parity activity labels ---

export const canonicalToolName = (name: string): string =>
  name === 'bash' ? 'shell' : name === 'task' ? 'subagent' : name === 'apply_patch' ? 'patch' : name

/**
 * Compact activity label. Delegations only lists running sessions, so the
 * "Running" verb is redundant and costs 8 of the 37 columns; only the
 * streaming state keeps a marker ("prep") because it means the tool call
 * arguments are still being generated.
 */
export function busyLabel(part: PartView): string {
  if (part.type === 'reasoning') return 'thinking…'
  const name = canonicalToolName(part.name ?? '')
  const noun = name === 'shell' ? 'command' : name === 'execute' ? 'code' : name
  return part.state?.status === 'streaming' ? `prep ${noun}…` : `${noun}…`
}

const isActive = (part: PartView, messageCompleted: boolean): boolean => {
  if (part.type === 'reasoning') return !messageCompleted && part.time?.completed === undefined
  return part.type === 'tool' && (part.state?.status === 'streaming' || part.state?.status === 'running')
}

export function sessionActivity(messages: MessageView[]): string {
  const last = [...messages].reverse().find(m => m.type === 'assistant')
  const part = last ? [...(last.content ?? [])].reverse().find(p => isActive(p, last.time?.completed !== undefined)) : undefined
  return part ? busyLabel(part) : 'thinking…'
}

// --- counting ---

export const countSteps = (messages: MessageView[]): number => messages.filter(m => m.type === 'assistant').length

export const messageStamp = (m: MessageView): number => Math.max(
  m.time?.created ?? 0,
  m.time?.streamed ?? 0,
  m.time?.completed ?? 0,
  ...(m.content ?? []).flatMap(p => [p.time?.created ?? 0, p.time?.completed ?? 0]),
)

/**
 * Last confirmed output in a transcript. The host's cached `session.updated`
 * does not advance for step/tool events, so stall detection must also look at
 * message and part timestamps; a successful poll is never an activity signal.
 */
export const lastActivityOf = (messages: MessageView[]): number =>
  messages.reduce((max, m) => Math.max(max, messageStamp(m)), 0)

// Fallback when no authoritative liveness source is available: a terminal
// event can leave status pinned at 'running', and a started event can hide a
// live session. The busy/idle watermarks veto a stale running status only
// when the completion (idle) landed; they cannot tell a live run from one
// whose terminal event was lost. Callers with a server snapshot should pass
// `running` to buildSidebar instead.
export function sessionRunning(s: SessionView, status: (id: string) => 'idle' | 'running'): boolean {
  if (s.busy !== undefined) return s.busy > (s.idle ?? 0)
  if (s.idle !== undefined) return false
  return status(s.id) === 'running'
}
export const tokenTotal = (t?: TokenUsage): number =>
  t ? (t.input ?? 0) + (t.output ?? 0) + (t.reasoning ?? 0) + (t.cache?.write ?? 0) : 0
export const compactTokens = (n: number): string =>
  n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(Math.round(n))
/** Integer-precision shorthand, used only when the exact pair overflows the column. */
const tightTokens = (n: number): string =>
  n >= 1e9 ? (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B' : n >= 1e6 ? Math.round(n / 1e6) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(Math.round(n))
const TOKENS_WIDTH = 10
/** Work + cache cell. Drops precision, never the cache value, to stay inside the column. */
function tokenCell(work: number, cacheRead: number): string {
  const exact = compactTokens(work)
  if (!cacheRead) return exact
  const options = [
    `${exact}+${compactTokens(cacheRead)}`,
    `${exact}+${tightTokens(cacheRead)}`,
    `${tightTokens(work)}+${tightTokens(cacheRead)}`,
  ]
  return options.find(text => cells(text) <= TOKENS_WIDTH) ?? options[options.length - 1]
}
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
export const money = (n: number): string => usd.format(n)
const overBudget = (steps: number, limit: number): boolean => limit > 0 && steps >= limit * WARN_STEP_RATIO

export interface RoleStat { role: string; sessions: number; tokens: number; cacheRead?: number; cost: number; fullSteps: number }

// Illustrative anomaly rule: a session hit its step limit, or sessions / tokens
// / cost are at least double the next-highest role (with absolute floors so a
// small session does not light up). Thresholds are placeholders.
export function subagentAnomalies(list: RoleStat[]): Set<string> {
  const second = (key: 'sessions' | 'tokens' | 'cost', role: string) =>
    Math.max(0, ...list.filter(x => x.role !== role).map(x => x[key]))
  return new Set(list.filter(x =>
    x.fullSteps > 0
    || (x.sessions >= 5 && x.sessions >= 2 * second('sessions', x.role))
    || (x.tokens >= 500000 && x.tokens >= 2 * second('tokens', x.role))
    || (x.cost >= 1 && x.cost >= 2 * second('cost', x.role))
  ).map(x => x.role))
}


/** Age line for the live calibration cadence (events + 15s/60s repair poll). */
export function freshnessSpans(input: {
  now: number
  known?: boolean
  calibratedAt?: number
  calibrationIntervalMs?: number
}): Span[] {
  if (!input.known || !input.calibratedAt) return [span('未校准', 'faint')]
  const age = Math.max(0, input.now - input.calibratedAt)
  const interval = input.calibrationIntervalMs ?? 15_000
  const stale = age > interval * 1.5
  const label = age < 1_500 ? '刚刚'
    : age < 60_000 ? `${Math.max(1, Math.round(age / 1000))}s 前`
    : `${Math.max(1, Math.floor(age / 60_000))}m 前`
  const text = stale ? `可能滞后 · 校准 ${label}` : `校准 ${label}`
  return [span(truncateCells(text, WIDTH), stale ? 'warning' : 'faint')]
}

// --- rows ---

const span = (text: string, tone: Tone, bold?: boolean): Span => ({ text, tone, ...(bold ? { bold } : {}) })
const title = (name: string, mutedTail: string): Span[] => [span(name, 'base', true), span(` ${mutedTail}`, 'muted')]

function alertRow(task: CrewTaskView, kind: 'permission' | 'waiting' | 'blocked' | 'failed', text: string): AlertRow {
  const tone: Tone = kind === 'failed' || kind === 'blocked' ? 'error' : 'warning'
  const label = kind === 'permission' ? '权限' : kind
  const detail = truncateCells(text, Math.max(1, WIDTH - 16 - cells(label) - 1))
  return {
    kind,
    sessionID: task.sessionID,
    spans: [
      span('!', tone),
      span(` ${padEndCells(truncateCells(task.taskID, 13), 13)} `, 'base'),
      span(label, tone),
      span(` ${detail}`, 'muted'),
    ],
  }
}

const relative = (resource: string | undefined, directory: string): string =>
  resource === undefined ? '' : resource.startsWith(directory + '/') ? resource.slice(directory.length + 1) : resource

const effectiveReport = (t: CrewTaskView): Exclude<ReportStatus, 'dropped'> =>
  t.report?.status && t.report.status !== 'dropped'
    ? t.report.status
    : t.observed?.outcome === 'failed' || t.observed?.outcome === 'interrupted' ? 'failed' : 'progress'

function delegationRow(s: SessionView, depth: number, input: ViewInput): Span[] {
  const limit = input.limit(s.agent)
  const messages = input.messages(s.id)
  const steps = countSteps(messages)
  const seen = Math.max(s.updated, lastActivityOf(messages), input.lastActivity?.(s.id) ?? 0)
  const idleFor = input.now - seen
  const softStall = idleFor >= STALL_MS
  const hardStall = idleFor >= STALL_HARD_MS
  const budget = overBudget(steps, limit)
  const warn = hardStall || budget
  const activity = softStall ? `无输出 ${Math.max(1, Math.floor(idleFor / 60000))}m` : sessionActivity(messages)
  const role = '  '.repeat(Math.min(depth, 4)) + (s.agent ?? '?')
  const roleTone: Tone = warn ? 'warning' : 'base'
  const activityTone: Tone = warn ? 'warning' : 'info'
  const stepTone: Tone = warn ? 'warning' : 'faint'
  const step = `~${steps}/${limit || '—'}`
  const stepWidth = Math.min(12, Math.max(6, cells(step)))
  const activityWidth = WIDTH - 10 - 1 - 1 - stepWidth
  return [
    span(padEndCells(truncateCells(role, 10), 10), roleTone),
    span(' ', roleTone),
    span(padEndCells(truncateCells(activity, activityWidth), activityWidth), activityTone),
    span(' ', roleTone),
    span(padStartCells(truncateCells(step, stepWidth), stepWidth), stepTone),
  ]
}

function taskRows(t: CrewTaskView, limit: number): Span[][] {
  const report = effectiveReport(t)
  const warn = overBudget(t.steps, limit)
  const step = `~${t.steps}/${limit}`
  const stepWidth = Math.min(12, Math.max(6, cells(step)))
  const idWidth = WIDTH - 1 - cells(report) - 1 - stepWidth
  const head: Span[] = [
    span(padEndCells(truncateCells(t.taskID, idWidth), idWidth), warn ? 'warning' : 'base'),
    span(' ', 'base'),
    span(report, REPORT_TONE[report]),
    span(' ', 'base'),
    span(padStartCells(truncateCells(step, stepWidth), stepWidth), warn ? 'warning' : 'faint'),
  ]
  const detail = report === 'ready'
    ? { key: 'next', value: 'Root 验收证据' }
    : report === 'blocked' || report === 'failed'
      ? { key: 'next', value: t.report?.reason || (report === 'failed' ? '查看失败日志' : '人工介入') }
      : { key: 'check', value: t.check }
  const tail: Span[] = [
    span(detail.key, 'faint'),
    span(` ${truncateCells(detail.value, WIDTH - cells(detail.key) - 1)}`, 'muted'),
  ]
  return [head, tail]
}

export function buildSidebar(input: ViewInput): SidebarView {
  const family = input.sessions.filter(s => s.id !== input.rootID)
  const byID = new Map(family.map(s => [s.id, s]))
  const childrenOf = new Map<string, SessionView[]>()
  for (const s of family) {
    const parent = s.parentID && byID.has(s.parentID) ? s.parentID : input.rootID
    childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), s])
  }

  const visibleTasks = input.tasks.filter(t => t.report?.status !== 'dropped')

  const alerts: AlertRow[] = []
  for (const t of visibleTasks) {
    for (const p of t.permissions ?? []) {
      alerts.push(alertRow(t, 'permission', `${p.action} ${relative(p.resources[0], t.directory)}`.trim()))
    }
    if (t.report?.status === 'waiting') alerts.push(alertRow(t, 'waiting', t.report.reason ?? '等待外部输入'))
    if (t.report?.status === 'blocked') alerts.push(alertRow(t, 'blocked', t.report.reason ?? ''))
    if (t.report?.status === 'failed') alerts.push(alertRow(t, 'failed', t.report.reason ?? ''))
  }
  alerts.sort((a, b) => {
    const ra = ALERT_RANK[a.kind ?? 'waiting']
    const rb = ALERT_RANK[b.kind ?? 'waiting']
    if (ra !== rb) return ra - rb
    const ida = a.spans[1]?.text ?? ''
    const idb = b.spans[1]?.text ?? ''
    return ida.localeCompare(idb)
  })

  const rows: Span[][] = []
  let runningCount = 0
  const isRunning = input.running ?? ((s: SessionView) => sessionRunning(s, input.status))
  const visit = (parent: string, depth: number) => {
    for (const s of (childrenOf.get(parent) ?? []).slice().sort((a, b) => a.created - b.created)) {
      if (isRunning(s)) {
        runningCount++
        rows.push(delegationRow(s, depth, input))
      }
      visit(s.id, depth + 1)
    }
  }
  visit(input.rootID, 0)

  for (const t of visibleTasks) {
    const report = effectiveReport(t)
    if (report === 'progress' || report === 'waiting') runningCount++
    rows.push(...taskRows(t, input.limit('engineer')))
  }
  const delegations = rows.length
    ? { title: title('Delegations', `(${runningCount} running)`), rows, runningCount }
    : undefined

  const stats = new Map<string, RoleStat>()
  const put = (role: string) => {
    const hit = stats.get(role)
    if (hit) return hit
    const created: RoleStat = { role, sessions: 0, tokens: 0, cacheRead: 0, cost: 0, fullSteps: 0 }
    stats.set(role, created)
    return created
  }
  for (const s of family) {
    const role = s.agent ?? 'unknown'
    const stat = put(role)
    stat.sessions++
    stat.tokens += tokenTotal(s.tokens)
    stat.cacheRead = (stat.cacheRead ?? 0) + (s.tokens?.cache?.read ?? 0)
    stat.cost += input.cost(s.id)
    if (countSteps(input.messages(s.id)) >= input.limit(role)) stat.fullSteps++
  }
  for (const t of input.tasks) {
    // crew_task usage belongs to engineer; it is not a native subagent session.
    const stat = put('engineer')
    stat.tokens += t.tokens ?? 0
    stat.cacheRead = (stat.cacheRead ?? 0) + (t.cacheRead ?? 0)
    stat.cost += t.cost ?? 0
    if (t.steps >= input.limit('engineer')) stat.fullSteps++
  }

  const roleRank = (role: string) => ROLE_ORDER.indexOf(role) === -1 ? ROLE_ORDER.length : ROLE_ORDER.indexOf(role)
  const used = [...stats.values()].filter(x => x.sessions > 0 || x.tokens > 0 || x.cost > 0)
    .sort((a, b) => roleRank(a.role) - roleRank(b.role) || a.role.localeCompare(b.role))
  const subagents = used.length ? (() => {
    const warn = subagentAnomalies(used)
    const total = used.reduce((n, x) => n + x.sessions, 0)
    const cost = used.reduce((n, x) => n + x.cost, 0)
    const head = [span(
      ' '.repeat(10)
      + padStartCells('sess', 6)
      + ' '
      + padStartCells('tok+cache', 10)
      + padStartCells('cost', 10),
      'faint',
    )]
    const body = used.map(x => {
      const w = warn.has(x.role)
      const tone: Tone = w ? 'warning' : 'muted'
      const tokens = tokenCell(x.tokens, x.cacheRead ?? 0)
      return [
        span(padEndCells(truncateCells(x.role, 10), 10), w ? 'warning' : 'base'),
        span(
          padStartCells(String(x.sessions), 6)
          + ' '
          + padStartCells(tokens, 10)
          + padStartCells(money(x.cost), 10),
          tone,
        ),
      ]
    })
    const footnote = [
      span(truncateCells('tok 含 cache.read · 见 sidebar-ui', WIDTH), 'faint'),
    ]
    return {
      title: title('Subagents', `(${total} session${total === 1 ? '' : 's'} · ${money(cost)})`),
      header: head,
      rows: body,
      footnote,
    }
  })() : undefined

  const freshness = freshnessSpans({
    now: input.now,
    known: input.known,
    calibratedAt: input.calibratedAt,
    calibrationIntervalMs: input.calibrationIntervalMs,
  })

  return { alerts, freshness, delegations, subagents }
}
