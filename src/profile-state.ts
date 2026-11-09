// Runtime composition of the effective Crew configuration: the `active` pointer on
// disk is the single source of truth. Nothing is cached, so editing a profile file is
// visible to the next `config()` call and multiple instances stay aligned.

import { isProfileName, profileNameError, type CrewConfig, type ModelRef, type RoleID } from "./config"
import {
  findProfile,
  loadProfiles,
  profileDirs,
  readActive,
  writeActive,
  type ActivePointer,
  type ProfileFs,
  type ProfileRoot,
  type ProfileSet,
} from "./profiles"

export type CrewProfilesInfo = {
  /** The profile actually in effect; null = run from opencode.json. */
  active: string | null
  /** Pointer content, reported even when it is invalid, so `list` can explain it. */
  requested: string | null
  /** Fallback reason (readable Chinese); null when nothing fell back. */
  error: string | null
  /** Effective configuration (baseline or profile). */
  config: CrewConfig
  set: ProfileSet
}

export type CrewSwitchCode =
  | "INVALID_NAME" | "NOT_FOUND" | "INVALID_PROFILE" | "WRITE_FAILED" | "APPLY_FAILED" | "HOST_ERROR"

export type CrewSwitchResult = {
  ok: boolean
  active: string | null
  changed: boolean
  code?: CrewSwitchCode
  message?: string
  warnings: string[]
  info: CrewProfilesInfo
}

export type CrewProfileRuntime = {
  config(): CrewConfig
  info(): CrewProfilesInfo
  switch(name: string): Promise<CrewSwitchResult>
  off(): Promise<CrewSwitchResult>
}

export type CrewProfilesDeps = {
  baseline: CrewConfig
  env?: NodeJS.ProcessEnv
  fs?: ProfileFs
  dirs?: ProfileRoot[]
  /** Defaults to `() => ctx.agent.reload()`; tests inject to count calls. */
  reload?: () => Promise<void>
  now?: () => number
}

export const RELOAD_WARNING = "配置已切换，但宿主 agent 重载失败；将在下次宿主动作后生效"

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))
const emptySet = (dirs: ProfileRoot[] = []): ProfileSet => ({ profiles: [], errors: [], dirs })
const fallback = (baseline: CrewConfig, reason: string, set: ProfileSet = emptySet(), requested: string | null = null): CrewProfilesInfo =>
  ({ active: null, requested, error: `${reason}；已回退到 opencode.json 配置`, config: baseline, set })

const modelKey = (model: ModelRef | undefined) =>
  model ? `${model.providerID}/${model.id}${model.variant ? `#${model.variant}` : ""}` : ""
/** Stable signature over exactly the three profile-writable fields. */
const signature = (config: CrewConfig) => JSON.stringify({
  models: Object.keys(config.models).sort().map(id => [id, modelKey(config.models[id as RoleID])]),
  steps: Object.keys(config.steps).sort().map(id => [id, config.steps[id as RoleID]]),
  engineerInstructions: config.engineerInstructions,
})
const sameConfig = (a: CrewConfig, b: CrewConfig) => signature(a) === signature(b)

/** Pure read of pointer + profile; never throws. */
function resolve(baseline: CrewConfig, fs: ProfileFs | undefined, dirs: ProfileRoot[]): CrewProfilesInfo {
  const deps = fs ? { fs, dirs } : { dirs }
  let set: ProfileSet
  try { set = loadProfiles(deps) } catch (error) {
    return fallback(baseline, `读取档目录失败：${message(error)}`)
  }
  let pointer: ActivePointer
  try { pointer = readActive(deps) } catch (error) {
    return fallback(baseline, `读取 active 指针失败：${message(error)}`, set)
  }
  const requested = pointer.name ?? (pointer.raw?.trim() ? pointer.raw.trim() : null)
  if (pointer.error) return fallback(baseline, pointer.error, set, requested)
  if (!pointer.name) return { active: null, requested, error: null, config: baseline, set }
  const lookup = findProfile(set, pointer.name)
  if (lookup.ok) return { active: pointer.name, requested: pointer.name, error: null, config: lookup.profile.config, set }
  const names = set.profiles.map(profile => profile.name)
  const available = names.length ? `可用档：${names.join(", ")}` : "当前没有可用档"
  // A directory that could not be scanned explains the miss better than "not found".
  const dirError = set.errors.find(error => error.kind === "unreadable" && !error.name)
  const reason = lookup.error.kind === "not-found"
    ? `${dirError ? `${dirError.message}。` : ""}active 档 "${pointer.name}" 不存在`
    : `active 档 "${pointer.name}" 校验失败：${lookup.error.message}`
  return fallback(baseline, `${reason}。${available}`, set, pointer.name)
}

export function createCrewProfiles(deps: CrewProfilesDeps): CrewProfileRuntime {
  const roots = () => deps.dirs ?? profileDirs(deps.env ?? process.env)
  const readDeps = (dirs: ProfileRoot[]) => (deps.fs ? { fs: deps.fs, dirs } : { dirs })

  const info = (): CrewProfilesInfo => {
    try { return resolve(deps.baseline, deps.fs, roots()) } catch (error) {
      return fallback(deps.baseline, `读取档目录失败：${message(error)}`)
    }
  }
  const config = () => info().config

  const reload = async (): Promise<string[]> => {
    if (!deps.reload) return [RELOAD_WARNING]
    try { await deps.reload(); return [] } catch { return [RELOAD_WARNING] }
  }

  const result = (state: CrewProfilesInfo, patch: Partial<CrewSwitchResult>): CrewSwitchResult => ({
    ok: patch.ok ?? false,
    active: state.active,
    changed: patch.changed ?? false,
    warnings: patch.warnings ?? [],
    ...(patch.code ? { code: patch.code } : {}),
    ...(patch.message ? { message: patch.message } : {}),
    info: state,
  })

  async function switchProfile(name: string): Promise<CrewSwitchResult> {
    const dirs = roots()
    const read = readDeps(dirs)
    if (!isProfileName(name)) return result(info(), { code: "INVALID_NAME", message: profileNameError(name) })
    let set: ProfileSet
    try { set = loadProfiles(read) } catch (error) {
      return result(info(), { code: "HOST_ERROR", message: `读取档目录失败：${message(error)}` })
    }
    const lookup = findProfile(set, name)
    if (!lookup.ok) {
      if (lookup.error.kind === "not-found") {
        const names = set.profiles.map(profile => profile.name)
        return result(info(), {
          code: "NOT_FOUND",
          message: `档 "${name}" 不存在。${names.length ? `可用档：${names.join(", ")}` : "当前没有可用档"}`,
        })
      }
      return result(info(), { code: "INVALID_PROFILE", message: lookup.error.message })
    }
    const before = info()
    // Re-writing an unchanged pointer would only add churn; compare content too so a
    // hand-edited profile file still reloads on an explicit switch.
    const changed = before.active !== name || !sameConfig(before.config, lookup.profile.config)
    if (changed) {
      try { writeActive(name, read) } catch (error) {
        return result(before, {
          changed: false,
          code: "WRITE_FAILED",
          message: `写入 active 指针失败：${message(error)}；内存与 agent 定义未改变。`,
        })
      }
    }
    const after = info()
    if (after.active !== name || after.error) {
      return result(after, {
        changed,
        code: "APPLY_FAILED",
        message: after.error ?? `active 指针已写入 "${name}"，但重新读取结果不一致；请人工检查档目录。`,
      })
    }
    const warnings = changed ? await reload() : []
    return result(after, { ok: true, changed, warnings })
  }

  async function off(): Promise<CrewSwitchResult> {
    const dirs = roots()
    const read = readDeps(dirs)
    let pointer: ActivePointer
    try { pointer = readActive(read) } catch (error) {
      return result(info(), { code: "HOST_ERROR", message: `读取 active 指针失败：${message(error)}` })
    }
    // "off" is decided by whether the pointer file exists, not by its parsed name:
    // blank or invalid content still counts as an existing pointer and must be cleared.
    const changed = pointer.raw !== null || pointer.error !== null
    if (changed) {
      try { writeActive(null, read) } catch (error) {
        return result(info(), {
          changed: false,
          code: "WRITE_FAILED",
          message: `删除 active 指针失败：${message(error)}；内存与 agent 定义未改变。`,
        })
      }
    }
    const after = info()
    if (after.active !== null || after.error) {
      return result(after, {
        changed,
        code: "APPLY_FAILED",
        message: after.error ?? "active 指针已删除，但重新读取仍指向档；请人工检查档目录。",
      })
    }
    const warnings = changed ? await reload() : []
    return result(after, { ok: true, changed, warnings })
  }

  return { config, info, switch: switchProfile, off }
}
