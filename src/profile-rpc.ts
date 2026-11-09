// Shared profile RPC contract between the Crew server plugin and its TUI part.
// Runtime imports stay pure (`./config` only) so the TUI bundle never pulls node:fs;
// the server-side registration lives here too but is only called from src/index.ts.

import type { Context } from "@opencode/plugin/promise/plugin"
import type { Rpc } from "@opencode/plugin"
import { IDS, isProfileName, profileNameError, type RoleID } from "./config"
import type { CrewProfilesInfo, CrewProfileRuntime, CrewSwitchResult } from "./profile-state"

export type CrewProfileView = {
  name: string
  source: "user" | "package"
  /** Number of roles with a model set. */
  models: number
  steps: number
  instructions: number
  /** Raw `models.root` value; absent means the session model is inherited. */
  rootModel?: string
  /** Roles with a model set, for `list` output. */
  roles: RoleID[]
}

export type CrewProfilesView = {
  /** Absent = off (JSON Schema has no null; follows the "absent means none" style). */
  active?: string
  requested?: string
  error?: string
  dirs: { dir: string; source: "user" | "package"; exists: boolean }[]
  profiles: CrewProfileView[]
  errors: { name: string; message: string }[]
}

export type CrewSwitchView = {
  ok: boolean
  active?: string
  changed: boolean
  code?: string
  message?: string
  warnings: string[]
  profiles: CrewProfilesView
}

const str = { type: "string" }
const bool = { type: "boolean" }
const count = { type: "integer" }

const profileViewSchema = {
  type: "object",
  properties: {
    name: str,
    source: { type: "string", enum: ["user", "package"] },
    models: count,
    steps: count,
    instructions: count,
    rootModel: str,
    roles: { type: "array", items: { type: "string", enum: [...IDS] } },
  },
  required: ["name", "source", "models", "steps", "instructions", "roles"],
  additionalProperties: false,
}

const profilesViewSchema = {
  type: "object",
  properties: {
    active: str,
    requested: str,
    error: str,
    dirs: {
      type: "array",
      items: {
        type: "object",
        properties: { dir: str, source: { type: "string", enum: ["user", "package"] }, exists: bool },
        required: ["dir", "source", "exists"],
        additionalProperties: false,
      },
    },
    profiles: { type: "array", items: profileViewSchema },
    errors: {
      type: "array",
      items: {
        type: "object",
        properties: { name: str, message: str },
        required: ["name", "message"],
        additionalProperties: false,
      },
    },
  },
  required: ["dirs", "profiles", "errors"],
  additionalProperties: false,
}

const switchViewSchema = {
  type: "object",
  properties: {
    ok: bool,
    active: str,
    changed: bool,
    code: str,
    message: str,
    warnings: { type: "array", items: str },
    profiles: profilesViewSchema,
  },
  required: ["ok", "changed", "warnings", "profiles"],
  additionalProperties: false,
}

const emptyInput = { type: "object", properties: {}, additionalProperties: false }

/** Write-capable contract, deliberately separate from the read-only `crewTasks` one. */
export const crewProfiles = {
  id: "opencode-crew-profiles",
  methods: {
    list: { input: emptyInput, output: profilesViewSchema },
    switch: {
      input: {
        type: "object",
        properties: { name: { type: "string", minLength: 1, maxLength: 64 } },
        required: ["name"],
        additionalProperties: false,
      },
      output: switchViewSchema,
    },
    off: { input: emptyInput, output: switchViewSchema },
  },
  events: {},
} satisfies Rpc.PortableDefinition

const MODEL_KEY = (model: { providerID: string; id: string; variant?: string }) =>
  `${model.providerID}/${model.id}${model.variant ? `#${model.variant}` : ""}`

/** Server-side projection (pure). */
export function toProfilesView(info: CrewProfilesInfo): CrewProfilesView {
  const view: CrewProfilesView = {
    dirs: info.set.dirs.map(root => ({ dir: root.dir, source: root.source, exists: root.exists === true })),
    profiles: info.set.profiles.map(profile => {
      const roles = (Object.keys(profile.config.models) as RoleID[]).filter(id => profile.config.models[id])
      const root = profile.config.models.root
      return {
        name: profile.name,
        source: profile.source,
        models: roles.length,
        steps: Object.keys(profile.config.steps).length,
        instructions: profile.config.engineerInstructions.length,
        ...(root ? { rootModel: MODEL_KEY(root) } : {}),
        roles,
      }
    }),
    errors: info.set.errors.map(error => ({ name: error.name, message: error.message })),
  }
  if (info.active) view.active = info.active
  if (info.requested) view.requested = info.requested
  if (info.error) view.error = info.error
  return view
}

export function toSwitchView(result: CrewSwitchResult): CrewSwitchView {
  const view: CrewSwitchView = {
    ok: result.ok,
    changed: result.changed,
    warnings: [...result.warnings],
    profiles: toProfilesView(result.info),
  }
  if (result.active) view.active = result.active
  if (result.code) view.code = result.code
  if (result.message) view.message = result.message
  return view
}

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
const isStr = (value: unknown): value is string => typeof value === "string"
const isCount = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0

export const emptyProfilesView = (): CrewProfilesView => ({ dirs: [], profiles: [], errors: [] })

/** The TUI trusts nothing on the wire: every field is re-validated, bad items dropped. */
export function parseProfilesView(value: unknown): CrewProfilesView {
  const view = emptyProfilesView()
  if (!object(value)) return view
  if (isProfileName(value.active)) view.active = value.active
  if (isStr(value.requested) && value.requested) view.requested = value.requested
  if (isStr(value.error) && value.error) view.error = value.error
  if (Array.isArray(value.dirs)) {
    for (const root of value.dirs) {
      if (!object(root) || !isStr(root.dir) || (root.source !== "user" && root.source !== "package")) continue
      view.dirs.push({ dir: root.dir, source: root.source, exists: root.exists === true })
    }
  }
  if (Array.isArray(value.profiles)) {
    for (const profile of value.profiles) {
      if (!object(profile) || !isProfileName(profile.name) || (profile.source !== "user" && profile.source !== "package")) continue
      const roles = Array.isArray(profile.roles)
        ? profile.roles.filter((role): role is RoleID => isStr(role) && (IDS as readonly string[]).includes(role))
        : []
      view.profiles.push({
        name: profile.name,
        source: profile.source,
        models: isCount(profile.models) ? Math.floor(profile.models) : 0,
        steps: isCount(profile.steps) ? Math.floor(profile.steps) : 0,
        instructions: isCount(profile.instructions) ? Math.floor(profile.instructions) : 0,
        ...(isStr(profile.rootModel) && profile.rootModel ? { rootModel: profile.rootModel } : {}),
        roles,
      })
    }
  }
  if (Array.isArray(value.errors)) {
    for (const error of value.errors) {
      if (!object(error) || !isStr(error.name) || !isStr(error.message)) continue
      view.errors.push({ name: error.name, message: error.message })
    }
  }
  return view
}

export function parseSwitchView(value: unknown): CrewSwitchView | undefined {
  if (!object(value) || typeof value.ok !== "boolean") return undefined
  const view: CrewSwitchView = {
    ok: value.ok,
    changed: value.changed === true,
    warnings: Array.isArray(value.warnings) ? value.warnings.filter(isStr) : [],
    profiles: parseProfilesView(value.profiles),
  }
  if (isProfileName(value.active)) view.active = value.active
  if (isStr(value.code) && value.code) view.code = value.code
  if (isStr(value.message) && value.message) view.message = value.message
  return view
}

const HOST_ERROR_MESSAGE = "宿主调用失败，档位状态未改变；请检查 OpenCode 日志后重试。"

function safeView(profiles: CrewProfileRuntime): CrewProfilesView {
  try { return toProfilesView(profiles.info()) } catch { return emptyProfilesView() }
}

/**
 * Registers `list`/`switch`/`off`. Handlers never throw: failures come back as
 * structured `ok:false` results so a host exception body never reaches the TUI.
 */
export async function registerProfileRpc(ctx: Context, profiles: CrewProfileRuntime): Promise<void> {
  const domain = ctx.rpc
  if (!domain || typeof domain.register !== "function") return
  try {
    await domain.register(crewProfiles, {
      async list() { return safeView(profiles) },
      async switch(raw) {
        const name = object(raw) ? raw.name : undefined
        if (!isProfileName(name)) {
          return {
            ok: false,
            changed: false,
            code: "INVALID_NAME",
            message: profileNameError(name),
            warnings: [],
            profiles: safeView(profiles),
          }
        }
        try { return toSwitchView(await profiles.switch(name)) } catch {
          return { ok: false, changed: false, code: "HOST_ERROR", message: HOST_ERROR_MESSAGE, warnings: [], profiles: safeView(profiles) }
        }
      },
      async off() {
        try { return toSwitchView(await profiles.off()) } catch {
          return { ok: false, changed: false, code: "HOST_ERROR", message: HOST_ERROR_MESSAGE, warnings: [], profiles: safeView(profiles) }
        }
      },
    })
  } catch {
    // A host without a usable rpc domain must still get a working plugin.
  }
}
