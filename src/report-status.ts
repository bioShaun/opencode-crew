/** Structured Report statuses aligned with dsh lessons (not Source/Eval/Policy). */
export const REPORT_STATUSES = [
  'progress',
  'waiting',
  'ready',
  'blocked',
  'failed',
  'dropped',
] as const

export type ReportStatus = (typeof REPORT_STATUSES)[number]

const LEGACY_ALIASES: Record<string, ReportStatus> = {
  COMPLETE: 'ready',
  BLOCKED: 'blocked',
  INCOMPLETE: 'progress',
}

export function isReportStatus(value: unknown): value is ReportStatus {
  return typeof value === 'string' && (REPORT_STATUSES as readonly string[]).includes(value)
}

/** Normalize a free-form token (including legacy COMPLETE/BLOCKED/INCOMPLETE) to a Report status. */
export function parseReportStatus(raw: unknown): ReportStatus | undefined {
  if (typeof raw !== 'string') return undefined
  const token = raw.trim()
  if (isReportStatus(token)) return token
  const upper = token.toUpperCase()
  if (upper in LEGACY_ALIASES) return LEGACY_ALIASES[upper]
  const lower = token.toLowerCase()
  if (isReportStatus(lower)) return lower
  return undefined
}

/** Extract `Report: <status>` from engineer reply text (line-start or first segment). */
export function extractReportStatus(text: string): ReportStatus | undefined {
  const match = text.match(/(?:^|\n)\s*Report:\s*([A-Za-z]+)\b/i)
  if (!match) return undefined
  return parseReportStatus(match[1])
}

/** Short block injected into crew_task_start engineer prompts. */
export const REPORT_STATUS_PROMPT_HINT = [
  'Report: 末行或段首必须写 `Report: <status>`，status 仅可为 progress|waiting|ready|blocked|failed|dropped。',
  'Root 验收只认 ready + 证据；blocked/failed 才走人介入；waiting/progress 不冒充完成；dropped 表示无需处理。',
  '旧词 COMPLETE≈ready、BLOCKED≈blocked、INCOMPLETE≈progress，规范词用六态。',
  '超 scope 必须 hand-back：Report: blocked 并附证据，不得自行扩权。',
].join(' ')
