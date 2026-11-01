/** Lightweight model-family prompt hints (not OmO dual-track presets). */

export type ModelFamily = 'gpt' | 'claude' | 'unknown'

export type ModelRefLike = { providerID: string; id: string; variant?: string } | string | null | undefined

export type RoleAppendices = { gpt?: string; claude?: string }

/** Split role markdown body into shared contract + optional family appendices. */
export function splitRoleBody(body: string): { base: string } & RoleAppendices {
  const text = body.trim()
  const idx = text.search(/^## 附录/m)
  if (idx < 0) return { base: text }
  const base = text.slice(0, idx).trim()
  const rest = text.slice(idx)
  const parts = rest.split(/(?=^## 附录)/m).filter(Boolean)
  const out: { base: string } & RoleAppendices = { base }
  for (const part of parts) {
    const title = (part.split('\n')[0] ?? '').toLowerCase()
    const block = part.trim()
    if (/gpt|principle/.test(title)) out.gpt = block
    else if (/claude|mechanics/.test(title)) out.claude = block
  }
  return out
}

/** Detect GPT vs Claude from provider/model id. Prefer GPT when ambiguous. */
export function detectModelFamily(model?: ModelRefLike): ModelFamily {
  if (!model) return 'unknown'
  const raw = typeof model === 'string'
    ? model
    : `${model.providerID}/${model.id}${model.variant ? `#${model.variant}` : ''}`
  const s = raw.toLowerCase()
  // GPT family first (user priority): OpenAI, GPT-*, ChatGPT, o-series, Codex.
  if (/(?:^|\/|[_-])(?:openai|chatgpt|codex)(?:\/|[_-]|$)/.test(s) || /(?:^|\/|[_-])gpt(?:[-_.]|$)/.test(s) || /(?:^|\/|[_-])o[1-9](?:[-_.]|$)/.test(s)) {
    return 'gpt'
  }
  if (s.includes('openai') || s.includes('chatgpt') || /\bgpt[-_]?\d/.test(s) || /\bo[1-9][-_]/.test(s) || s.includes('codex')) {
    return 'gpt'
  }
  if (s.includes('anthropic') || s.includes('claude')) return 'claude'
  return 'unknown'
}

/** Short task-prompt hints for crew_task_start (not full role appendices). GPT prioritized. */
export const MODEL_FAMILY_TASK_HINTS = {
  gpt: [
    'Model style (GPT/principle): treat Scope as a hard boundary;',
    'prefer short principles and explicit Report: <status> (progress|waiting|ready|blocked|failed|dropped) over long checklists;',
    'hand back on ambiguity—do not expand Mandate.',
  ].join(' '),
  claude: [
    'Model style (Claude/mechanics): walk Goal/Scope/Decided/Approach/Acceptance/Check as an explicit checklist;',
    'keep evidence paths; return Report: <status> (progress|waiting|ready|blocked|failed|dropped) clearly.',
  ].join(' '),
} as const

export function modelFamilyTaskHint(model?: ModelRefLike): string {
  const family = detectModelFamily(model)
  if (family === 'unknown') return ''
  return MODEL_FAMILY_TASK_HINTS[family]
}

/** Pick optional role appendix for a configured model; empty when unknown/omitted. */
export function selectRoleAppendix(appendices: RoleAppendices, model?: ModelRefLike): string {
  const family = detectModelFamily(model)
  if (family === 'gpt') return appendices.gpt ?? ''
  if (family === 'claude') return appendices.claude ?? ''
  return ''
}

/** Compose the optional project-instruction section appended after role appendices. */
export function composeProjectInstructions(instructions?: readonly string[]): string {
  if (!instructions || instructions.length === 0) return ''
  return `## 项目补充规则\n\n${instructions.map(item => `- ${item}`).join('\n')}`
}

/** Compose system prompt: shared base + optional matching appendix + optional project section. */
export function composeRoleSystem(base: string, appendices: RoleAppendices, model?: ModelRefLike, instructions?: readonly string[]): string {
  const appendix = selectRoleAppendix(appendices, model)
  const project = composeProjectInstructions(instructions)
  return [base, appendix, project].filter(Boolean).join('\n\n')
}
