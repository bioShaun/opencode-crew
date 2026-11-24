import { afterEach, expect, spyOn, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import plugin from "../src/index"
import { defaultReviewGate, type ReviewGateConfig } from "../src/config"
import { gateFingerprint } from "../src/review-gate"
import * as gitReview from "../src/review-gate-git"
import { fromReviewListing } from "../src/review-gate-git"
import { registerReviewGate } from "../src/review-gate-host"
import { inspectProject, TaskRegistryError, validateWorktree } from "../src/tasks-registry"
import * as taskReview from "../src/tasks-review"
import { Ledger } from "../src/tasks-state"
import { WORK } from "./workdir"

const base = join(WORK, "review-gate", "host")
const scratch: string[] = []
afterEach(() => { for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true }) })

function git(cwd: string, ...args: string[]) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")))
  const result = spawnSync("git", args, { cwd, env: { ...env, TMPDIR: base }, encoding: "utf8" })
  if (result.status !== 0) throw new Error(`fixture git ${args.join(" ")}: ${result.stderr}`)
  return result.stdout.trim()
}

type HostSession = {
  id: string; agent: string; parentID?: string; outcome?: string
  time: { created: number; idle?: number; busy?: number }; location?: { directory: string }; metadata?: Record<string, any>
}
type Message = { type: string; text?: string; content?: { type: string; text?: string }[] }
type ChildPage = { data: HostSession[]; cursor: { next?: string } }

function fixture(options: Partial<ReviewGateConfig> = {}) {
  mkdirSync(base, { recursive: true })
  const parent = realpathSync(mkdtempSync(join(base, "repo-"))), dir = join(parent, "primary")
  scratch.push(parent)
  mkdirSync(dir)
  git(dir, "init")
  writeFileSync(join(dir, "original.test.ts"), "tracked")
  git(dir, "add", ".")
  git(dir, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "base")
  const head = git(dir, "rev-parse", "HEAD"), hooks = new Map<string, (event: any) => Promise<void>>()
  const root: HostSession = { id: "ses_root", agent: "root", time: { created: 1 }, location: { directory: dir } }
  const sessions = new Map([[root.id, root]]), messages = new Map<string, Message[]>()
  const messageIDs = new WeakMap<Message, string>()
  let nextMessage = 0
  const sent: any[] = [], registered: string[] = [], getCalls: string[] = [], listCalls: any[] = [], tools: any[] = []
  const cfg: ReviewGateConfig = { ...defaultReviewGate, mode: "remind", ...options }
  const controls: { rejectHook?: string; rejectSynthetic?: boolean; rejectGet?: boolean; childPage?: (cursor?: string) => ChildPage } = {}
  const ctx: any = {
    location: { directory: dir }, options: { reviewGate: cfg },
    agent: { transform: async (fn: any) => fn({ update: (_: string, update: any) => update({ permissions: [] }) }) },
    permission: { hook: async () => ({ dispose: async () => {} }) },
    command: { transform: async (fn: any) => fn({ add: () => {} }) },
    tool: { transform: async (fn: any) => fn({ add: (tool: any) => tools.push(tool) }) },
    session: {
      hook: async (name: string, cb: (event: any) => Promise<void>) => {
        registered.push(name)
        if (controls.rejectHook === name) throw new Error("unsupported hook")
        hooks.set(name, cb)
        return { dispose: async () => {} }
      },
      get: async ({ sessionID }: { sessionID: string }) => {
        getCalls.push(sessionID)
        if (controls.rejectGet || !sessions.has(sessionID)) throw new Error("unavailable session")
        return sessions.get(sessionID)
      },
      list: async (input: { parentID: string; limit: number; cursor?: string }) => {
        listCalls.push(input)
        return controls.childPage?.(input.cursor) ?? {
          data: [...sessions.values()].filter(session => session.parentID === input.parentID), cursor: {},
        }
      },
      context: async ({ sessionID }: { sessionID: string }) => (messages.get(sessionID) ?? []).map(message => {
        if (!messageIDs.has(message)) messageIDs.set(message, `msg_${++nextMessage}`)
        return { ...message, id: messageIDs.get(message) }
      }),
      synthetic: async (input: unknown) => {
        if (controls.rejectSynthetic) throw new Error("host rejected synthetic")
        sent.push(input)
        return { id: "msg_synthetic" }
      },
    },
  }
  async function hook(name: string, event: unknown) {
    expect(hooks.has(name)).toBe(true)
    await hooks.get(name)!(event)
  }
  return {
    cfg, ctx, root, sent, registered, getCalls, listCalls, tools, controls, messages, hooks, dir, head, parent,
    start: () => registerReviewGate(ctx, cfg),
    prompt: () => hook("prompt", { sessionID: root.id }),
    idle: (background: unknown[] = []) => hook("experimental.idle", { sessionID: root.id, background }),
    edit: (path = "AGENTS.md", text = "changed") => writeFileSync(join(dir, path), text),
    child: (session: HostSession) => sessions.set(session.id, session),
    diagnose: async (agent = "root") => {
      const tool = tools.find(tool => tool.name === "crew_review_gate")
      expect(tool?.name).toBe("crew_review_gate")
      return (await tool.execute({}, { agent, sessionID: root.id })).output
    },
  }
}

type Fixture = ReturnType<typeof fixture>
const reviewer = (f: Fixture, created: number, outcome = "succeeded"): HostSession =>
  ({ id: "ses_reviewer", agent: "reviewer", parentID: f.root.id, time: { created }, outcome })

function crewTask(f: Fixture, goal = "implement") {
  const directory = join(f.parent, "writer")
  git(f.dir, "worktree", "add", "--detach", directory, f.head)
  const project = inspectProject(f.dir), ledger = new Ledger(project)
  const input = { key: "gate", directory, baseline: f.head, scope: ["src/"], goal, acceptance: "accept", check: "verify" }
  const owner = f.root.id, { task: { taskID } } = ledger.reserve(owner, input, () => validateWorktree(f.dir, directory, f.head, input.scope))
  ledger.transition(owner, taskID, "reserved", "session_create_requested")
  const sessionID = "ses_writer"
  const record = ledger.transition(owner, taskID, "session_create_requested", "session_bound", { sessionID })
  const metadata = { crewTask: {
    namespace: "opencode-crew-stage1", taskID, requestDigest: record.requestDigest, ownerSessionID: owner,
    project: createHash("sha256").update(project.commonDir).digest("hex"),
  } }
  const engineer: HostSession = { id: sessionID, agent: "engineer", location: { directory }, metadata, time: { created: 1 } }
  f.child(engineer)
  return { directory, taskID, ledger, engineer }
}

test("off registers no hook or tool", async () => {
  const f = fixture({ mode: "off" }); await f.start()
  expect(f.registered).toEqual([])
  expect(f.tools).toEqual([])
})

for (const kind of ["non-Root", "child Root", "background"] as const) {
  test(`${kind} never gets evaluated or notified`, async () => {
    const f = fixture(); await f.start(); await f.prompt(); f.edit()
    if (kind === "non-Root") f.root.agent = "build"
    if (kind === "child Root") f.root.parentID = "ses_parent"
    if (kind === "background") await f.idle([{ kind: "image" }]); else await f.idle()
    expect(f.listCalls).toEqual([])
    expect(f.sent).toEqual([])
  })
}

test("no changes and pre-existing dirt do not remind; second prompt does not reset the baseline", async () => {
  const f = fixture(); await f.start(); f.edit(); await f.prompt(); await f.idle()
  expect(f.sent).toHaveLength(0)
  f.edit("AGENTS.md", "edited after first prompt"); await f.prompt(); await f.idle()
  expect(f.sent).toHaveLength(1)
  expect(f.sent[0].text).not.toContain("基线缺失")
})

test("clean Root does not get a reminder", async () => {
  const f = fixture(); await f.start(); await f.prompt(); await f.idle()
  expect(f.sent).toHaveLength(0)
})

test("setup connects parsed options after task hooks; one reminder carries exact metadata", async () => {
  const f = fixture(); await plugin.setup(f.ctx); await f.prompt(); f.edit(); await f.idle(); await f.idle()
  const { size, mtimeMs } = lstatSync(join(f.dir, "AGENTS.md"))
  const fingerprint = gateFingerprint({ head: f.head, files: [{ path: "AGENTS.md", type: "added", token: `${size}:${mtimeMs}` }] })
  expect(f.registered.indexOf("retry")).toBeLessThan(f.registered.indexOf("experimental.idle"))
  expect(f.sent).toEqual([{
    sessionID: f.root.id, description: "crew review gate", delivery: "queue",
    text: expect.stringContaining("[crew-review-gate]"), metadata: { crewReviewGate: { fingerprint, rule: ["sensitivePath"] } },
  }])
})

test("a covering reviewer advances native baseline and does not remind about covered paths later", async () => {
  const f = fixture({ maxFiles: 1 }); await f.start(); await f.prompt(); f.edit()
  f.child(reviewer(f, Math.ceil(lstatSync(join(f.dir, "AGENTS.md")).mtimeMs)))
  await f.idle(); f.edit("plain.txt"); await f.idle()
  expect(f.sent).toHaveLength(0)
  expect(f.listCalls).toContainEqual({ parentID: f.root.id, limit: 200 })
})

for (const reason of ["old", "failed", "interrupted"] as const) {
  test(`${reason} reviewer does not cover native changes`, async () => {
    const f = fixture(); await f.start(); await f.prompt(); f.edit()
    f.child(reviewer(f, reason === "old" ? 1 : Date.now() + 1000, reason === "old" ? "succeeded" : reason))
    await f.idle(); expect(f.sent).toHaveLength(1)
  })
}

test("enforce limits each fingerprint independently", async () => {
  const f = fixture({ mode: "enforce", maxReminders: 2 }); await f.start(); await f.prompt(); f.edit()
  await f.idle(); await f.idle(); await f.idle()
  expect(f.sent).toHaveLength(2)
  const first = f.sent[0].metadata.crewReviewGate.fingerprint
  expect(f.sent[1].metadata.crewReviewGate.fingerprint).toBe(first)
  f.edit("AGENTS.md", "second revision"); await f.idle()
  expect(f.sent).toHaveLength(3)
  expect(f.sent[2].metadata.crewReviewGate.fingerprint).not.toBe(first)
})

test("remind never repeats a seen fingerprint and stops after the Root session cap", async () => {
  const f = fixture({ maxReminders: 1 }); await f.start(); await f.prompt(); f.edit(); await f.idle()
  const path = join(f.dir, "extra.txt")
  f.edit("extra.txt"); await f.idle(); rmSync(path); await f.idle()
  expect(f.sent).toHaveLength(2)
  for (let i = 1; i <= 5; i++) { f.edit("extra.txt", "x".repeat(i + 10)); await f.idle() }
  expect(f.sent).toHaveLength(5)
})

test("only latest assistant skip is used; valid skip stops and advances the native baseline", async () => {
  const f = fixture({ mode: "enforce", maxFiles: 1 }); await f.start(); await f.prompt(); f.edit(); await f.idle()
  f.messages.set(f.root.id, [
    { type: "assistant", text: "Review-Skip: older decision ignored" }, { type: "assistant", text: "Review-Skip: short" },
    { type: "user", text: "Review-Skip: not from the assistant" },
  ])
  await f.idle(); expect(f.sent).toHaveLength(2)
  f.messages.set(f.root.id, [{ type: "assistant", content: [{ type: "text", text: "Review-Skip: verified by direct inspection" }] }])
  await f.idle()
  f.messages.clear(); f.edit("one.txt"); await f.idle()
  expect(f.sent).toHaveLength(2)
  f.edit("two.txt"); await f.idle(); expect(f.sent[2].metadata.crewReviewGate.rule).toEqual(["fileCount"])
})

test("missing baseline falls back to HEAD and labels the reminder", async () => {
  const f = fixture(); await f.start(); f.edit(); await f.idle()
  expect(f.sent[0]?.text).toContain("基线缺失，含既有改动")
})

test("native plan signal is from the first engineer user message, bounded to 8 KB", async () => {
  const f = fixture(); await f.start(); await f.prompt(); f.edit("a.ts"); f.edit("b.ts")
  f.child({ id: "ses_native", agent: "engineer", parentID: f.root.id, time: { created: 1 } })
  f.messages.set("ses_native", [{ type: "user", text: "x".repeat(8192) + " plans/not-read.md" }, { type: "user", text: "plans/also-ignored.md" }])
  await f.idle(); expect(f.sent).toHaveLength(0)
  f.messages.set("ses_native", [{ type: "user", text: "Implement plans/read.md" }])
  await f.idle(); expect(f.sent[0]?.metadata.crewReviewGate.rule).toEqual(["planMultiFile"])
})

test("collection exceptions fail open; the next idle can still remind", async () => {
  const f = fixture(); await f.start(); await f.prompt(); f.edit()
  const collect = spyOn(gitReview, "collectNativeChanges").mockImplementation(() => { throw new Error("collector failed") })
  try { await f.idle(); expect(collect).toHaveBeenCalledTimes(1); expect(f.sent).toHaveLength(0) }
  finally { collect.mockRestore() }
  await f.idle(); expect(f.sent).toHaveLength(1)
})

test("synthetic rejection fails open and does not consume the reminder budget", async () => {
  const f = fixture(); await f.start(); await f.prompt(); f.edit(); f.controls.rejectSynthetic = true
  await f.idle(); expect(f.sent).toHaveLength(0)
  f.controls.rejectSynthetic = false
  await f.idle(); expect(f.sent).toHaveLength(1)
})

test("host session lookup rejection is caught by prompt and idle", async () => {
  const f = fixture(); await f.start(); f.controls.rejectGet = true; f.edit()
  await f.prompt(); await f.idle(); expect(f.sent).toHaveLength(0)
  f.controls.rejectGet = false; await f.idle(); expect(f.sent[0]?.text).toContain("基线缺失")
})

test("idle hook registration failure does not break plugin setup", async () => {
  const f = fixture(); f.controls.rejectHook = "experimental.idle"; await plugin.setup(f.ctx)
  expect(f.registered).toContain("experimental.idle")
  expect(f.hooks.has("experimental.idle")).toBe(false)
  expect(f.tools).toHaveLength(4)
  const output = await f.diagnose()
  expect(output.hooks.idle).toBe(false)
  expect(output.notes.join(" ")).toContain("IDLE_HOOK_UNAVAILABLE")
})

test("busy task and forged session are not collected; bound idle task is collected with period and limits", async () => {
  const f = fixture(); const t = crewTask(f); t.ledger.migrate(`op_${"a".repeat(32)}`, "b".repeat(64))
  writeFileSync(join(t.directory, "outside.txt"), "changed")
  t.engineer.time.busy = 20; t.engineer.time.idle = 10
  await f.start(); await f.prompt()
  const review = spyOn(taskReview, "reviewTask")
  try {
    await f.idle(); expect(review).not.toHaveBeenCalled()
    t.engineer.time.idle = 20
    const binding = t.engineer.metadata!.crewTask
    t.engineer.metadata!.crewTask = { ...binding, requestDigest: "forged" }
    await f.idle(); expect(review).not.toHaveBeenCalled()
    t.engineer.metadata!.crewTask = binding
    await f.idle(); expect(review).toHaveBeenCalledWith({
      primaryDirectory: f.dir, directory: t.directory, taskID: t.taskID, baseline: f.head, scope: ["src/"], periodID: "pd_1", limits: { timeoutMs: 3000 },
    })
    expect(f.sent[0]?.text).toContain(t.taskID)
    expect(f.sent[0]?.metadata.crewReviewGate.rule).toEqual(["outsideScope"])
  } finally { review.mockRestore() }
})

test("closed task is not looked up or reviewed", async () => {
  const f = fixture(); const t = crewTask(f); t.ledger.migrate(`op_${"a".repeat(32)}`, "b".repeat(64))
  t.ledger.transaction(({ registry, write }) => {
    if (registry.schemaVersion !== 2) throw new Error("fixture migration failed")
    const item = registry.active.pop()!
    registry.closed.push({ ...item, closeout: {
      operationID: `op_${"c".repeat(32)}`, paramsDigest: "d".repeat(64), closedAt: new Date().toISOString(),
      operatorRef: "operator", authorizationRef: "authorization", disposition: "preserved",
      stopEvidenceRef: "stop", quiescenceEvidenceRef: "quiescence", reviewEvidenceRef: "review",
      evidenceDigest: "e".repeat(64), archiveRef: "archive", archiveDigest: "f".repeat(64),
    } })
    write(registry)
  })
  expect(t.ledger.entries()[0].lifecycle).toBe("closed")
  writeFileSync(join(t.directory, "outside.txt"), "changed")
  await f.start(); await f.prompt(); await f.idle()
  expect(f.getCalls).not.toContain(t.engineer.id)
  expect(f.sent).toHaveLength(0)
})

test("TaskRegistryError only fails open for that task", async () => {
  const f = fixture(); const t = crewTask(f); await f.start(); await f.prompt()
  const review = spyOn(taskReview, "reviewTask").mockImplementation(() => { throw new TaskRegistryError("PROJECT_MISMATCH") })
  try {
    await f.idle(); expect(review).toHaveBeenCalledTimes(1); expect(f.sent).toHaveLength(0)
    f.edit(); await f.idle(); expect(f.sent).toHaveLength(1); expect(f.sent[0].text).not.toContain(t.taskID)
  } finally { review.mockRestore() }
})

test("R1 task plan and reviewer coverage use latest file mtime, not first idle", async () => {
  const f = fixture({ mode: "enforce" }); const t = crewTask(f, "Implement plans/task.md")
  mkdirSync(join(t.directory, "src"))
  for (const [name, offset] of [["a.ts", 10], ["b.ts", 20]] as const) {
    const path = join(t.directory, "src", name)
    writeFileSync(path, name); utimesSync(path, offset, offset)
  }
  f.child(reviewer(f, 15_000)) // Covers the older changed file only.
  await f.start(); await f.prompt(); await f.idle()
  expect(f.sent[0]?.metadata.crewReviewGate.rule).toEqual(["planMultiFile"])
  f.child(reviewer(f, 20_000)); await f.idle() // Equal to latest mtime, earlier than first idle.
  expect(f.sent).toHaveLength(1)
  f.child(reviewer(f, 1)); await f.idle()
  expect(f.sent).toHaveLength(1)
})

for (const source of ["task", "native"] as const) {
  test(`R1 pure-delete ${source} uses the fingerprint's first observation time`, async () => {
    const f = fixture({ mode: "enforce" })
    const dir = source === "task" ? crewTask(f).directory : f.dir
    await f.start(); await f.prompt(); rmSync(join(dir, "original.test.ts"))
    f.child(reviewer(f, Date.now() - 1000)); await f.idle()
    expect(f.sent[0]?.metadata.crewReviewGate.rule).toContain("deletedTest")
    f.child(reviewer(f, Date.now())); await f.idle()
    expect(f.sent).toHaveLength(1)
  })
}

test("R1 native missing latestChangeAt still uses mtime for existing files", async () => {
  const f = fixture({ mode: "enforce" }); await f.start(); await f.prompt(); f.edit()
  utimesSync(join(f.dir, "AGENTS.md"), 10, 10)
  f.child(reviewer(f, 11_000))
  const collect = gitReview.collectNativeChanges
  const patched = spyOn(gitReview, "collectNativeChanges").mockImplementation((...args) => ({ ...collect(...args), latestChangeAt: undefined }))
  try { await f.idle(); expect(f.sent).toHaveLength(0) }
  finally { patched.mockRestore() }
})

test("R1b task reviewer before a new symlink does not cover the refused link", async () => {
  const f = fixture(); const t = crewTask(f); await f.start(); await f.prompt()
  const target = join(t.directory, "original.test.ts")
  utimesSync(target, 10, 10)
  f.child(reviewer(f, 20_000))
  symlinkSync("original.test.ts", join(t.directory, "new-link"))
  await f.idle()
  expect(f.sent).toHaveLength(1)
  expect(f.sent[0].metadata.crewReviewGate.rule).toContain("incomplete")
})

for (const source of ["task", "native"] as const) {
  test(`R1b ${source} with a vanished non-deletion cannot be covered by a partial mtime`, async () => {
    const f = fixture(); const t = source === "task" ? crewTask(f) : undefined
    await f.start(); await f.prompt()
    const dir = t?.directory ?? f.dir, known = join(dir, "AGENTS.md"), vanished = join(dir, "vanish.txt")
    for (const path of [known, vanished]) {
      writeFileSync(path, "new work"); utimesSync(path, 10, 10)
    }
    f.child(reviewer(f, 20_000))

    const review = taskReview.reviewTask, collect = gitReview.collectNativeChanges
    const patched = t
      ? spyOn(taskReview, "reviewTask").mockImplementation(request => {
        const listing = review(request); rmSync(vanished); return listing
      })
      : spyOn(gitReview, "collectNativeChanges").mockImplementation((...args) => {
        const change = collect(...args); rmSync(vanished); return change
      })
    try {
      await f.idle()
      expect(patched).toHaveBeenCalledTimes(1)
      expect(f.sent).toHaveLength(1)
      expect(f.sent[0].metadata.crewReviewGate.rule).toContain("sensitivePath")
    } finally { patched.mockRestore() }
  })
}

test("R2 Review-Skip acknowledges only the displayed fingerprint, not the next one", async () => {
  const f = fixture({ mode: "enforce" }); const t = crewTask(f); await f.start(); await f.prompt()
  f.edit(); writeFileSync(join(t.directory, "outside.txt"), "changed")
  const listing = taskReview.reviewTask({ primaryDirectory: f.dir, directory: t.directory, taskID: t.taskID, baseline: f.head, scope: ["src/"] })
  const taskFingerprint = gateFingerprint(fromReviewListing(t.directory, listing))
  await f.idle()
  expect(f.sent).toHaveLength(1)
  expect(f.sent[0].metadata.crewReviewGate.fingerprint).not.toBe(taskFingerprint)

  f.messages.set(f.root.id, [{ type: "assistant", text: "Review-Skip: reviewed the native change directly" }])
  await f.idle()
  expect(f.sent.map(item => item.metadata.crewReviewGate.fingerprint)).toEqual([
    f.sent[0].metadata.crewReviewGate.fingerprint, taskFingerprint,
  ])
  await f.idle() // The same assistant message must not acknowledge the newly displayed task.
  expect(f.sent).toHaveLength(3)
  expect(f.sent[2].metadata.crewReviewGate.fingerprint).toBe(taskFingerprint)
})

test("R2 unsolicited Review-Skip does not acknowledge an unseen hit", async () => {
  const f = fixture(); await f.start(); await f.prompt(); f.edit()
  f.messages.set(f.root.id, [{ type: "assistant", text: "Review-Skip: no reminder was shown yet" }])
  await f.idle()
  expect(f.sent).toHaveLength(1)
})

test("R2b a skip during a cursor cycle confirms only the already displayed hit", async () => {
  const f = fixture({ mode: "enforce" }); const t = crewTask(f); await f.start(); await f.prompt()
  f.edit(); writeFileSync(join(t.directory, "outside.txt"), "changed")
  const listing = taskReview.reviewTask({ primaryDirectory: f.dir, directory: t.directory, taskID: t.taskID, baseline: f.head, scope: ["src/"] })
  const taskFingerprint = gateFingerprint(fromReviewListing(t.directory, listing))
  await f.idle(); expect(f.sent).toHaveLength(1)
  const nativeFingerprint = f.sent[0].metadata.crewReviewGate.fingerprint
  expect(nativeFingerprint).not.toBe(taskFingerprint)

  f.messages.set(f.root.id, [{ type: "assistant", text: "Review-Skip: verified only the displayed native change" }])
  f.controls.childPage = () => ({ data: [], cursor: { next: "same" } })
  await f.idle()
  expect(f.listCalls.slice(-2).map(call => call.cursor)).toEqual([undefined, "same"])
  expect(f.sent).toHaveLength(1)

  f.messages.clear() // The skip must already have been consumed while pagination was incomplete.
  f.controls.childPage = undefined
  await f.idle()
  expect(f.sent.map(item => item.metadata.crewReviewGate.fingerprint)).toEqual([nativeFingerprint, taskFingerprint])
})

test("R3 reviewer on the second page prevents a reminder", async () => {
  const f = fixture(); await f.start(); await f.prompt(); f.edit()
  f.controls.childPage = cursor => cursor === "second"
    ? { data: [reviewer(f, Math.ceil(lstatSync(join(f.dir, "AGENTS.md")).mtimeMs))], cursor: {} }
    : { data: [], cursor: { next: "second" } }
  await f.idle(); expect(f.sent).toHaveLength(0)
  expect(f.listCalls.map(call => call.cursor)).toEqual([undefined, "second"])
})

test("R3 only engineer on page two supplies the native plan rule", async () => {
  const f = fixture(); await f.start(); await f.prompt(); f.edit("a.ts"); f.edit("b.ts")
  const engineer = { id: "ses_plan", agent: "engineer", parentID: f.root.id, time: { created: 1 } }
  f.controls.childPage = cursor => cursor === "second"
    ? { data: [engineer], cursor: {} } : { data: [], cursor: { next: "second" } }
  f.messages.set(engineer.id, [{ type: "user", text: "Implement plans/page-two.md" }])
  await f.idle(); expect(f.sent[0]?.metadata.crewReviewGate.rule).toEqual(["planMultiFile"])
  expect(f.listCalls.map(call => call.cursor)).toEqual([undefined, "second"])
})

for (const kind of ["page limit", "cyclic cursor"] as const) {
  test(`R3 ${kind} suppresses reminders for that idle without permanently acknowledging`, async () => {
    const f = fixture(); await f.start(); await f.prompt(); f.edit()
    f.controls.childPage = cursor => ({ data: [], cursor: { next: kind === "cyclic cursor" ? "same" : String(Number(cursor ?? 0) + 1) } })
    await f.idle(); expect(f.sent).toHaveLength(0)
    expect(f.listCalls).toHaveLength(kind === "page limit" ? 20 : 2)
    f.controls.childPage = undefined
    await f.idle(); expect(f.sent).toHaveLength(1)
  })
}

test("S5 off setup does not register crew_review_gate", async () => {
  const f = fixture({ mode: "off" }); await plugin.setup(f.ctx)
  expect(f.tools.map(tool => tool.name)).not.toContain("crew_review_gate")
})

test("S5 Root gets native and task verdicts, fingerprint, coverage, state and config", async () => {
  const f = fixture(); const t = crewTask(f); await f.start(); await f.prompt()
  f.edit(); writeFileSync(join(t.directory, "outside.txt"), "changed")
  const mtime = lstatSync(join(f.dir, "AGENTS.md")).mtimeMs
  const newer = reviewer(f, Date.now() + 1000)
  f.controls.childPage = cursor => cursor === "two"
    ? { data: [newer], cursor: {} } : { data: [{ ...reviewer(f, newer.time.created + 1, "failed"), id: "ses_failed" }], cursor: { next: "two" } }

  const output = await f.diagnose()
  expect(output).toMatchObject({
    mode: "remind", config: { maxFiles: 5, planMinFiles: 2, maxReminders: 2, testGlobs: f.cfg.testGlobs, sensitiveGlobs: f.cfg.sensitiveGlobs, ignoreGlobs: f.cfg.ignoreGlobs },
    sessionID: f.root.id, baseline: { present: true },
    native: { status: "available", head: f.head, complete: true, files: [{ path: "AGENTS.md", type: "added" }],
      verdict: { hit: true, reasons: [expect.objectContaining({ rule: "sensitivePath" })] }, latestChangeAt: mtime,
      fingerprint: expect.stringMatching(/^[0-9a-f]{16}$/), reviewerCovered: true },
    tasks: [{ taskID: t.taskID, status: "available", files: [{ path: "outside.txt", type: "added" }],
      outsideScope: 1, complete: true, verdict: { hit: true, reasons: [expect.objectContaining({ rule: "outsideScope" })] }, reviewerCovered: true }],
    reviewers: { count: 1, latestCreatedAt: newer.time.created, complete: true }, state: { reminders: 0, acked: 0 }, notes: [],
  })
  rmSync(join(f.dir, "AGENTS.md"))
  expect((await f.diagnose()).native.verdict).toEqual({ hit: false, reasons: [] })
})

test("S5 non-Root short-circuits and host failure has a distinct error code", async () => {
  const f = fixture(); await f.start()
  expect((await f.diagnose("build")).error.code).toBe("FORBIDDEN_CALLER")
  expect(f.getCalls).toEqual([])
  f.root.parentID = "ses_parent"
  expect((await f.diagnose()).error.code).toBe("FORBIDDEN_CALLER")
  delete f.root.parentID
  f.controls.rejectGet = true
  expect((await f.diagnose()).error.code).toBe("HOST_ERROR")
})

test("S5 consecutive calls never consume a pending skip, mtime-based coverage, or the baseline", async () => {
  const f = fixture({ mode: "enforce" }); await f.start(); await f.prompt(); f.edit(); await f.idle()
  f.messages.set(f.root.id, [{ type: "assistant", text: "Review-Skip: verified this change elsewhere" }])
  f.child(reviewer(f, Date.now() + 1000))
  const first = await f.diagnose(), second = await f.diagnose()
  expect(first).toEqual(second)
  expect(first.baseline).toEqual({ present: true })
  expect(first.native.files).toEqual([{ path: "AGENTS.md", type: "added" }])
  expect(first.native.reviewerCovered).toBe(true)
  expect(first.state).toMatchObject({ reminders: 1, acked: 0, pending: expect.any(String), lastFingerprint: expect.any(String) })
  expect(f.sent).toHaveLength(1)
  expect(f.listCalls).toHaveLength(3)
  await f.idle() // Only idle is allowed to consume the actual skip and advance the baseline.
  const final = await f.diagnose()
  expect(final.native.files).toEqual([])
  expect(final.state).toMatchObject({ reminders: 1, acked: 1 })
  expect(final.state.pending).toBeUndefined()
  expect(f.sent).toHaveLength(1)
})

test("S5 a pure deletion does not get a first-observed timestamp until idle", async () => {
  const f = fixture(); await f.start(); await f.prompt(); rmSync(join(f.dir, "original.test.ts"))
  const first = await f.diagnose()
  expect(first.native.verdict.hit).toBe(true)
  expect(first.native.latestChangeAt).toBeUndefined()
  expect(await f.diagnose()).toEqual(first)
  await f.idle()
  expect((await f.diagnose()).native.latestChangeAt).toEqual(expect.any(Number))
})

test("S5 unobservable native collection and truncated reviewer list still produce diagnostic output", async () => {
  const f = fixture(); f.ctx.location.directory = join(f.parent, "missing-cwd"); await f.start()
  f.controls.childPage = () => ({ data: [], cursor: { next: "same" } })
  const output = await f.diagnose()
  expect(output.native).toMatchObject({ status: "unavailable", files: [], verdict: { hit: false, reasons: [] } })
  expect(output.baseline).toEqual({ present: false })
  expect(output.reviewers).toMatchObject({ count: 0, complete: false })
  expect(output.tasks).toEqual([])
  expect(output.notes.length).toBeGreaterThanOrEqual(3)
})

test("S5 task collection failure is returned per task and leaves native diagnosis intact", async () => {
  const f = fixture(); const t = crewTask(f); await f.start(); await f.prompt(); f.edit()
  rmSync(t.directory, { recursive: true })
  const output = await f.diagnose()
  expect(output.native.verdict.hit).toBe(true)
  expect(output.tasks).toEqual([expect.objectContaining({ taskID: t.taskID, status: "unavailable", error: { code: "PROJECT_MISMATCH" }, files: [] })])
})

test("S5 diagnostic output contains only JSON values", async () => {
  // The host rejects `undefined` in a tool output ("Expected JSON value"), and a fresh
  // session has no pending reminder, no last fingerprint and no observed mtime.
  const f = fixture(); await f.start(); await f.prompt(); f.edit()
  const output = await f.diagnose()
  const missing: string[] = []
  const walk = (value: unknown, path: string) => {
    if (value === undefined) missing.push(path)
    else if (Array.isArray(value)) value.forEach((item, index) => walk(item, `${path}[${index}]`))
    else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) walk(item, `${path}.${key}`)
  }
  walk(output, "output")
  expect(missing).toEqual([])
})
