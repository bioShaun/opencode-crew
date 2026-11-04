// @bun
// src/tui/index.tsx
import { Plugin } from "@opencode/plugin/tui";

// src/tui/sidebar.tsx
import { createEffect, createMemo, createSignal as createSignal2, For as For5, on, onCleanup, Show as Show2 } from "solid-js";
import { usePlugin as usePlugin2 } from "@opencode/plugin/tui";

// src/snapshot.ts
var taskSchema = {
  type: "object",
  properties: {
    taskID: { type: "string" },
    sessionID: { type: "string" },
    directory: { type: "string" },
    scopes: { type: "integer" },
    state: { type: "string" },
    lifecycle: { type: "string", enum: ["active", "closed"] },
    check: { type: "string" },
    observed: {
      type: "object",
      properties: {
        outcome: { type: "string", enum: ["succeeded", "failed", "interrupted"] },
        busyAt: { type: "string" },
        idleAt: { type: "string" },
        errorCode: { type: "string" }
      },
      additionalProperties: false
    },
    report: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["progress", "waiting", "ready", "blocked", "failed", "dropped"] },
        reason: { type: "string" }
      },
      required: ["status"],
      additionalProperties: false
    },
    steps: { type: "integer" },
    tokens: { type: "number" },
    cacheRead: { type: "number" },
    cost: { type: "number" },
    permissions: {
      type: "array",
      items: {
        type: "object",
        properties: { action: { type: "string" }, resources: { type: "array", items: { type: "string" } } },
        required: ["action", "resources"],
        additionalProperties: false
      }
    }
  },
  required: ["taskID", "directory", "scopes", "state", "lifecycle", "check", "steps"],
  additionalProperties: false
};
var crewTasks = {
  id: "opencode-crew",
  methods: {
    tasks: {
      input: {
        type: "object",
        properties: { sessionID: { type: "string" } },
        required: ["sessionID"],
        additionalProperties: false
      },
      output: {
        type: "object",
        properties: { tasks: { type: "array", items: taskSchema } },
        required: ["tasks"],
        additionalProperties: false
      }
    }
  },
  events: {}
};
var object = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
var str = (x) => typeof x === "string";
var num = (x) => typeof x === "number" && Number.isFinite(x);
var REPORT = ["progress", "waiting", "ready", "blocked", "failed", "dropped"];
function task(value) {
  if (!object(value) || !str(value.taskID) || !str(value.directory) || !str(value.state) || value.lifecycle !== "active" && value.lifecycle !== "closed" || !str(value.check))
    return;
  const view = {
    taskID: value.taskID,
    directory: value.directory,
    scopes: num(value.scopes) ? Math.max(0, Math.floor(value.scopes)) : 0,
    state: value.state,
    lifecycle: value.lifecycle,
    check: value.check,
    steps: num(value.steps) ? Math.max(0, Math.floor(value.steps)) : 0
  };
  if (str(value.sessionID))
    view.sessionID = value.sessionID;
  if (object(value.observed)) {
    const o = value.observed;
    const observed = {};
    if (o.outcome === "succeeded" || o.outcome === "failed" || o.outcome === "interrupted")
      observed.outcome = o.outcome;
    if (str(o.busyAt))
      observed.busyAt = o.busyAt;
    if (str(o.idleAt))
      observed.idleAt = o.idleAt;
    if (str(o.errorCode))
      observed.errorCode = o.errorCode;
    if (Object.keys(observed).length)
      view.observed = observed;
  }
  if (object(value.report) && str(value.report.status) && REPORT.includes(value.report.status)) {
    view.report = {
      status: value.report.status,
      ...str(value.report.reason) ? { reason: value.report.reason } : {}
    };
  }
  if (num(value.tokens))
    view.tokens = value.tokens;
  if (num(value.cacheRead))
    view.cacheRead = value.cacheRead;
  if (num(value.cost))
    view.cost = value.cost;
  if (Array.isArray(value.permissions)) {
    const permissions = value.permissions.flatMap((p) => object(p) && str(p.action) && Array.isArray(p.resources) && p.resources.every(str) ? [{ action: p.action, resources: [...p.resources] }] : []);
    if (permissions.length)
      view.permissions = permissions;
  }
  return view;
}
function parseTasksOutput(value) {
  if (!object(value) || !Array.isArray(value.tasks))
    return [];
  return value.tasks.flatMap((item) => {
    const parsed = task(item);
    return parsed ? [parsed] : [];
  });
}

// src/tui/view-model.ts
var WIDTH = 37;
var WARN_STEP_RATIO = 0.8;
var STALL_MS = 5 * 60000;
var STALL_HARD_MS = 15 * 60000;
var ROLE_ORDER = ["architect", "engineer", "explorer", "reviewer"];
var ALERT_RANK = {
  failed: 0,
  blocked: 1,
  permission: 2,
  waiting: 3
};
var REPORT_TONE = {
  progress: "info",
  waiting: "warning",
  ready: "warning",
  blocked: "error",
  failed: "error"
};
var graphemes = (s) => Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(s), (x) => x.segment);
var cells = (s) => graphemes(s).reduce((w, g) => w + (/[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/u.test(g) ? 2 : 1), 0);
var take = (s, max) => {
  const out = [];
  let w = 0;
  for (const g of graphemes(s)) {
    const n = cells(g);
    if (w + n > max)
      break;
    out.push(g);
    w += n;
  }
  return out.join("");
};
var truncateCells = (s, max) => cells(s) <= max ? s : take(s, Math.max(0, max - 1)) + "\u2026";
var padEndCells = (s, max) => s + " ".repeat(Math.max(0, max - cells(s)));
var padStartCells = (s, max) => " ".repeat(Math.max(0, max - cells(s))) + s;
var canonicalToolName = (name) => name === "bash" ? "shell" : name === "task" ? "subagent" : name === "apply_patch" ? "patch" : name;
function busyLabel(part) {
  if (part.type === "reasoning")
    return "Thinking\u2026";
  const name = canonicalToolName(part.name ?? "");
  const noun = name === "shell" ? "command" : name === "execute" ? "code" : name;
  return `${part.state?.status === "streaming" ? "Preparing" : "Running"} ${noun}\u2026`;
}
var isActive = (part, messageCompleted) => {
  if (part.type === "reasoning")
    return !messageCompleted && part.time?.completed === undefined;
  return part.type === "tool" && (part.state?.status === "streaming" || part.state?.status === "running");
};
function sessionActivity(messages) {
  const last = [...messages].reverse().find((m) => m.type === "assistant");
  const part = last ? [...last.content ?? []].reverse().find((p) => isActive(p, last.time?.completed !== undefined)) : undefined;
  return part ? busyLabel(part) : "Thinking\u2026";
}
var countSteps = (messages) => messages.filter((m) => m.type === "assistant").length;
var messageStamp = (m) => Math.max(m.time?.created ?? 0, m.time?.streamed ?? 0, m.time?.completed ?? 0, ...(m.content ?? []).flatMap((p) => [p.time?.created ?? 0, p.time?.completed ?? 0]));
var lastActivityOf = (messages) => messages.reduce((max, m) => Math.max(max, messageStamp(m)), 0);
function sessionRunning(s, status) {
  if (s.busy !== undefined)
    return s.busy > (s.idle ?? 0);
  if (s.idle !== undefined)
    return false;
  return status(s.id) === "running";
}
var tokenTotal = (t) => t ? (t.input ?? 0) + (t.output ?? 0) + (t.reasoning ?? 0) + (t.cache?.write ?? 0) : 0;
var compactTokens = (n) => n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M" : n >= 1000 ? Math.round(n / 1000) + "k" : String(Math.round(n));
var tightTokens = (n) => n >= 1e9 ? (n / 1e9).toFixed(1).replace(/\.0$/, "") + "B" : n >= 1e6 ? Math.round(n / 1e6) + "M" : n >= 1000 ? Math.round(n / 1000) + "k" : String(Math.round(n));
var TOKENS_WIDTH = 10;
function tokenCell(work, cacheRead) {
  const exact = compactTokens(work);
  if (!cacheRead)
    return exact;
  const options = [
    `${exact}+${compactTokens(cacheRead)}`,
    `${exact}+${tightTokens(cacheRead)}`,
    `${tightTokens(work)}+${tightTokens(cacheRead)}`
  ];
  return options.find((text) => cells(text) <= TOKENS_WIDTH) ?? options[options.length - 1];
}
var usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
var money = (n) => usd.format(n);
var overBudget = (steps, limit) => limit > 0 && steps >= limit * WARN_STEP_RATIO;
function subagentAnomalies(list) {
  const second = (key, role) => Math.max(0, ...list.filter((x) => x.role !== role).map((x) => x[key]));
  return new Set(list.filter((x) => x.fullSteps > 0 || x.sessions >= 5 && x.sessions >= 2 * second("sessions", x.role) || x.tokens >= 500000 && x.tokens >= 2 * second("tokens", x.role) || x.cost >= 1 && x.cost >= 2 * second("cost", x.role)).map((x) => x.role));
}
function freshnessSpans(input) {
  if (!input.known || !input.calibratedAt)
    return [span("\u672A\u6821\u51C6", "faint")];
  const age = Math.max(0, input.now - input.calibratedAt);
  const interval = input.calibrationIntervalMs ?? 15000;
  const stale = age > interval * 1.5;
  const label = age < 1500 ? "\u521A\u521A" : age < 60000 ? `${Math.max(1, Math.round(age / 1000))}s \u524D` : `${Math.max(1, Math.floor(age / 60000))}m \u524D`;
  const text = stale ? `\u53EF\u80FD\u6EDE\u540E \xB7 \u6821\u51C6 ${label}` : `\u6821\u51C6 ${label}`;
  return [span(truncateCells(text, WIDTH), stale ? "warning" : "faint")];
}
var span = (text, tone, bold) => ({ text, tone, ...bold ? { bold } : {} });
var title = (name, mutedTail) => [span(name, "base", true), span(` ${mutedTail}`, "muted")];
function alertRow(task, kind, text) {
  const tone = kind === "failed" || kind === "blocked" ? "error" : "warning";
  const label = kind === "permission" ? "\u6743\u9650" : kind;
  const detail = truncateCells(text, Math.max(1, WIDTH - 16 - cells(label) - 1));
  return {
    kind,
    sessionID: task.sessionID,
    spans: [
      span("!", tone),
      span(` ${padEndCells(truncateCells(task.taskID, 13), 13)} `, "base"),
      span(label, tone),
      span(` ${detail}`, "muted")
    ]
  };
}
var relative = (resource, directory) => resource === undefined ? "" : resource.startsWith(directory + "/") ? resource.slice(directory.length + 1) : resource;
var effectiveReport = (t) => t.report?.status && t.report.status !== "dropped" ? t.report.status : t.observed?.outcome === "failed" || t.observed?.outcome === "interrupted" ? "failed" : "progress";
function delegationRow(s, depth, input) {
  const limit = input.limit(s.agent);
  const messages = input.messages(s.id);
  const steps = countSteps(messages);
  const seen = Math.max(s.updated, lastActivityOf(messages), input.lastActivity?.(s.id) ?? 0);
  const idleFor = input.now - seen;
  const softStall = idleFor >= STALL_MS;
  const hardStall = idleFor >= STALL_HARD_MS;
  const budget = overBudget(steps, limit);
  const warn = hardStall || budget;
  const activity = softStall ? `\u65E0\u8F93\u51FA ${Math.max(1, Math.floor(idleFor / 60000))}m` : sessionActivity(messages);
  const role = "  ".repeat(Math.min(depth, 4)) + (s.agent ?? "?");
  const roleTone = warn ? "warning" : "base";
  const activityTone = warn ? "warning" : "info";
  const stepTone = warn ? "warning" : "faint";
  const step = `~${steps}/${limit || "\u2014"}`;
  const stepWidth = Math.min(12, Math.max(6, cells(step)));
  const activityWidth = WIDTH - 10 - 1 - 1 - stepWidth;
  return [
    span(padEndCells(truncateCells(role, 10), 10), roleTone),
    span(" ", roleTone),
    span(padEndCells(truncateCells(activity, activityWidth), activityWidth), activityTone),
    span(" ", roleTone),
    span(padStartCells(truncateCells(step, stepWidth), stepWidth), stepTone)
  ];
}
function taskRows(t, limit) {
  const report = effectiveReport(t);
  const warn = overBudget(t.steps, limit);
  const step = `~${t.steps}/${limit}`;
  const stepWidth = Math.min(12, Math.max(6, cells(step)));
  const idWidth = WIDTH - 1 - cells(report) - 1 - stepWidth;
  const head = [
    span(padEndCells(truncateCells(t.taskID, idWidth), idWidth), warn ? "warning" : "base"),
    span(" ", "base"),
    span(report, REPORT_TONE[report]),
    span(" ", "base"),
    span(padStartCells(truncateCells(step, stepWidth), stepWidth), warn ? "warning" : "faint")
  ];
  const detail = report === "ready" ? { key: "next", value: "Root \u9A8C\u6536\u8BC1\u636E" } : report === "blocked" || report === "failed" ? { key: "next", value: t.report?.reason || (report === "failed" ? "\u67E5\u770B\u5931\u8D25\u65E5\u5FD7" : "\u4EBA\u5DE5\u4ECB\u5165") } : { key: "check", value: t.check };
  const tail = [
    span(detail.key, "faint"),
    span(` ${truncateCells(detail.value, WIDTH - cells(detail.key) - 1)}`, "muted")
  ];
  return [head, tail];
}
function buildSidebar(input) {
  const family = input.sessions.filter((s) => s.id !== input.rootID);
  const byID = new Map(family.map((s) => [s.id, s]));
  const childrenOf = new Map;
  for (const s of family) {
    const parent = s.parentID && byID.has(s.parentID) ? s.parentID : input.rootID;
    childrenOf.set(parent, [...childrenOf.get(parent) ?? [], s]);
  }
  const visibleTasks = input.tasks.filter((t) => t.report?.status !== "dropped");
  const alerts = [];
  for (const t of visibleTasks) {
    for (const p of t.permissions ?? []) {
      alerts.push(alertRow(t, "permission", `${p.action} ${relative(p.resources[0], t.directory)}`.trim()));
    }
    if (t.report?.status === "waiting")
      alerts.push(alertRow(t, "waiting", t.report.reason ?? "\u7B49\u5F85\u5916\u90E8\u8F93\u5165"));
    if (t.report?.status === "blocked")
      alerts.push(alertRow(t, "blocked", t.report.reason ?? ""));
    if (t.report?.status === "failed")
      alerts.push(alertRow(t, "failed", t.report.reason ?? ""));
  }
  alerts.sort((a, b) => {
    const ra = ALERT_RANK[a.kind ?? "waiting"];
    const rb = ALERT_RANK[b.kind ?? "waiting"];
    if (ra !== rb)
      return ra - rb;
    const ida = a.spans[1]?.text ?? "";
    const idb = b.spans[1]?.text ?? "";
    return ida.localeCompare(idb);
  });
  const rows = [];
  let runningCount = 0;
  const isRunning = input.running ?? ((s) => sessionRunning(s, input.status));
  const visit = (parent, depth) => {
    for (const s of (childrenOf.get(parent) ?? []).slice().sort((a, b) => a.created - b.created)) {
      if (isRunning(s)) {
        runningCount++;
        rows.push(delegationRow(s, depth, input));
      }
      visit(s.id, depth + 1);
    }
  };
  visit(input.rootID, 0);
  for (const t of visibleTasks) {
    const report = effectiveReport(t);
    if (report === "progress" || report === "waiting")
      runningCount++;
    rows.push(...taskRows(t, input.limit("engineer")));
  }
  const delegations = rows.length ? { title: title("Delegations", `(${runningCount} running)`), rows, runningCount } : undefined;
  const stats = new Map;
  const put = (role) => {
    const hit = stats.get(role);
    if (hit)
      return hit;
    const created = { role, sessions: 0, tokens: 0, cacheRead: 0, cost: 0, fullSteps: 0 };
    stats.set(role, created);
    return created;
  };
  for (const s of family) {
    const role = s.agent ?? "unknown";
    const stat = put(role);
    stat.sessions++;
    stat.tokens += tokenTotal(s.tokens);
    stat.cacheRead = (stat.cacheRead ?? 0) + (s.tokens?.cache?.read ?? 0);
    stat.cost += input.cost(s.id);
    if (countSteps(input.messages(s.id)) >= input.limit(role))
      stat.fullSteps++;
  }
  for (const t of input.tasks) {
    const stat = put("engineer");
    stat.tokens += t.tokens ?? 0;
    stat.cacheRead = (stat.cacheRead ?? 0) + (t.cacheRead ?? 0);
    stat.cost += t.cost ?? 0;
    if (t.steps >= input.limit("engineer"))
      stat.fullSteps++;
  }
  const roleRank = (role) => ROLE_ORDER.indexOf(role) === -1 ? ROLE_ORDER.length : ROLE_ORDER.indexOf(role);
  const used = [...stats.values()].filter((x) => x.sessions > 0 || x.tokens > 0 || x.cost > 0).sort((a, b) => roleRank(a.role) - roleRank(b.role) || a.role.localeCompare(b.role));
  const subagents = used.length ? (() => {
    const warn = subagentAnomalies(used);
    const total = used.reduce((n, x) => n + x.sessions, 0);
    const cost = used.reduce((n, x) => n + x.cost, 0);
    const head = [span(" ".repeat(10) + padStartCells("sess", 6) + " " + padStartCells("tok+cache", 10) + padStartCells("cost", 10), "faint")];
    const body = used.map((x) => {
      const w = warn.has(x.role);
      const tone = w ? "warning" : "muted";
      const tokens = tokenCell(x.tokens, x.cacheRead ?? 0);
      return [
        span(padEndCells(truncateCells(x.role, 10), 10), w ? "warning" : "base"),
        span(padStartCells(String(x.sessions), 6) + " " + padStartCells(tokens, 10) + padStartCells(money(x.cost), 10), tone)
      ];
    });
    const footnote = [
      span(truncateCells("tok \u542B cache.read \xB7 \u89C1 sidebar-ui", WIDTH), "faint")
    ];
    return {
      title: title("Subagents", `(${total} session${total === 1 ? "" : "s"} \xB7 ${money(cost)})`),
      header: head,
      rows: body,
      footnote
    };
  })() : undefined;
  const freshness = freshnessSpans({
    now: input.now,
    known: input.known,
    calibratedAt: input.calibratedAt,
    calibrationIntervalMs: input.calibrationIntervalMs
  });
  return { alerts, freshness, delegations, subagents };
}

// src/tui/live.ts
var ACTIVE_CALIBRATION_MS = 15000;
var IDLE_CALIBRATION_MS = 60000;
var FLUSH_MS = 250;
var LIVE_MESSAGES = 100;
var MAX_CONCURRENT_PULLS = 3;
var MAX_DEPTH = 8;
var TERMINAL = new Set([
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted"
]);
var MESSAGE_EVENTS = new Set([
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
  "session.tool.failed"
]);
var realClock = {
  now: () => Date.now(),
  schedule: (fn, ms) => setTimeout(fn, ms),
  cancel: (handle) => clearTimeout(handle)
};
var totalTokens = (s) => {
  const t = s?.tokens;
  return t ? (t.input ?? 0) + (t.output ?? 0) + (t.reasoning ?? 0) + (t.cache?.write ?? 0) : 0;
};
var tokensOf = (a, b) => totalTokens({ id: "", created: 0, updated: 0, tokens: b }) > totalTokens({ id: "", created: 0, updated: 0, tokens: a }) ? b : a;
function mergeMessages(base, incoming) {
  const byID = new Map;
  const rest = [];
  for (const m of [...base, ...incoming]) {
    if (!m.id) {
      rest.push(m);
      continue;
    }
    const held = byID.get(m.id);
    if (!held || messageStamp(m) >= messageStamp(held))
      byID.set(m.id, m);
  }
  const merged = [...byID.values(), ...rest];
  return merged.sort((a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0) || (a.id ?? "").localeCompare(b.id ?? ""));
}
function mergeSession(local, remote) {
  if (!local)
    return remote;
  return {
    id: local.id,
    parentID: remote.parentID ?? local.parentID,
    agent: remote.agent ?? local.agent,
    created: local.created || remote.created,
    updated: Math.max(local.updated, remote.updated),
    busy: remote.busy === undefined ? local.busy : Math.max(local.busy ?? 0, remote.busy),
    idle: remote.idle === undefined ? local.idle : Math.max(local.idle ?? 0, remote.idle),
    tokens: tokensOf(local.tokens, remote.tokens),
    cost: Math.max(local.cost ?? 0, remote.cost ?? 0)
  };
}

class LiveController {
  options;
  clock;
  flushMs;
  activeMs;
  idleMs;
  concurrency;
  rootID;
  generation = 0;
  disposed = false;
  views = new Map;
  running = new Set;
  dirty = new Set;
  finalPending = new Set;
  member = new Map;
  resolving = new Map;
  awaiting = new Map;
  missed = new Map;
  pulls = new Map;
  lastPullAt = new Map;
  activeKnown = false;
  lastCalibratedAt = 0;
  flushTimer;
  calibrationTimer;
  calibrationDue = 0;
  draining = false;
  trailing = false;
  constructor(options) {
    this.options = options;
    this.clock = options.clock ?? realClock;
    this.flushMs = options.flushMs ?? FLUSH_MS;
    this.activeMs = options.activeMs ?? ACTIVE_CALIBRATION_MS;
    this.idleMs = options.idleMs ?? IDLE_CALIBRATION_MS;
    this.concurrency = options.concurrency ?? MAX_CONCURRENT_PULLS;
    this.rootID = options.rootID;
  }
  setRoot(rootID) {
    this.generation++;
    this.clearTimers();
    this.views.clear();
    this.running.clear();
    this.dirty.clear();
    this.finalPending.clear();
    this.member.clear();
    this.awaiting.clear();
    this.missed.clear();
    this.resolving.clear();
    this.pulls.clear();
    this.lastPullAt.clear();
    this.activeKnown = false;
    this.lastCalibratedAt = 0;
    this.trailing = false;
    this.rootID = rootID;
    this.emit();
    this.refreshNow();
  }
  dispose() {
    this.disposed = true;
    this.generation++;
    this.clearTimers();
    this.views.clear();
    this.running.clear();
    this.dirty.clear();
    this.finalPending.clear();
    this.awaiting.clear();
    this.missed.clear();
    this.resolving.clear();
    this.pulls.clear();
    this.lastPullAt.clear();
  }
  refreshNow() {
    if (this.disposed)
      return;
    this.tick();
  }
  ingest(event) {
    if (this.disposed)
      return;
    if (event.type === "server.connected") {
      this.refreshNow();
      return;
    }
    const id = event.data?.sessionID;
    if (!id)
      return;
    if (id === this.rootID) {
      if (event.type === "session.execution.started")
        this.start(id);
      else if (TERMINAL.has(event.type))
        this.end(id);
      return;
    }
    if (id === this.rootID || this.options.family().includes(id))
      this.member.set(id, true);
    const known = this.member.get(id);
    if (known === false)
      return;
    if (known === true) {
      this.handle(id, event);
      return;
    }
    if (MESSAGE_EVENTS.has(event.type)) {
      if (event.data?.assistantMessageID)
        this.pending(id).add(event.data.assistantMessageID);
    } else {
      this.missedEvents(id).add(event.type);
    }
    if (!this.resolving.has(id))
      this.resolve(id);
  }
  pending(id) {
    const held = this.awaiting.get(id);
    if (held)
      return held;
    const created = new Set;
    this.awaiting.set(id, created);
    return created;
  }
  missedEvents(id) {
    const held = this.missed.get(id);
    if (held)
      return held;
    const created = new Set;
    this.missed.set(id, created);
    return created;
  }
  async resolve(id) {
    const pending = this.resolving.get(id);
    if (pending)
      return pending;
    const check = (async () => {
      const belongs = await this.belongs(id);
      if (this.disposed)
        return false;
      this.resolving.delete(id);
      if (!belongs) {
        this.member.set(id, false);
        this.awaiting.delete(id);
        this.missed.delete(id);
        return false;
      }
      this.member.set(id, true);
      for (const type of this.missed.get(id) ?? [])
        this.handle(id, { type });
      this.missed.delete(id);
      for (const messageID of this.awaiting.get(id) ?? [])
        this.touchMessage(id, messageID, this.clock.now());
      return true;
    })();
    this.resolving.set(id, check);
    return check;
  }
  async belongs(id) {
    if (id === this.rootID)
      return true;
    const host = this.options.family();
    if (host.includes(id))
      return true;
    let current = id;
    for (let depth = 0;depth < MAX_DEPTH; depth++) {
      if (current === this.rootID)
        return true;
      const known = this.options.store.session(current);
      const info = known ?? await this.options.fetch.session(current);
      if (this.disposed)
        return false;
      if (!info)
        return false;
      if (host.includes(info.id))
        return true;
      if (!info.parentID)
        return false;
      current = info.parentID;
    }
    return false;
  }
  handle(id, event) {
    if (event.type === "session.deleted") {
      this.forget(id);
      return;
    }
    if (event.type === "session.created") {
      this.ensure(id);
      this.dirty.add(id);
      this.flushSoon();
      return;
    }
    if (event.type === "session.execution.started") {
      this.start(id);
      return;
    }
    if (TERMINAL.has(event.type)) {
      this.end(id);
      return;
    }
    if (event.type === "session.usage.updated") {
      const view = this.ensure(id);
      if (view) {
        view.session = mergeSession(view.session, {
          ...view.session,
          tokens: event.data?.tokens ?? view.session.tokens,
          cost: Math.max(view.session.cost ?? 0, event.data?.cost ?? 0)
        });
      }
      this.flushSoon();
      return;
    }
    if (event.type === "session.agent.selected") {
      const view = this.ensure(id);
      if (view && event.data?.agent)
        view.session = { ...view.session, agent: event.data.agent };
      this.flushSoon();
      return;
    }
    if (MESSAGE_EVENTS.has(event.type)) {
      const at = event.created ?? this.clock.now();
      this.touchMessage(id, event.data?.assistantMessageID ?? "", at);
    }
  }
  start(id) {
    this.running.add(id);
    this.finalPending.delete(id);
    if (id !== this.rootID) {
      this.ensure(id);
      this.dirty.add(id);
      this.drain(true);
    }
    this.emit();
    this.arm();
  }
  end(id) {
    this.running.delete(id);
    this.finalPending.delete(id);
    if (id !== this.rootID) {
      this.finalPending.add(id);
      this.ensure(id);
      this.dirty.add(id);
      this.drain(true);
    }
    this.emit();
    this.arm();
  }
  forget(id) {
    this.views.delete(id);
    this.running.delete(id);
    this.dirty.delete(id);
    this.finalPending.delete(id);
    this.awaiting.delete(id);
    this.missed.delete(id);
    this.member.delete(id);
    this.lastPullAt.delete(id);
    this.emit();
  }
  ensure(id) {
    const held = this.views.get(id);
    if (held)
      return held;
    const session = this.options.store.session(id);
    if (!session)
      return;
    const entry = { session, messages: [], lastActivity: session.updated };
    this.views.set(id, entry);
    return entry;
  }
  touchMessage(id, messageID, at) {
    const entry = this.ensure(id);
    const list = this.options.store.messages(id);
    if (entry) {
      if (list?.length)
        entry.messages = mergeMessages(entry.messages, list);
      entry.lastActivity = Math.max(entry.lastActivity, at, lastActivityOf(entry.messages));
    }
    if (messageID) {
      this.pending(id).add(messageID);
      if (!this.views.get(id)?.messages.some((m) => m.id === messageID))
        this.dirty.add(id);
    }
    this.flushSoon();
  }
  settle(id) {
    const waiting = this.awaiting.get(id);
    if (!waiting?.size)
      return;
    const held = new Set((this.views.get(id)?.messages ?? []).map((m) => m.id));
    for (const messageID of [...waiting])
      if (held.has(messageID))
        waiting.delete(messageID);
    if (!waiting.size)
      this.awaiting.delete(id);
  }
  flushSoon() {
    if (this.flushTimer !== undefined)
      return;
    this.flushTimer = this.clock.schedule(() => {
      this.flushTimer = undefined;
      this.flush();
    }, this.flushMs);
  }
  flush() {
    if (this.disposed)
      return;
    for (const id of new Set([...this.views.keys(), ...this.dirty])) {
      const entry = this.views.get(id);
      if (!entry)
        continue;
      const session = this.options.store.session(id);
      if (session)
        entry.session = mergeSession(entry.session, session);
      const list = this.options.store.messages(id);
      if (list?.length)
        entry.messages = mergeMessages(entry.messages, list);
      entry.lastActivity = Math.max(entry.lastActivity, lastActivityOf(entry.messages));
      this.settle(id);
    }
    for (const id of this.awaiting.keys())
      this.dirty.add(id);
    if (this.dirty.size || this.finalPending.size)
      this.drain(false);
    this.emit();
    this.arm();
  }
  async tick() {
    if (this.disposed)
      return;
    if (this.calibrationTimer !== undefined) {
      this.clock.cancel(this.calibrationTimer);
      this.calibrationTimer = undefined;
    }
    this.calibrationDue = 0;
    const pulse = this.options.onCalibration;
    if (pulse) {
      try {
        pulse();
      } catch {}
    }
    await this.probe();
    await this.drain(true);
    if (this.disposed)
      return;
    if (this.activeKnown)
      this.lastCalibratedAt = this.clock.now();
    this.emit();
    this.arm();
  }
  async probe() {
    let ids;
    try {
      ids = await this.options.fetch.active();
    } catch {
      return;
    }
    if (this.disposed)
      return;
    this.activeKnown = true;
    const next = new Set;
    for (const id of ids)
      if (await this.belongs(id))
        next.add(id);
    if (this.disposed)
      return;
    for (const id of [...this.running]) {
      if (next.has(id))
        continue;
      this.running.delete(id);
      if (id === this.rootID)
        continue;
      this.finalPending.add(id);
      this.dirty.add(id);
    }
    for (const id of next) {
      if (id === this.rootID) {
        this.running.add(id);
        continue;
      }
      if (this.running.has(id)) {
        this.dirty.add(id);
        continue;
      }
      this.running.add(id);
      this.dirty.add(id);
      this.finalPending.delete(id);
      this.ensure(id);
    }
  }
  async drain(force) {
    if (this.disposed)
      return;
    if (this.draining) {
      this.trailing = true;
      return;
    }
    this.draining = true;
    try {
      const ids = [...new Set([...this.dirty, ...this.finalPending])];
      for (let index = 0;index < ids.length; index += this.concurrency) {
        await Promise.all(ids.slice(index, index + this.concurrency).map((id) => this.pull(id, force)));
        if (this.disposed)
          return;
      }
    } finally {
      this.draining = false;
    }
    if (this.trailing) {
      this.trailing = false;
      if (!this.disposed) {
        this.emit();
        this.arm();
      }
    }
  }
  pull(id, force) {
    const held = this.pulls.get(id);
    if (held)
      return held;
    if (!force && this.clock.now() - (this.lastPullAt.get(id) ?? Number.NEGATIVE_INFINITY) < this.activeMs) {
      return Promise.resolve();
    }
    const generation = this.generation;
    const work = (async () => {
      this.lastPullAt.set(id, this.clock.now());
      const [session, messages] = await Promise.all([
        this.options.fetch.session(id).catch(() => {
          return;
        }),
        this.options.fetch.messages(id).catch(() => {
          return;
        })
      ]);
      if (this.disposed || generation !== this.generation)
        return;
      const entry = this.views.get(id);
      if (entry) {
        if (session)
          entry.session = mergeSession(entry.session, session);
        if (messages?.length)
          entry.messages = mergeMessages(entry.messages, messages);
        entry.lastActivity = Math.max(entry.lastActivity, lastActivityOf(entry.messages));
      } else if (session) {
        this.views.set(id, {
          session,
          messages: messages ?? [],
          lastActivity: Math.max(session.updated, lastActivityOf(messages ?? []))
        });
      }
      this.settle(id);
      if (!this.awaiting.has(id) && messages !== undefined)
        this.dirty.delete(id);
      if (session && messages !== undefined && this.finalPending.has(id) && !this.running.has(id)) {
        this.finalPending.delete(id);
      }
      this.emit();
    })();
    this.pulls.set(id, work);
    work.finally(() => {
      if (this.pulls.get(id) === work)
        this.pulls.delete(id);
    });
    return work;
  }
  arm() {
    if (this.disposed)
      return;
    const busy = this.running.size > 0 || this.dirty.size > 0 || this.finalPending.size > 0;
    const delay = busy ? this.activeMs : this.idleMs;
    const due = this.clock.now() + delay;
    if (this.calibrationTimer !== undefined && this.calibrationDue <= due)
      return;
    if (this.calibrationTimer !== undefined)
      this.clock.cancel(this.calibrationTimer);
    this.calibrationDue = due;
    this.calibrationTimer = this.clock.schedule(() => {
      this.tick();
    }, delay);
  }
  clearTimers() {
    if (this.flushTimer !== undefined)
      this.clock.cancel(this.flushTimer);
    if (this.calibrationTimer !== undefined)
      this.clock.cancel(this.calibrationTimer);
    this.flushTimer = undefined;
    this.calibrationTimer = undefined;
    this.calibrationDue = 0;
  }
  emit() {
    if (this.disposed)
      return;
    const busy = this.running.size > 0 || this.dirty.size > 0 || this.finalPending.size > 0;
    this.options.onChange({
      views: new Map(this.views),
      running: new Set(this.running),
      known: this.activeKnown,
      calibratedAt: this.lastCalibratedAt || undefined,
      calibrationIntervalMs: busy ? this.activeMs : this.idleMs
    });
  }
}

// src/tui/alerts.tsx
import { For as For2 } from "solid-js";

// src/tui/rows.tsx
import { createSignal, For } from "solid-js";
import { usePlugin } from "@opencode/plugin/tui";
import { jsxDEV } from "@opentui/solid/jsx-dev-runtime";
var useTone = () => {
  const theme = usePlugin().theme;
  return (tone) => {
    switch (tone) {
      case "muted":
        return theme.text.muted;
      case "faint":
        return theme.text.faint;
      case "info":
        return theme.text.feedback.info.base;
      case "warning":
        return theme.text.feedback.warning.base;
      case "error":
        return theme.text.feedback.error.base;
      default:
        return theme.text.base;
    }
  };
};
function Row(props) {
  const fg = useTone();
  return /* @__PURE__ */ jsxDEV("text", {
    children: /* @__PURE__ */ jsxDEV(For, {
      each: props.spans,
      children: (s) => /* @__PURE__ */ jsxDEV("span", {
        style: { fg: fg(s.tone), bold: s.bold },
        children: s.text
      }, undefined, false, undefined, this)
    }, undefined, false, undefined, this)
  }, undefined, false, undefined, this);
}
function AlertRow(props) {
  const context = usePlugin();
  const fg = useTone();
  const [hover, setHover] = createSignal(false);
  const navigate = () => {
    if (props.alert.sessionID) {
      context.ui.router.navigate({ type: "session", sessionID: props.alert.sessionID });
    }
  };
  return /* @__PURE__ */ jsxDEV("box", {
    onMouseDown: navigate,
    onMouseOver: () => setHover(true),
    onMouseOut: () => setHover(false),
    children: /* @__PURE__ */ jsxDEV("text", {
      children: /* @__PURE__ */ jsxDEV(For, {
        each: props.alert.spans,
        children: (s) => /* @__PURE__ */ jsxDEV("span", {
          style: { fg: fg(s.tone), bold: s.bold, underline: hover() },
          children: s.text
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this)
    }, undefined, false, undefined, this)
  }, undefined, false, undefined, this);
}

// src/tui/alerts.tsx
import { jsxDEV as jsxDEV2 } from "@opentui/solid/jsx-dev-runtime";
function Alerts(props) {
  return /* @__PURE__ */ jsxDEV2("box", {
    flexDirection: "column",
    children: /* @__PURE__ */ jsxDEV2(For2, {
      each: props.rows,
      children: (alert) => /* @__PURE__ */ jsxDEV2(AlertRow, {
        alert
      }, undefined, false, undefined, this)
    }, undefined, false, undefined, this)
  }, undefined, false, undefined, this);
}

// src/tui/delegations.tsx
import { For as For3 } from "solid-js";
import { jsxDEV as jsxDEV3 } from "@opentui/solid/jsx-dev-runtime";
function Delegations(props) {
  return /* @__PURE__ */ jsxDEV3("box", {
    flexDirection: "column",
    children: [
      /* @__PURE__ */ jsxDEV3(Row, {
        spans: props.block.title
      }, undefined, false, undefined, this),
      /* @__PURE__ */ jsxDEV3(For3, {
        each: props.block.rows,
        children: (row) => /* @__PURE__ */ jsxDEV3(Row, {
          spans: row
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}

// src/tui/subagents.tsx
import { For as For4, Show } from "solid-js";
import { jsxDEV as jsxDEV4 } from "@opentui/solid/jsx-dev-runtime";
function Subagents(props) {
  return /* @__PURE__ */ jsxDEV4("box", {
    flexDirection: "column",
    children: [
      /* @__PURE__ */ jsxDEV4(Row, {
        spans: props.block.title
      }, undefined, false, undefined, this),
      /* @__PURE__ */ jsxDEV4(Row, {
        spans: props.block.header
      }, undefined, false, undefined, this),
      /* @__PURE__ */ jsxDEV4(For4, {
        each: props.block.rows,
        children: (row) => /* @__PURE__ */ jsxDEV4(Row, {
          spans: row
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this),
      /* @__PURE__ */ jsxDEV4(Show, {
        when: props.block.footnote,
        children: /* @__PURE__ */ jsxDEV4(Row, {
          spans: props.block.footnote
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}

// src/tui/sidebar.tsx
import { jsxDEV as jsxDEV5, Fragment } from "@opentui/solid/jsx-dev-runtime";
var DEBOUNCE_MS = 800;
var attempt = (run, fallback) => {
  try {
    return run();
  } catch {
    return fallback;
  }
};
function Sidebar(props) {
  const context = usePlugin2();
  const [tasks, setTasks] = createSignal2([]);
  const [live, setLive] = createSignal2({ views: new Map, running: new Set, known: false });
  const [now, setNow] = createSignal2(Date.now());
  const location = () => context.location ?? attempt(() => context.data.location.default(), undefined);
  const rootOf = (id) => attempt(() => context.data.session.root(id), "") || id;
  const syncSession = context.data.session.sync;
  const quiet = (p) => p.catch(() => {});
  const hydrate = () => {
    const id = props.sessionID;
    const rootID = rootOf(id);
    quiet(syncSession(id));
    quiet(context.data.session.message.sync(id));
    quiet(syncSession(rootID, { children: true }));
    for (const sid of attempt(() => context.data.session.family(rootID), [])) {
      quiet(syncSession(sid));
      quiet(context.data.session.message.sync(sid));
    }
    quiet(context.data.location.agent.sync(location()));
  };
  const storeView = (id) => {
    const s = attempt(() => context.data.session.get(id), undefined);
    return s ? {
      id: s.id,
      parentID: s.parentID,
      agent: s.agent,
      created: s.time.created,
      updated: s.time.updated,
      busy: s.time.busy,
      idle: s.time.idle,
      tokens: s.tokens,
      cost: s.cost
    } : undefined;
  };
  const toView = (info) => ({
    id: info.id,
    parentID: info.parentID,
    agent: info.agent,
    created: info.time.created,
    updated: info.time.updated,
    busy: info.time.busy,
    idle: info.time.idle,
    tokens: info.tokens,
    cost: info.cost
  });
  const storeMessages = (id) => attempt(() => context.data.session.message.list(id), []);
  const refresh = async () => {
    const client = context.client.rpc(crewTasks);
    try {
      const options = context.location ? { location: context.location } : undefined;
      setTasks(parseTasksOutput(await client.tasks({ sessionID: props.sessionID }, options)));
    } catch {
      setTasks([]);
    }
  };
  const controller = new LiveController({
    rootID: props.sessionID,
    family: () => attempt(() => context.data.session.family(rootOf(props.sessionID)), []),
    store: { session: storeView, messages: storeMessages },
    fetch: {
      active: async () => new Set(Object.keys(await context.client.session.active())),
      session: (id) => context.client.session.get({ sessionID: id }).then(toView).catch(() => {
        return;
      }),
      messages: (id) => context.client.message.list({ sessionID: id, limit: LIVE_MESSAGES, order: "desc", type: "assistant" }).then((page) => [...page.data].reverse()).catch(() => {
        return;
      })
    },
    onChange: (snapshot) => {
      setLive(snapshot);
      setNow(Date.now());
    },
    onCalibration: () => {
      refresh();
    }
  });
  let pending;
  const schedule = () => {
    pending ??= setTimeout(() => {
      pending = undefined;
      refresh();
    }, DEBOUNCE_MS);
  };
  const unlisten = context.data.listen(({ details }) => {
    controller.ingest(details);
    schedule();
  });
  onCleanup(() => {
    controller.dispose();
    unlisten();
    if (pending !== undefined)
      clearTimeout(pending);
  });
  createEffect(on(() => props.sessionID, () => {
    setTasks([]);
    refresh();
    controller.setRoot(props.sessionID);
  }));
  createEffect(() => hydrate());
  const statusOf = (id) => attempt(() => context.data.session.status(id), "idle");
  const view = createMemo(() => {
    const rootID = rootOf(props.sessionID);
    const snapshot = live();
    const ids = [...new Set([
      rootID,
      ...attempt(() => context.data.session.family(rootID), []),
      ...snapshot.views.keys(),
      ...snapshot.running
    ])];
    const sessions = ids.flatMap((id) => {
      const session = snapshot.views.get(id)?.session ?? storeView(id);
      return session ? [session] : [];
    });
    const agents = context.data.location.agent.list(location()) ?? [];
    const stepsOf = (agent) => agents.find((a) => a.id === agent)?.steps ?? agents.find((a) => a.id === "engineer")?.steps ?? 80;
    return buildSidebar({
      rootID,
      sessions,
      tasks: tasks(),
      now: now(),
      status: statusOf,
      running: snapshot.known ? (s) => snapshot.running.has(s.id) : (s) => sessionRunning(s, statusOf),
      messages: (id) => snapshot.views.get(id)?.messages ?? storeMessages(id),
      cost: (id) => snapshot.views.get(id)?.session.cost ?? attempt(() => context.data.session.cost(id), 0),
      lastActivity: (id) => snapshot.views.get(id)?.lastActivity ?? 0,
      limit: stepsOf,
      known: snapshot.known,
      calibratedAt: snapshot.calibratedAt,
      calibrationIntervalMs: snapshot.calibrationIntervalMs
    });
  });
  const blocks = createMemo(() => {
    const v = view();
    const out = [];
    if (v.alerts.length)
      out.push({ kind: "alerts", rows: v.alerts });
    if (v.delegations)
      out.push({ kind: "delegations", block: v.delegations });
    if (v.subagents)
      out.push({ kind: "subagents", block: v.subagents });
    return out;
  });
  const render = (block) => {
    if (block.kind === "alerts")
      return /* @__PURE__ */ jsxDEV5(Alerts, {
        rows: block.rows
      }, undefined, false, undefined, this);
    if (block.kind === "delegations")
      return /* @__PURE__ */ jsxDEV5(Delegations, {
        block: block.block
      }, undefined, false, undefined, this);
    return /* @__PURE__ */ jsxDEV5(Subagents, {
      block: block.block
    }, undefined, false, undefined, this);
  };
  return /* @__PURE__ */ jsxDEV5("box", {
    flexDirection: "column",
    children: [
      /* @__PURE__ */ jsxDEV5(For5, {
        each: blocks(),
        children: (block, index) => /* @__PURE__ */ jsxDEV5(Fragment, {
          children: [
            /* @__PURE__ */ jsxDEV5(Show2, {
              when: index() > 0,
              children: /* @__PURE__ */ jsxDEV5("box", {
                height: 1
              }, undefined, false, undefined, this)
            }, undefined, false, undefined, this),
            render(block)
          ]
        }, undefined, true, undefined, this)
      }, undefined, false, undefined, this),
      /* @__PURE__ */ jsxDEV5(Show2, {
        when: view().freshness,
        children: [
          /* @__PURE__ */ jsxDEV5(Show2, {
            when: blocks().length > 0,
            children: /* @__PURE__ */ jsxDEV5("box", {
              height: 1
            }, undefined, false, undefined, this)
          }, undefined, false, undefined, this),
          /* @__PURE__ */ jsxDEV5(Row, {
            spans: view().freshness
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this),
      /* @__PURE__ */ jsxDEV5(Show2, {
        when: blocks().length > 0 || view().freshness,
        children: /* @__PURE__ */ jsxDEV5("box", {
          height: 1
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}

// src/tui/index.tsx
import { jsxDEV as jsxDEV6 } from "@opentui/solid/jsx-dev-runtime";
var tui_default = Plugin.define({
  id: "opencode-crew",
  setup(context) {
    return context.ui.slot({
      prepend: "sidebar.content",
      render: ({ sessionID }) => /* @__PURE__ */ jsxDEV6(Sidebar, {
        sessionID
      }, undefined, false, undefined, this)
    });
  }
});
export {
  tui_default as default
};
