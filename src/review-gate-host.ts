import type { Plugin } from "@opencode/plugin"
import { createHash } from "node:crypto"
import { lstatSync } from "node:fs"
import { join } from "node:path"
import type { ReviewGateConfig } from "./config"
import { evaluateGate, extractReviewSkip, gateFingerprint, renderReminder, type ChangeSet } from "./review-gate"
import { collectNativeChanges, fromReviewListing, snapshotNative, type NativeChanges, type NativeSnapshot } from "./review-gate-git"
import { inspectProject, TaskRegistryError } from "./tasks-registry"
import { reviewTask } from "./tasks-review"
import { Ledger, type TaskRecord } from "./tasks-state"

type HostSession = Awaited<ReturnType<Plugin.Context["session"]["get"]>>
type FingerprintState = { firstSeenAt: number; reminders: number }
type RootState = {
  baseline?: NativeSnapshot
  promptSeen: boolean
  lastFingerprint?: string
  pending?: { key: string; after?: string }
  reminders: number
  acked: Set<string>
  fingerprints: Map<string, FingerprintState>
  checking: boolean
}

const planReference = /\bplans\/[\w.\/-]+\.md\b/
const isRoot = (session: HostSession) => session.agent === "root" && !session.parentID
const errorCode = (error: unknown) => error instanceof TaskRegistryError ? error.code : "HOST_ERROR"
// Identical edits in different worktrees stay independent; metadata uses the pure fingerprint.
const changeKey = (change: ChangeSet, fingerprint: string) => `${change.taskID ?? "native"}:${fingerprint}`
const eligibleReviewers = (data: HostSession[]) => data.filter(child => child.agent === "reviewer"
  && child.outcome !== "failed" && child.outcome !== "interrupted")

// Undefined means no trustworthy mtime for the entire set: either pure deletion
// or at least one non-deletion cannot be observed. Never use a partial maximum.
function coverageTime({ dir, files }: ChangeSet): number | undefined {
  let latest: number | undefined
  for (const { path, type } of files) {
    if (type === "deleted") continue
    try {
      const { mtimeMs } = lstatSync(join(dir, path)) // Use the link's own time, not its target's.
      latest = latest === undefined ? mtimeMs : Math.max(latest, mtimeMs)
    } catch { return undefined }
  }
  return latest
}

async function listRootChildren(ctx: Plugin.Context, parentID: HostSession["id"]) {
  const data: HostSession[] = [], seen = new Set<string>()
  let cursor: string | undefined
  for (let page = 0; page < 20; page++) {
    const result = await ctx.session.list({ parentID, limit: 200, ...(cursor ? { cursor } : {}) })
    data.push(...result.data)
    cursor = result.cursor?.next ?? undefined
    if (!cursor) return { data, complete: true }
    if (seen.has(cursor)) break
    seen.add(cursor)
  }
  return { data, complete: false }
}

// v2.4.1 stores assistant output as content parts; accept flat text as well.
function messageText(message?: { text?: unknown; content?: readonly { type: string; text?: unknown }[] }) {
  if (typeof message?.text === "string") return message.text
  return message?.content?.flatMap(part => part.type === "text" && typeof part.text === "string" ? [part.text] : []).join("\n") ?? ""
}

type ChildList = () => ReturnType<typeof listRootChildren>
async function readNativePlan(ctx: Plugin.Context, native: NativeChanges, cfg: ReviewGateConfig, listChildren: ChildList) {
  if (native.status !== "available" || cfg.planMinFiles <= 0 || native.files.length < cfg.planMinFiles) return
  for (const child of (await listChildren()).data) {
    if (child.agent !== "engineer") continue
    const messages = await ctx.session.context({ sessionID: child.id })
    const text = messageText(messages.find(message => message.type === "user"))
    if (planReference.test(Buffer.from(text.slice(0, 8192)).subarray(0, 8192).toString("utf8"))) {
      native.planRef = true
      return
    }
  }
}

// Mirror tasks.ts' private binding check; a ledger session ID alone is not proof of identity.
function matchesTask(session: HostSession, task: TaskRecord, commonDir: string) {
  const binding = session.metadata?.crewTask
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) return false
  const expected = {
    namespace: "opencode-crew-stage1", taskID: task.taskID,
    requestDigest: task.requestDigest, ownerSessionID: task.ownerSessionID,
    project: createHash("sha256").update(commonDir).digest("hex"),
  }
  return session.id === task.sessionID && session.agent === "engineer" && session.location?.directory === task.input.directory
    && Object.entries(expected).every(([key, value]) => (binding as Record<string, unknown>)[key] === value)
}

type TaskObservation = { taskID: string } & (
  | { status: "available"; change: ChangeSet }
  | { status: "busy" }
  | { status: "unavailable"; error: { code: string } }
)

async function collectTasks(ctx: Plugin.Context, dir: string, rootID: HostSession["id"]) {
  const tasks: TaskObservation[] = []
  try {
    const project = inspectProject(dir)
    if (dir !== project.primaryDirectory) throw new TaskRegistryError("PROJECT_MISMATCH")
    for (const { record, periodID } of new Ledger(project).active(rootID)) {
      const { taskID } = record
      const unavailable = (code: string) => tasks.push({ taskID, status: "unavailable", error: { code } })
      if (!record.sessionID) { unavailable("SESSION_UNBOUND"); continue }
      try {
        const session = await ctx.session.get({ sessionID: record.sessionID as HostSession["id"] })
        if (!matchesTask(session, record, project.commonDir)) { unavailable("SESSION_MISMATCH"); continue }
        const { busy, idle } = session.time
        if (busy !== undefined && !(idle !== undefined && idle >= busy)) { tasks.push({ taskID, status: "busy" }); continue }
        const { directory, baseline, scope, goal, acceptance, check } = record.input
        const listing = reviewTask({ primaryDirectory: project.primaryDirectory, directory, taskID,
          baseline, scope, periodID, limits: { timeoutMs: 3000 } })
        const change = fromReviewListing(directory, listing)
        change.planRef = [goal, acceptance, check].some(text => planReference.test(text))
        tasks.push({ taskID, status: "available", change })
      } catch (error) { unavailable(errorCode(error)) }
    }
  } catch (error) { return { tasks, projectError: errorCode(error) } }
  return { tasks }
}

const noVerdict = () => ({ files: [], verdict: { hit: false, reasons: [] } })

// The host validates tool output as JSON: an `undefined` field is rejected with
// "Expected JSON value", so absent diagnostics are omitted instead of serialized.
function jsonSafe<T>(value: T): T {
  if (Array.isArray(value)) return value.map(item => jsonSafe(item)) as T
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) if (item !== undefined) out[key] = jsonSafe(item)
    return out as T
  }
  return value
}

function describeChange(change: ChangeSet, cfg: ReviewGateConfig, state: RootState | undefined,
  latestReviewer: number | undefined, reviewerListComplete: boolean) {
  const fingerprint = gateFingerprint(change)
  const key = changeKey(change, fingerprint)
  const observation = state?.fingerprints.get(key)
  // A read-only query does not become the first observation of an unknown-mtime fingerprint.
  const latestChangeAt = coverageTime(change) ?? observation?.firstSeenAt
  const covered = latestChangeAt !== undefined && latestReviewer !== undefined && latestReviewer >= latestChangeAt
  const reviewerCovered = covered ? true : latestChangeAt !== undefined && reviewerListComplete ? false : undefined
  const files = change.files.map(({ path, type }) => ({ path, type }))
  return {
    head: change.head, complete: change.complete, degraded: change.degraded ?? false, files,
    fileCount: new Set(files.map(file => file.path)).size,
    verdict: evaluateGate(change, cfg), fingerprint, latestChangeAt, reviewerCovered,
    acked: state?.acked.has(key) ?? false, reminders: observation?.reminders ?? 0,
  }
}

export async function registerReviewGate(ctx: Plugin.Context, cfg: ReviewGateConfig): Promise<void> {
  if (cfg.mode === "off") return
  const states = new Map<string, RootState>()
  const hooks = { idle: false, prompt: false }
  function stateFor(sessionID: string) {
    let state = states.get(sessionID)
    if (!state) {
      state = { promptSeen: false, reminders: 0, acked: new Set(), fingerprints: new Map(), checking: false }
      states.set(sessionID, state)
    }
    return state
  }

  try {
    await ctx.session.hook("experimental.idle", async ({ sessionID, background }) => {
      try {
        if (!isRoot(await ctx.session.get({ sessionID })) || background.length > 0) return
        const state = stateFor(sessionID)
        if (state.checking) return
        state.checking = true
        try {
          const dir = ctx.location.directory
          const native = collectNativeChanges(dir, { baseline: state.baseline })
          const { tasks } = await collectTasks(ctx, dir, sessionID)
          let children: ReturnType<typeof listRootChildren> | undefined
          const listChildren = () => children ??= listRootChildren(ctx, sessionID)

          await readNativePlan(ctx, native, cfg, listChildren)

          const changes = tasks.flatMap(task => task.status === "available" ? [task.change] : [])
          if (native.status === "available") changes.unshift(native)
          const observedAt = Date.now()
          const hits = changes.flatMap(change => {
            const verdict = evaluateGate(change, cfg)
            if (!verdict.hit) return []
            const fingerprint = gateFingerprint(change)
            const key = changeKey(change, fingerprint)
            if (state.acked.has(key)) return []
            let observation = state.fingerprints.get(key)
            if (!observation) {
              observation = { firstSeenAt: observedAt, reminders: 0 }
              state.fingerprints.set(key, observation)
            }
            return [{ change, verdict, fingerprint, key, observation }]
          })
          if (!hits.length && !state.pending) return
          const acknowledge = (key: string, change?: ChangeSet) => {
            state.acked.add(key)
            if (state.pending?.key === key) state.pending = undefined
            if (change === native && native.status === "available" && native.complete) {
              state.baseline = native.snapshot
              state.promptSeen = true
            }
          }
          const messages = await ctx.session.context({ sessionID })
          const assistant = messages.findLast(message => message.type === "assistant")
          let skipped: string | undefined
          // A skip can only answer a delivered reminder, and must not predate it or answer two reminders.
          // This explicit acknowledgement is independent of whether the reviewer list is complete.
          if (state.pending && assistant && assistant.id !== state.pending.after && extractReviewSkip(messageText(assistant))) {
            skipped = state.pending.key
            acknowledge(skipped, hits.find(hit => hit.key === skipped)?.change)
          }
          if (hits.every(hit => hit.key === skipped)) return

          const { data, complete } = await listChildren()
          const reviewers = eligibleReviewers(data)
          let notified = false
          for (const { change, verdict, fingerprint, key, observation } of hits) {
            if (key === skipped) continue
            // Prefer an extra reminder to proving coverage from an unknown timestamp.
            const latestChangeAt = coverageTime(change) ?? observation.firstSeenAt
            if (reviewers.some(child => child.time.created >= latestChangeAt)) {
              acknowledge(key, change)
              continue
            }

            // A truncated or cyclic listing cannot prove absence of a reviewer. Suppress this idle
            // without acknowledging or advancing the baseline for changes with no positive coverage.
            if (!complete || notified) continue
            if (cfg.mode === "remind" && (state.lastFingerprint === key || observation.reminders > 0 || state.reminders >= 5 * cfg.maxReminders)) continue
            if (cfg.mode === "enforce" && observation.reminders >= cfg.maxReminders) continue
            await ctx.session.synthetic({ sessionID, text: renderReminder(change, verdict), description: "crew review gate", delivery: "queue",
              metadata: { crewReviewGate: { fingerprint, rule: verdict.reasons.map(reason => reason.rule) } } })
            state.pending = { key, after: assistant?.id }
            state.lastFingerprint = key
            state.reminders++
            observation.reminders++
            notified = true
          }
        } finally { state.checking = false }
      } catch { /* Fail open: the Root may finish even if gate evaluation or admission fails. */ }
    })
    hooks.idle = true
  } catch { /* Keep the manual diagnostic available if idle is unsupported. */ }

  if (hooks.idle) try {
    await ctx.session.hook("prompt", async ({ sessionID }) => {
      try {
        if (states.get(sessionID)?.promptSeen || !isRoot(await ctx.session.get({ sessionID }))) return
        const state = stateFor(sessionID)
        if (state.promptSeen) return
        state.promptSeen = true
        state.baseline = snapshotNative(ctx.location.directory)
      } catch { /* No baseline: collect against HEAD and mark reminders degraded. */ }
    })
    hooks.prompt = true
  } catch { /* An unsupported prompt hook just disables baseline snapshots. */ }

  try {
    await ctx.tool.transform(editor => editor.add({
      name: "crew_review_gate",
      input: { type: "object", properties: {}, additionalProperties: false },
      output: { type: "object", additionalProperties: true },
      description: "仅 Root 使用。当怀疑审查门禁没有提醒、或想查某条规则为何命中时调用（输入 {}）。只读，不推进基线、不确认跳过、不消耗提醒次数、不发送消息。返回 mode/config/sessionID、baseline/hook 状态、native 及 active tasks 的状态、改动路径和类型、verdict、fingerprint、覆盖时间和 reviewerCovered、reviewers 摘要、state 提醒/待确认/已确认计数及 notes/error.code。unavailable/busy 表示未评估；覆盖信息缺失表示无法判定。",
      async execute(_input, tc) {
        const failure = (code: string, message: string) => ({ output: { error: { code, message } }, content: message })
        try {
          const { agent, sessionID } = tc
          if (agent !== "root") throw new TaskRegistryError("FORBIDDEN_CALLER")
          const owner = await ctx.session.get({ sessionID })
          if (owner.id !== sessionID || !isRoot(owner)) throw new TaskRegistryError("FORBIDDEN_CALLER")
          const state = states.get(sessionID) // Do not initialize or update any idle state.
          const baseline = state?.baseline
          const dir = ctx.location.directory
          const native = collectNativeChanges(dir, { baseline })
          const { tasks, projectError } = await collectTasks(ctx, dir, sessionID)
          const children = await listRootChildren(ctx, sessionID)
          await readNativePlan(ctx, native, cfg, () => Promise.resolve(children))
          const reviewers = eligibleReviewers(children.data)
          const latestCreatedAt = reviewers.length ? Math.max(...reviewers.map(child => child.time.created)) : undefined
          const describe = (change: ChangeSet) => describeChange(change, cfg, state, latestCreatedAt, children.complete)
          const notes: string[] = []
          if (!hooks.idle) notes.push("IDLE_HOOK_UNAVAILABLE：不会自动提醒，可手动诊断。")
          else if (!hooks.prompt) notes.push("PROMPT_HOOK_UNAVAILABLE：未注册基线采集。")
          if (native.status === "unavailable") notes.push("NATIVE_UNAVAILABLE：无法采集原生改动。")
          else if (!baseline) notes.push("BASELINE_MISSING：基线缺失，含既有改动。")
          if (projectError) notes.push(`${projectError}：工作区不是可检查的主 worktree，或任务账本不可用。`)
          if (!children.complete) notes.push("REVIEWER_LIST_INCOMPLETE：子会话列表不完整；缺少正向覆盖证据时不自动提醒。")
          const { mode, ...config } = cfg
          return { output: jsonSafe({
            mode, config, sessionID, baseline: { present: baseline !== undefined }, hooks: { ...hooks },
            native: { status: native.status, ...(native.status === "available" ? describe(native) : noVerdict()) },
            tasks: tasks.map(task => task.status === "available"
              ? { taskID: task.taskID, status: task.status, outsideScope: task.change.outsideScope, ...describe(task.change) }
              : { ...task, ...noVerdict() }),
            reviewers: { count: reviewers.length, latestCreatedAt, complete: children.complete },
            state: { reminders: state?.reminders ?? 0, pending: state?.pending?.key, acked: state?.acked.size ?? 0, lastFingerprint: state?.lastFingerprint },
            notes,
          }) }
        } catch (error) {
          const code = errorCode(error)
          return failure(code, code === "FORBIDDEN_CALLER" ? "只能由 Root 会话调用审查门禁诊断。" : "审查门禁诊断不可用；未改变任何门禁状态。")
        }
      },
    }))
  } catch { /* An unavailable diagnostic tool must not disable idle or plugin setup. */ }
}
