// Shared read-only contract between the Crew server plugin and its TUI part.
// Type-only imports keep this module dependency-free on both sides.

import type { Rpc } from "@opencode/plugin"
import type { CrewTaskView } from "./tui/view-model"

export type { CrewTaskView }

const taskSchema = {
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
        errorCode: { type: "string" },
      },
      additionalProperties: false,
    },
    report: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["progress", "waiting", "ready", "blocked", "failed", "dropped"] },
        reason: { type: "string" },
      },
      required: ["status"],
      additionalProperties: false,
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
        additionalProperties: false,
      },
    },
  },
  required: ["taskID", "directory", "scopes", "state", "lifecycle", "check", "steps"],
  additionalProperties: false,
}

/** Read-only crew_task snapshot; the only channel between the server plugin and the TUI. */
export const crewTasks = {
  id: "opencode-crew",
  methods: {
    tasks: {
      input: {
        type: "object",
        properties: { sessionID: { type: "string" } },
        required: ["sessionID"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { tasks: { type: "array", items: taskSchema } },
        required: ["tasks"],
        additionalProperties: false,
      },
    },
  },
  events: {},
} satisfies Rpc.PortableDefinition

const object = (x: unknown): x is Record<string, unknown> =>
  x !== null && typeof x === "object" && !Array.isArray(x)
const str = (x: unknown): x is string => typeof x === "string"
const num = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x)
const REPORT = ["progress", "waiting", "ready", "blocked", "failed", "dropped"]

export function parseTasksInput(value: unknown): { sessionID: string } | undefined {
  return object(value) && str(value.sessionID) && value.sessionID.length <= 512
    ? { sessionID: value.sessionID }
    : undefined
}

function task(value: unknown): CrewTaskView | undefined {
  if (!object(value) || !str(value.taskID) || !str(value.directory) || !str(value.state)
    || (value.lifecycle !== "active" && value.lifecycle !== "closed") || !str(value.check)) return undefined
  const view: CrewTaskView = {
    taskID: value.taskID,
    directory: value.directory,
    scopes: num(value.scopes) ? Math.max(0, Math.floor(value.scopes)) : 0,
    state: value.state,
    lifecycle: value.lifecycle,
    check: value.check,
    steps: num(value.steps) ? Math.max(0, Math.floor(value.steps)) : 0,
  }
  if (str(value.sessionID)) view.sessionID = value.sessionID
  if (object(value.observed)) {
    const o = value.observed
    const observed: NonNullable<CrewTaskView["observed"]> = {}
    if (o.outcome === "succeeded" || o.outcome === "failed" || o.outcome === "interrupted") observed.outcome = o.outcome
    if (str(o.busyAt)) observed.busyAt = o.busyAt
    if (str(o.idleAt)) observed.idleAt = o.idleAt
    if (str(o.errorCode)) observed.errorCode = o.errorCode
    if (Object.keys(observed).length) view.observed = observed
  }
  if (object(value.report) && str(value.report.status) && REPORT.includes(value.report.status)) {
    view.report = {
      status: value.report.status as NonNullable<CrewTaskView["report"]>["status"],
      ...(str(value.report.reason) ? { reason: value.report.reason } : {}),
    }
  }
  if (num(value.tokens)) view.tokens = value.tokens
  if (num(value.cacheRead)) view.cacheRead = value.cacheRead
  if (num(value.cost)) view.cost = value.cost
  if (Array.isArray(value.permissions)) {
    const permissions = value.permissions.flatMap(p =>
      object(p) && str(p.action) && Array.isArray(p.resources) && p.resources.every(str)
        ? [{ action: p.action, resources: [...p.resources] }] : [])
    if (permissions.length) view.permissions = permissions
  }
  return view
}

export function parseTasksOutput(value: unknown): CrewTaskView[] {
  if (!object(value) || !Array.isArray(value.tasks)) return []
  return value.tasks.flatMap(item => {
    const parsed = task(item)
    return parsed ? [parsed] : []
  })
}
