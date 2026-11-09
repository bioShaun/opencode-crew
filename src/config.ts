// Crew configuration contract shared by plugin options and profile files.
// Pure module: no node:* imports, so the TUI bundle can reuse the validators.

export const IDS = ["root", "architect", "engineer", "explorer", "reviewer"] as const
export type RoleID = typeof IDS[number]
export type ModelRef = { providerID: string; id: string; variant?: string }

export type CrewConfig = {
  models: Partial<Record<RoleID, ModelRef>>
  steps: Partial<Record<RoleID, number>>
  engineerInstructions: string[]
}

/** Error message label: the same validation reports either `options.*` or `档 "fast" 的 *`. */
export type ConfigLabel = { subject: string; path(field: string): string }

export const optionsLabel: ConfigLabel = {
  subject: "options",
  path: field => `options.${field}`,
}

export function profileLabel(name: string): ConfigLabel {
  return {
    subject: `档 "${name}"`,
    path: field => `档 "${name}" 的 ${field}`,
  }
}

export function fail(message: string): never { throw new Error(`[opencode-crew] ${message}`) }

export function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function instructions(value: unknown, label: ConfigLabel): string[] {
  const field = label.path("engineerInstructions")
  if (value === undefined) return []
  if (!Array.isArray(value)) fail(`${field} 必须是字符串数组`)
  if (value.length > 32) fail(`${field} 最多 32 项`)
  let total = 0
  const out = value.map((item, index) => {
    if (typeof item !== "string") fail(`${field}[${index}] 必须为字符串`)
    if (/[\r\n]/.test(item)) fail(`${field}[${index}] 不能包含换行`)
    const text = item.trim()
    if (!text) fail(`${field}[${index}] 不能为空`)
    if (text.length > 2000) fail(`${field}[${index}] 最多 2000 字符`)
    total += text.length
    return text
  })
  if (total > 8000) fail(`${field} 总长度最多 8000 字符`)
  return out
}

/** Former `options()` in src/index.ts: identical semantics, parameterized error prefix. */
export function parseCrewConfig(input: unknown, label: ConfigLabel = optionsLabel): CrewConfig {
  if (!object(input)) fail(`${label.subject} 必须是对象`)
  for (const key of Object.keys(input)) if (!["models", "steps", "engineerInstructions"].includes(key)) fail(`未知 ${label.path(key)}`)
  const models: Partial<Record<RoleID, ModelRef>> = {}, steps: Partial<Record<RoleID, number>> = {}
  for (const field of ["models", "steps"] as const) {
    const map = input[field] ?? {}
    if (!object(map)) fail(`${label.path(field)} 必须是角色映射`)
    for (const [id, value] of Object.entries(map)) {
      if (!IDS.includes(id as RoleID)) fail(`未知角色 ${label.path(field)}.${id}`)
      if (field === "steps") {
        if (!Number.isSafeInteger(value) || (value as number) <= 0) fail(`${label.path("steps")}.${id} 必须为正整数`)
        steps[id as RoleID] = value as number
      } else {
        if (typeof value !== "string" || !/^[^\s/#]+\/[^\s#]+(?:#[^\s#]+)?$/.test(value)) {
          fail(`${label.path("models")}.${id} 必须为 provider/model[#variant]；省略即可继承会话模型`)
        }
        const [left, variant] = value.split("#"), slash = left.indexOf("/")
        models[id as RoleID] = { providerID: left.slice(0, slash), id: left.slice(slash + 1), ...(variant ? { variant } : {}) }
      }
    }
  }
  return { models, steps, engineerInstructions: instructions(input.engineerInstructions, label) }
}

// --- Profile names -----------------------------------------------------------
// Kept here (pure) so the TUI bundle can validate names without pulling node:fs.
// The whitelist has no path separator, so `join(dir, name + ".json")` cannot escape.

export const PROFILE_NAME_MAX = 64
export const PROFILE_NAME_PATTERN = /^(?!\.)(?=.*[a-z0-9])[a-z0-9._-]{1,64}$/

export function isProfileName(name: unknown): name is string {
  return typeof name === "string" && PROFILE_NAME_PATTERN.test(name)
}

export function profileNameError(name: unknown): string {
  return `档名 "${String(name)}" 不合法（只允许小写字母 a-z、数字 0-9 与 . _ -，至少含一个字母或数字，最多 ${PROFILE_NAME_MAX} 字符）`
}

export function assertProfileName(name: string): void {
  if (!isProfileName(name)) fail(profileNameError(name))
}
