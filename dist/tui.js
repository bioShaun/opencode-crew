// @bun
// src/tui/index.tsx
import { createComponent as _$createComponent8 } from "@opentui/solid";
import { Plugin } from "@opencode/plugin/tui";

// src/tui/sidebar-recovery.tsx
import { insert as _$insert6 } from "@opentui/solid";
import { createTextNode as _$createTextNode } from "@opentui/solid";
import { insertNode as _$insertNode2 } from "@opentui/solid";
import { setProp as _$setProp6 } from "@opentui/solid";
import { createElement as _$createElement6 } from "@opentui/solid";
import { memo as _$memo2 } from "@opentui/solid";
import { createComponent as _$createComponent6 } from "@opentui/solid";
import { createSignal as createSignal3, ErrorBoundary, onCleanup as onCleanup2, onMount, Show as Show3 } from "solid-js";

// src/tui/sidebar.tsx
import { insert as _$insert5 } from "@opentui/solid";
import { memo as _$memo } from "@opentui/solid";
import { setProp as _$setProp5 } from "@opentui/solid";
import { createElement as _$createElement5 } from "@opentui/solid";
import { createComponent as _$createComponent5 } from "@opentui/solid";
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
    const report = effectiveReport(t);
    if (report === "waiting")
      alerts.push(alertRow(t, "waiting", t.report?.reason ?? "\u7B49\u5F85\u5916\u90E8\u8F93\u5165"));
    if (report === "blocked")
      alerts.push(alertRow(t, "blocked", t.report?.reason ?? ""));
    if (report === "failed")
      alerts.push(alertRow(t, "failed", t.report?.reason ?? "\u67E5\u770B\u5931\u8D25\u65E5\u5FD7"));
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
var tokensOf = (a, b) => {
  if (!b)
    return a;
  if (!a)
    return b;
  const pick = totalTokens({ id: "", created: 0, updated: 0, tokens: b }) > totalTokens({ id: "", created: 0, updated: 0, tokens: a }) ? b : a;
  const read = Math.max(a.cache?.read ?? 0, b.cache?.read ?? 0);
  if ((pick.cache?.read ?? 0) >= read)
    return pick;
  return { ...pick, cache: { write: pick.cache?.write ?? 0, read } };
};
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
  trailingForce = false;
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
    this.trailingForce = false;
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
      if (belongs === undefined)
        return false;
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
    if (this.member.get(id) === true)
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
        return;
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
    const probed = await this.probe();
    await this.drain(true);
    if (this.disposed)
      return;
    if (probed)
      this.lastCalibratedAt = this.clock.now();
    this.emit();
    this.arm();
  }
  async probe() {
    let ids;
    try {
      ids = await this.options.fetch.active();
    } catch {
      return false;
    }
    if (this.disposed)
      return false;
    this.activeKnown = true;
    const next = new Set;
    const unknown = new Set;
    for (const id of ids) {
      const result = await this.belongs(id);
      if (result) {
        next.add(id);
        if (id !== this.rootID)
          this.member.set(id, true);
      } else if (result === undefined) {
        unknown.add(id);
      }
    }
    if (this.disposed)
      return false;
    for (const id of [...this.running]) {
      if (next.has(id) || unknown.has(id))
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
    return true;
  }
  async drain(force) {
    if (this.disposed)
      return;
    if (this.draining) {
      this.trailing = true;
      if (force)
        this.trailingForce = true;
      return;
    }
    this.draining = true;
    try {
      do {
        const useForce = force || this.trailingForce;
        this.trailing = false;
        this.trailingForce = false;
        const ids = [...new Set([...this.dirty, ...this.finalPending])];
        for (let index = 0;index < ids.length; index += this.concurrency) {
          await Promise.all(ids.slice(index, index + this.concurrency).map((id) => this.pull(id, useForce)));
          if (this.disposed)
            return;
        }
        force = useForce;
      } while (this.trailing);
    } finally {
      this.draining = false;
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
import { insert as _$insert2 } from "@opentui/solid";
import { createComponent as _$createComponent2 } from "@opentui/solid";
import { setProp as _$setProp2 } from "@opentui/solid";
import { createElement as _$createElement2 } from "@opentui/solid";
import { For as For2 } from "solid-js";

// src/tui/rows.tsx
import { insertNode as _$insertNode } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { effect as _$effect } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { createComponent as _$createComponent } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
import { createSignal, For } from "solid-js";
import { usePlugin } from "@opencode/plugin/tui";
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
  return (() => {
    var _el$ = _$createElement("text");
    _$insert(_el$, _$createComponent(For, {
      get each() {
        return props.spans;
      },
      children: (s) => (() => {
        var _el$2 = _$createElement("span");
        _$insert(_el$2, () => s.text);
        _$effect((_$p) => _$setProp(_el$2, "style", {
          fg: fg(s.tone),
          bold: s.bold
        }, _$p));
        return _el$2;
      })()
    }));
    return _el$;
  })();
}
function AlertRow(props) {
  const context = usePlugin();
  const fg = useTone();
  const [hover, setHover] = createSignal(false);
  const navigate = () => {
    if (props.alert.sessionID) {
      context.ui.router.navigate({
        type: "session",
        sessionID: props.alert.sessionID
      });
    }
  };
  return (() => {
    var _el$3 = _$createElement("box"), _el$4 = _$createElement("text");
    _$insertNode(_el$3, _el$4);
    _$setProp(_el$3, "onMouseDown", navigate);
    _$setProp(_el$3, "onMouseOver", () => setHover(true));
    _$setProp(_el$3, "onMouseOut", () => setHover(false));
    _$insert(_el$4, _$createComponent(For, {
      get each() {
        return props.alert.spans;
      },
      children: (s) => (() => {
        var _el$5 = _$createElement("span");
        _$insert(_el$5, () => s.text);
        _$effect((_$p) => _$setProp(_el$5, "style", {
          fg: fg(s.tone),
          bold: s.bold,
          underline: hover()
        }, _$p));
        return _el$5;
      })()
    }));
    return _el$3;
  })();
}

// src/tui/alerts.tsx
function Alerts(props) {
  return (() => {
    var _el$ = _$createElement2("box");
    _$setProp2(_el$, "flexDirection", "column");
    _$insert2(_el$, _$createComponent2(For2, {
      get each() {
        return props.rows;
      },
      children: (alert) => _$createComponent2(AlertRow, {
        alert
      })
    }));
    return _el$;
  })();
}

// src/tui/delegations.tsx
import { insert as _$insert3 } from "@opentui/solid";
import { createComponent as _$createComponent3 } from "@opentui/solid";
import { setProp as _$setProp3 } from "@opentui/solid";
import { createElement as _$createElement3 } from "@opentui/solid";
import { For as For3 } from "solid-js";
function Delegations(props) {
  return (() => {
    var _el$ = _$createElement3("box");
    _$setProp3(_el$, "flexDirection", "column");
    _$insert3(_el$, _$createComponent3(Row, {
      get spans() {
        return props.block.title;
      }
    }), null);
    _$insert3(_el$, _$createComponent3(For3, {
      get each() {
        return props.block.rows;
      },
      children: (row) => _$createComponent3(Row, {
        spans: row
      })
    }), null);
    return _el$;
  })();
}

// src/tui/subagents.tsx
import { insert as _$insert4 } from "@opentui/solid";
import { createComponent as _$createComponent4 } from "@opentui/solid";
import { setProp as _$setProp4 } from "@opentui/solid";
import { createElement as _$createElement4 } from "@opentui/solid";
import { For as For4, Show } from "solid-js";
function Subagents(props) {
  return (() => {
    var _el$ = _$createElement4("box");
    _$setProp4(_el$, "flexDirection", "column");
    _$insert4(_el$, _$createComponent4(Row, {
      get spans() {
        return props.block.title;
      }
    }), null);
    _$insert4(_el$, _$createComponent4(Row, {
      get spans() {
        return props.block.header;
      }
    }), null);
    _$insert4(_el$, _$createComponent4(For4, {
      get each() {
        return props.block.rows;
      },
      children: (row) => _$createComponent4(Row, {
        spans: row
      })
    }), null);
    _$insert4(_el$, _$createComponent4(Show, {
      get when() {
        return props.block.footnote;
      },
      get children() {
        return _$createComponent4(Row, {
          get spans() {
            return props.block.footnote;
          }
        });
      }
    }), null);
    return _el$;
  })();
}

// src/tui/sidebar.tsx
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
  const [live, setLive] = createSignal2({
    views: new Map,
    running: new Set,
    known: false
  });
  const [family, setFamily] = createSignal2([]);
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
    quiet(syncSession(rootID, {
      children: true
    }));
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
  let familyGen = 0;
  let familyRetry;
  let familyAttempts = 0;
  const loadFamily = () => {
    const gen = ++familyGen;
    const rootID = rootOf(props.sessionID);
    const retry = () => {
      if (gen !== familyGen || familyRetry !== undefined || familyAttempts >= 4)
        return;
      const delay = 500 * 2 ** familyAttempts++;
      familyRetry = setTimeout(() => {
        familyRetry = undefined;
        loadFamily();
      }, delay);
    };
    context.client.session.list({
      parentID: rootID,
      order: "desc",
      limit: 200
    }).then((page) => {
      if (gen !== familyGen)
        return;
      familyAttempts = 0;
      const children = page.data.filter((s) => s.id !== rootID);
      setFamily(children.map(toView));
      for (const s of children) {
        quiet(syncSession(s.id));
        quiet(context.data.session.message.sync(s.id));
      }
    }).catch(retry);
  };
  const refresh = async () => {
    const client = context.client.rpc(crewTasks);
    try {
      const options = context.location ? {
        location: context.location
      } : undefined;
      setTasks(parseTasksOutput(await client.tasks({
        sessionID: props.sessionID
      }, options)));
    } catch {}
  };
  let controller;
  let unlisten;
  let pending;
  onCleanup(() => {
    try {
      controller?.dispose();
    } catch {}
    try {
      unlisten?.();
    } catch {}
    if (pending !== undefined)
      clearTimeout(pending);
    if (familyRetry !== undefined)
      clearTimeout(familyRetry);
    familyGen++;
  });
  controller = new LiveController({
    rootID: props.sessionID,
    family: () => attempt(() => context.data.session.family(rootOf(props.sessionID)), []),
    store: {
      session: storeView,
      messages: storeMessages
    },
    fetch: {
      active: async () => new Set(Object.keys(await context.client.session.active())),
      session: (id) => context.client.session.get({
        sessionID: id
      }).then(toView).catch(() => {
        return;
      }),
      messages: (id) => context.client.message.list({
        sessionID: id,
        limit: LIVE_MESSAGES,
        order: "desc",
        type: "assistant"
      }).then((page) => [...page.data].reverse()).catch(() => {
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
  const schedule = () => {
    pending ??= setTimeout(() => {
      pending = undefined;
      refresh();
    }, DEBOUNCE_MS);
  };
  unlisten = context.data.listen(({
    details
  }) => {
    const event = details;
    if (event.type === "server.connected")
      loadFamily();
    controller?.ingest(event);
    schedule();
  });
  createEffect(on(() => props.sessionID, () => {
    setTasks([]);
    setFamily([]);
    refresh();
    controller?.setRoot(props.sessionID);
    loadFamily();
  }));
  createEffect(() => hydrate());
  const statusOf = (id) => attempt(() => context.data.session.status(id), "idle");
  const view = createMemo(() => {
    const rootID = rootOf(props.sessionID);
    const snapshot = live();
    const local = new Map(family().map((s) => [s.id, s]));
    const ids = [...new Set([rootID, ...attempt(() => context.data.session.family(rootID), []), ...snapshot.views.keys(), ...snapshot.running, ...local.keys()])];
    const sessions = ids.flatMap((id) => {
      const session = snapshot.views.get(id)?.session ?? storeView(id) ?? local.get(id);
      return session ? [session] : [];
    });
    const agents = attempt(() => context.data.location.agent.list(location()) ?? [], []);
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
      out.push({
        kind: "alerts",
        rows: v.alerts
      });
    if (v.delegations)
      out.push({
        kind: "delegations",
        block: v.delegations
      });
    if (v.subagents)
      out.push({
        kind: "subagents",
        block: v.subagents
      });
    return out;
  });
  const render = (block) => {
    if (block.kind === "alerts")
      return _$createComponent5(Alerts, {
        get rows() {
          return block.rows;
        }
      });
    if (block.kind === "delegations")
      return _$createComponent5(Delegations, {
        get block() {
          return block.block;
        }
      });
    return _$createComponent5(Subagents, {
      get block() {
        return block.block;
      }
    });
  };
  return (() => {
    var _el$ = _$createElement5("box");
    _$setProp5(_el$, "flexDirection", "column");
    _$insert5(_el$, _$createComponent5(For5, {
      get each() {
        return blocks();
      },
      children: (block, index) => [_$createComponent5(Show2, {
        get when() {
          return index() > 0;
        },
        get children() {
          var _el$4 = _$createElement5("box");
          _$setProp5(_el$4, "height", 1);
          return _el$4;
        }
      }), _$memo(() => render(block))]
    }), null);
    _$insert5(_el$, _$createComponent5(Show2, {
      get when() {
        return view().freshness;
      },
      get children() {
        return [_$createComponent5(Show2, {
          get when() {
            return blocks().length > 0;
          },
          get children() {
            var _el$2 = _$createElement5("box");
            _$setProp5(_el$2, "height", 1);
            return _el$2;
          }
        }), _$createComponent5(Row, {
          get spans() {
            return view().freshness;
          }
        })];
      }
    }), null);
    _$insert5(_el$, _$createComponent5(Show2, {
      get when() {
        return blocks().length > 0 || view().freshness;
      },
      get children() {
        var _el$3 = _$createElement5("box");
        _$setProp5(_el$3, "height", 1);
        return _el$3;
      }
    }), null);
    return _el$;
  })();
}

// src/tui/sidebar-recovery.tsx
var clock = {
  now: () => Date.now(),
  schedule: (fn, delay) => setTimeout(fn, delay),
  cancel: (handle) => clearTimeout(handle)
};
var recoveryEvents = [];
var delays = [1000, 3000, 1e4];
function SidebarRecovery(props) {
  return _$createComponent6(Show3, {
    get when() {
      return props.sessionID;
    },
    keyed: true,
    children: (sessionID) => _$createComponent6(SessionRecovery, {
      get context() {
        return props.context;
      },
      sessionID,
      get clock() {
        return props.clock ?? clock;
      }
    })
  });
}
function SessionRecovery(props) {
  let attempts = 0;
  let lastManual = Number.NEGATIVE_INFINITY;
  let retry;
  let disposed = false;
  const [failed, setFailed] = createSignal3(false);
  onCleanup2(() => {
    disposed = true;
    retry = undefined;
  });
  try {
    props.context.keymap?.layer(() => ({
      commands: [{
        id: "crew.sidebar.retry",
        title: "Retry Crew sidebar",
        palette: true,
        bind: false,
        enabled: failed,
        run: () => {
          retry?.();
        }
      }]
    }));
  } catch {}
  function Healthy() {
    onMount(() => {
      setFailed(false);
      const timer = props.clock.schedule(() => {
        if (!disposed)
          attempts = 0;
      }, 60000);
      onCleanup2(() => props.clock.cancel(timer));
    });
    return _$createComponent6(Sidebar, {
      get sessionID() {
        return props.sessionID;
      }
    });
  }
  function Fallback(p) {
    const id = Math.random().toString(36).slice(2, 10).padEnd(8, "0");
    recoveryEvents.push({
      id,
      phase: "component",
      category: p.error === null ? "null" : typeof p.error
    });
    if (recoveryEvents.length > 50)
      recoveryEvents.shift();
    setFailed(true);
    let timer;
    let active = true;
    const reset = () => {
      if (!active || disposed)
        return;
      active = false;
      if (timer !== undefined)
        props.clock.cancel(timer);
      retry = undefined;
      p.reset();
    };
    retry = () => {
      const now = props.clock.now();
      if (now - lastManual < 1000)
        return;
      lastManual = now;
      reset();
    };
    const delay = delays[attempts];
    if (delay !== undefined) {
      timer = props.clock.schedule(() => {
        attempts++;
        reset();
      }, delay);
    }
    onCleanup2(() => {
      active = false;
      if (timer !== undefined)
        props.clock.cancel(timer);
      retry = undefined;
    });
    return (() => {
      var _el$ = _$createElement6("box"), _el$2 = _$createElement6("text"), _el$4 = _$createElement6("text"), _el$5 = _$createTextNode(`\u8BCA\u65AD `), _el$6 = _$createTextNode(`\uFF08\u4EC5\u5185\u5B58\uFF09`), _el$7 = _$createElement6("text"), _el$8 = _$createElement6("text");
      _$insertNode2(_el$, _el$2);
      _$insertNode2(_el$, _el$4);
      _$insertNode2(_el$, _el$7);
      _$insertNode2(_el$, _el$8);
      _$setProp6(_el$, "flexDirection", "column");
      _$insertNode2(_el$2, _$createTextNode(`Crew \u6682\u65F6\u4E0D\u53EF\u7528`));
      _$insertNode2(_el$4, _el$5);
      _$insertNode2(_el$4, _el$6);
      _$insert6(_el$4, id, _el$6);
      _$insert6(_el$7, delay === undefined ? "\u81EA\u52A8\u91CD\u8BD5\u5DF2\u7528\u5C3D" : `\u81EA\u52A8\u91CD\u8BD5 ${attempts + 1}/3`);
      _$insertNode2(_el$8, _$createTextNode(`\u70B9\u51FB\u91CD\u8BD5`));
      _$setProp6(_el$8, "onMouseDown", () => retry?.());
      return _el$;
    })();
  }
  return _$createComponent6(ErrorBoundary, {
    fallback: (error, reset) => _$createComponent6(Fallback, {
      error,
      reset
    }),
    get children() {
      return _$createComponent6(Healthy, {});
    }
  });
}

// src/tui/profile-footer.tsx
import { createComponent as _$createComponent7 } from "@opentui/solid";
import { Show as Show4, createMemo as createMemo2, onCleanup as onCleanup3, onMount as onMount2 } from "solid-js";
import { usePlugin as usePlugin3 } from "@opencode/plugin/tui";

// src/tui/profile-menu.ts
var OFF_TITLE = "\u5173\u95ED\u6863\u4F4D\uFF08\u56DE\u5230 opencode.json\uFF09";
var summary = (profile) => `${profile.rootModel ? `root: ${profile.rootModel}` : "root: inherit"} \xB7 ${profile.models} \u6A21\u578B / ${profile.steps} \u6B65\u6570 / ${profile.instructions} \u8865\u5145\u89C4\u5219`;
function profileOptions(view) {
  const options = view.profiles.map((profile) => ({
    title: `${view.active === profile.name ? "\u25CF " : "  "}${profile.name}`,
    description: summary(profile),
    value: { kind: "profile", name: profile.name },
    ...profile.source === "package" ? { footer: "\u5185\u7F6E" } : {}
  }));
  options.push({ title: OFF_TITLE, value: { kind: "off" } });
  const current = view.active && view.profiles.some((profile) => profile.name === view.active) ? { kind: "profile", name: view.active } : { kind: "off" };
  return { options, current };
}
function profileListText(view) {
  const lines = [];
  if (view.dirs.length) {
    for (const root of view.dirs) {
      lines.push(`\u76EE\u5F55\uFF1A${root.dir}\uFF08${root.source === "package" ? "\u5185\u7F6E" : "\u7528\u6237"}\uFF0C${root.exists ? "\u5B58\u5728" : "\u4E0D\u5B58\u5728"}\uFF09`);
    }
  } else {
    lines.push("\u76EE\u5F55\uFF1A\u672A\u914D\u7F6E\uFF08OPENCODE_CREW_PROFILES_DIR \u4E3A\u7A7A\uFF09");
  }
  lines.push(view.active ? `\u5F53\u524D\u6863\uFF1A${view.active}` : "\u5F53\u524D\u6863\uFF1Aoff\uFF08\u6309 opencode.json \u8FD0\u884C\uFF09");
  if (view.requested && view.requested !== view.active)
    lines.push(`\u6307\u9488\u5185\u5BB9\uFF1A${view.requested}`);
  if (view.error)
    lines.push(`\u56DE\u9000\u539F\u56E0\uFF1A${view.error}`);
  if (!view.profiles.length) {
    lines.push("\u53EF\u7528\u6863\uFF1A\u65E0");
  } else {
    lines.push("\u53EF\u7528\u6863\uFF1A");
    for (const profile of view.profiles) {
      lines.push(`${view.active === profile.name ? "\u25CF " : "  "}${profile.name}  ${summary(profile)}`);
    }
  }
  if (view.errors.length) {
    lines.push("\u9519\u8BEF\uFF1A");
    for (const error of view.errors)
      lines.push(`  ${error.name || "(\u76EE\u5F55)"}: ${error.message}`);
  }
  return lines.join(`
`);
}
function profileFooterLabel(view) {
  if (!view)
    return;
  const active = view.active ? view.active : undefined;
  const warning = view.error ? " \u26A0" : "";
  if (active)
    return `profile: ${active}${warning}`;
  if (view.error)
    return `profile: off${warning}`;
  return;
}

// src/config.ts
var IDS = ["root", "architect", "engineer", "explorer", "reviewer"];
var PROFILE_NAME_PATTERN = /^(?!\.)(?=.*[a-z0-9])[a-z0-9._-]{1,64}$/;
function isProfileName(name) {
  return typeof name === "string" && PROFILE_NAME_PATTERN.test(name);
}

// src/profile-rpc.ts
var str2 = { type: "string" };
var bool = { type: "boolean" };
var count = { type: "integer" };
var profileViewSchema = {
  type: "object",
  properties: {
    name: str2,
    source: { type: "string", enum: ["user", "package"] },
    models: count,
    steps: count,
    instructions: count,
    rootModel: str2,
    roles: { type: "array", items: { type: "string", enum: [...IDS] } }
  },
  required: ["name", "source", "models", "steps", "instructions", "roles"],
  additionalProperties: false
};
var profilesViewSchema = {
  type: "object",
  properties: {
    active: str2,
    requested: str2,
    error: str2,
    dirs: {
      type: "array",
      items: {
        type: "object",
        properties: { dir: str2, source: { type: "string", enum: ["user", "package"] }, exists: bool },
        required: ["dir", "source", "exists"],
        additionalProperties: false
      }
    },
    profiles: { type: "array", items: profileViewSchema },
    errors: {
      type: "array",
      items: {
        type: "object",
        properties: { name: str2, message: str2 },
        required: ["name", "message"],
        additionalProperties: false
      }
    }
  },
  required: ["dirs", "profiles", "errors"],
  additionalProperties: false
};
var switchViewSchema = {
  type: "object",
  properties: {
    ok: bool,
    active: str2,
    changed: bool,
    code: str2,
    message: str2,
    warnings: { type: "array", items: str2 },
    profiles: profilesViewSchema
  },
  required: ["ok", "changed", "warnings", "profiles"],
  additionalProperties: false
};
var emptyInput = { type: "object", properties: {}, additionalProperties: false };
var crewProfiles = {
  id: "opencode-crew-profiles",
  methods: {
    list: { input: emptyInput, output: profilesViewSchema },
    switch: {
      input: {
        type: "object",
        properties: { name: { type: "string", minLength: 1, maxLength: 64 } },
        required: ["name"],
        additionalProperties: false
      },
      output: switchViewSchema
    },
    off: { input: emptyInput, output: switchViewSchema }
  },
  events: {}
};
var object2 = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
var isStr = (value) => typeof value === "string";
var isCount = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
var emptyProfilesView = () => ({ dirs: [], profiles: [], errors: [] });
function parseProfilesView(value) {
  const view = emptyProfilesView();
  if (!object2(value))
    return view;
  if (isProfileName(value.active))
    view.active = value.active;
  if (isStr(value.requested) && value.requested)
    view.requested = value.requested;
  if (isStr(value.error) && value.error)
    view.error = value.error;
  if (Array.isArray(value.dirs)) {
    for (const root of value.dirs) {
      if (!object2(root) || !isStr(root.dir) || root.source !== "user" && root.source !== "package")
        continue;
      view.dirs.push({ dir: root.dir, source: root.source, exists: root.exists === true });
    }
  }
  if (Array.isArray(value.profiles)) {
    for (const profile of value.profiles) {
      if (!object2(profile) || !isProfileName(profile.name) || profile.source !== "user" && profile.source !== "package")
        continue;
      const roles = Array.isArray(profile.roles) ? profile.roles.filter((role) => isStr(role) && IDS.includes(role)) : [];
      view.profiles.push({
        name: profile.name,
        source: profile.source,
        models: isCount(profile.models) ? Math.floor(profile.models) : 0,
        steps: isCount(profile.steps) ? Math.floor(profile.steps) : 0,
        instructions: isCount(profile.instructions) ? Math.floor(profile.instructions) : 0,
        ...isStr(profile.rootModel) && profile.rootModel ? { rootModel: profile.rootModel } : {},
        roles
      });
    }
  }
  if (Array.isArray(value.errors)) {
    for (const error of value.errors) {
      if (!object2(error) || !isStr(error.name) || !isStr(error.message))
        continue;
      view.errors.push({ name: error.name, message: error.message });
    }
  }
  return view;
}
function parseSwitchView(value) {
  if (!object2(value) || typeof value.ok !== "boolean")
    return;
  const view = {
    ok: value.ok,
    changed: value.changed === true,
    warnings: Array.isArray(value.warnings) ? value.warnings.filter(isStr) : [],
    profiles: parseProfilesView(value.profiles)
  };
  if (isProfileName(value.active))
    view.active = value.active;
  if (isStr(value.code) && value.code)
    view.code = value.code;
  if (isStr(value.message) && value.message)
    view.message = value.message;
  return view;
}

// src/tui/profile-command.ts
var PROFILE_USAGE = [
  "\u7528\u6CD5\uFF1A",
  "/crew-profile            \u9009\u62E9\u6863\u4F4D\uFF08Enter \u5207\u6362\uFF0CEsc \u53D6\u6D88\uFF09",
  "/crew-profile <name>     \u76F4\u63A5\u5207\u6362\u5230\u6307\u5B9A\u6863",
  "/crew-profile list       \u5217\u51FA\u6863\u76EE\u5F55\u3001\u53EF\u7528\u6863\u4E0E\u9519\u8BEF",
  "/crew-profile off        \u5173\u95ED\u6863\u4F4D\uFF0C\u56DE\u5230 opencode.json \u914D\u7F6E",
  "/crew-profile help       \u663E\u793A\u672C\u5E2E\u52A9",
  "",
  "\u6863\u4F4D\u662F\u7528\u6237\u7EA7\u5168\u5C40\u8BBE\u7F6E\uFF0C\u6587\u4EF6\u4F4D\u4E8E OPENCODE_CREW_PROFILES_DIR \u6216 ${XDG_CONFIG_HOME:-~/.config}/opencode/crew-profiles\u3002"
].join(`
`);
function parseProfileCommand(raw) {
  const text = (raw ?? "").trim().replace(/^\/(?:crew-profile|crewprofile)(?:\s+|$)/i, "").trim();
  if (!text)
    return { kind: "menu" };
  const parts = text.split(/\s+/);
  if (parts.length > 1)
    return { kind: "invalid", message: `\u53EA\u63A5\u53D7\u5355\u4E2A\u6863\u540D\uFF0C\u6536\u5230 "${text}"\u3002` };
  const token = parts[0];
  switch (token) {
    case "list":
    case "ls":
      return { kind: "list" };
    case "off":
    case "none":
      return { kind: "off" };
    case "help":
    case "-h":
    case "--help":
      return { kind: "help" };
  }
  if (isProfileName(token))
    return { kind: "switch", name: token };
  return { kind: "invalid", message: `\u6863\u540D "${token}" \u4E0D\u5408\u6CD5\uFF08\u53EA\u5141\u8BB8\u5C0F\u5199\u5B57\u6BCD a-z\u3001\u6570\u5B57 0-9 \u4E0E . _ -\uFF09\u3002` };
}

// src/tui/profile-actions.ts
var PROFILE_MEMORY_KEY = "opencode-crew-profile";
var TITLE = "Crew \u914D\u7F6E\u6863";
var UNAVAILABLE = "\u5BBF\u4E3B\u4E0D\u652F\u6301 RPC\uFF0C\u6682\u65F6\u65E0\u6CD5\u8BFB\u53D6\u6216\u5207\u6362\u6863\u4F4D\u3002";
function profileRpc(context) {
  return context.client.rpc(crewProfiles);
}
var callOptions = (context) => context.location ? { location: context.location } : undefined;
async function refreshProfile(context) {
  try {
    return parseProfilesView(await profileRpc(context).list({}, callOptions(context)));
  } catch {
    return;
  }
}
function rememberProfile(context, view) {
  if (!view)
    return;
  try {
    const [, mutate] = context.storage.memory(PROFILE_MEMORY_KEY, { initial: { active: "", error: "", at: 0 } });
    mutate((draft) => {
      draft.active = view.active ?? "";
      draft.error = view.error ?? "";
      draft.at = Date.now();
    });
  } catch {}
}
async function alert(context, title, message) {
  try {
    await context.ui.dialog.alert({ title, message });
  } catch {}
}
async function switchTo(context, name) {
  try {
    const view = parseSwitchView(await profileRpc(context).switch({ name }, callOptions(context)));
    if (!view) {
      await alert(context, "\u5207\u6362\u5931\u8D25", "\u5BBF\u4E3B\u8FD4\u56DE\u4E86\u65E0\u6CD5\u8BC6\u522B\u7684\u7ED3\u679C\uFF1B\u6863\u4F4D\u72B6\u6001\u672A\u786E\u8BA4\u3002");
      return;
    }
    rememberProfile(context, view.profiles);
    if (!view.ok) {
      await alert(context, "\u5207\u6362\u5931\u8D25", view.message ?? view.code ?? "\u672A\u77E5\u539F\u56E0\uFF1B\u6863\u4F4D\u72B6\u6001\u672A\u6539\u53D8\u3002");
      return;
    }
    context.ui.toast.show({ variant: "success", message: `\u5DF2\u5207\u6362\u5230\u6863 "${name}"\uFF08\u65B0\u4F1A\u8BDD/\u4E0B\u4E00\u6B21\u8BF7\u6C42\u751F\u6548\uFF09` });
    for (const warning of view.warnings)
      context.ui.toast.show({ variant: "warning", message: warning });
  } catch {
    await alert(context, "\u5207\u6362\u5931\u8D25", "\u5BBF\u4E3B\u8C03\u7528\u5931\u8D25\uFF1B\u6863\u4F4D\u72B6\u6001\u672A\u786E\u8BA4\u3002");
  }
}
async function switchOff(context) {
  try {
    const view = parseSwitchView(await profileRpc(context).off({}, callOptions(context)));
    if (!view) {
      await alert(context, "\u5173\u95ED\u5931\u8D25", "\u5BBF\u4E3B\u8FD4\u56DE\u4E86\u65E0\u6CD5\u8BC6\u522B\u7684\u7ED3\u679C\uFF1B\u6863\u4F4D\u72B6\u6001\u672A\u786E\u8BA4\u3002");
      return;
    }
    rememberProfile(context, view.profiles);
    if (!view.ok) {
      await alert(context, "\u5173\u95ED\u5931\u8D25", view.message ?? view.code ?? "\u672A\u77E5\u539F\u56E0\uFF1B\u6863\u4F4D\u72B6\u6001\u672A\u6539\u53D8\u3002");
      return;
    }
    context.ui.toast.show({
      variant: "success",
      message: view.changed ? "\u5DF2\u5173\u95ED\u6863\u4F4D\uFF0C\u56DE\u5230 opencode.json \u914D\u7F6E\uFF08\u65B0\u4F1A\u8BDD/\u4E0B\u4E00\u6B21\u8BF7\u6C42\u751F\u6548\uFF09" : "\u6863\u4F4D\u5DF2\u662F\u5173\u95ED\u72B6\u6001"
    });
    for (const warning of view.warnings)
      context.ui.toast.show({ variant: "warning", message: warning });
  } catch {
    await alert(context, "\u5173\u95ED\u5931\u8D25", "\u5BBF\u4E3B\u8C03\u7528\u5931\u8D25\uFF1B\u6863\u4F4D\u72B6\u6001\u672A\u786E\u8BA4\u3002");
  }
}
async function openMenu(context) {
  const view = await refreshProfile(context);
  if (!view) {
    await alert(context, TITLE, UNAVAILABLE);
    return;
  }
  rememberProfile(context, view);
  const { options, current } = profileOptions(view);
  let picked;
  try {
    picked = await context.ui.dialog.select({ title: TITLE, options, current });
  } catch {
    return;
  }
  if (!picked)
    return;
  if (picked.kind === "off")
    await switchOff(context);
  else
    await switchTo(context, picked.name);
}
async function runProfileCommand(context, raw) {
  const command = parseProfileCommand(raw);
  switch (command.kind) {
    case "help":
      await alert(context, TITLE, PROFILE_USAGE);
      return;
    case "invalid":
      await alert(context, "\u7528\u6CD5", `${command.message}

${PROFILE_USAGE}`);
      return;
    case "list": {
      const view = await refreshProfile(context);
      if (!view) {
        await alert(context, TITLE, UNAVAILABLE);
        return;
      }
      rememberProfile(context, view);
      await alert(context, TITLE, profileListText(view));
      return;
    }
    case "menu":
      await openMenu(context);
      return;
    case "switch":
      await switchTo(context, command.name);
      return;
    case "off":
      await switchOff(context);
      return;
  }
}

// src/tui/profile-footer.tsx
function ProfileFooter() {
  const context = usePlugin3();
  const [state, setState] = context.storage.memory(PROFILE_MEMORY_KEY, {
    initial: {
      active: "",
      error: "",
      at: 0
    }
  });
  const refresh = async () => {
    const view = await refreshProfile(context);
    if (!view)
      return;
    setState((draft) => {
      draft.active = view.active ?? "";
      draft.error = view.error ?? "";
      draft.at = Date.now();
    });
  };
  onMount2(() => {
    refresh();
  });
  const timer = setInterval(() => {
    refresh();
  }, 60000);
  onCleanup3(() => clearInterval(timer));
  const label = createMemo2(() => profileFooterLabel({
    active: state.active,
    error: state.error
  }));
  return _$createComponent7(Show4, {
    get when() {
      return label();
    },
    children: (text) => _$createComponent7(Row, {
      get spans() {
        return [{
          text: text(),
          tone: state.active ? "muted" : "warning"
        }];
      }
    })
  });
}

// src/tui/index.tsx
var tui_default = Plugin.define({
  id: "opencode-crew",
  setup(context) {
    const sidebar = context.ui.slot({
      prepend: "sidebar.content",
      render: (props) => _$createComponent8(SidebarRecovery, {
        context,
        get sessionID() {
          return props.sessionID;
        }
      })
    });
    const footer = context.ui.slot({
      append: "sidebar.footer",
      render: () => _$createComponent8(ProfileFooter, {})
    });
    context.keymap.layer(() => ({
      mode: "global",
      commands: [{
        id: "opencode-crew.profile",
        title: "Crew \u914D\u7F6E\u6863",
        group: "Crew",
        palette: true,
        slash: {
          name: "crew-profile",
          arguments: true
        },
        run: (input) => runProfileCommand(context, input ?? "")
      }]
    }));
    return () => {
      sidebar();
      footer();
    };
  }
});
export {
  tui_default as default
};
