import { describe, expect, test } from 'bun:test'
import {
  MODEL_FAMILY_TASK_HINTS,
  composeRoleSystem,
  detectModelFamily,
  modelFamilyTaskHint,
  selectRoleAppendix,
  splitRoleBody,
} from '../src/model-family'

describe('model-family', () => {
  test('detectModelFamily recognizes GPT first', () => {
    expect(detectModelFamily('openai/gpt-4o')).toBe('gpt')
    expect(detectModelFamily({ providerID: 'openai', id: 'gpt-5', variant: 'high' })).toBe('gpt')
    expect(detectModelFamily('azure/gpt-4.1')).toBe('gpt')
    expect(detectModelFamily('openai/o3-mini')).toBe('gpt')
    expect(detectModelFamily('openai/codex-mini')).toBe('gpt')
    expect(detectModelFamily('anthropic/claude-sonnet-4')).toBe('claude')
    expect(detectModelFamily({ providerID: 'anthropic', id: 'claude-opus-4' })).toBe('claude')
    expect(detectModelFamily('example/root#high')).toBe('unknown')
    expect(detectModelFamily(undefined)).toBe('unknown')
    expect(detectModelFamily(null)).toBe('unknown')
  })

  test('splitRoleBody strips appendices from base', () => {
    const body = [
      '共享契约。',
      '',
      '## 附录 · GPT / principle（选用）',
      '',
      'GPT 原则。',
      '',
      '## 附录 · Claude / mechanics（选用）',
      '',
      'Claude 清单。',
    ].join('\n')
    const split = splitRoleBody(body)
    expect(split.base).toBe('共享契约。')
    expect(split.gpt).toContain('GPT 原则')
    expect(split.claude).toContain('Claude 清单')
    expect(split.base).not.toContain('附录')
  })

  test('composeRoleSystem injects GPT appendix when model is GPT', () => {
    const appendices = { gpt: '## 附录 · GPT\nshort', claude: '## 附录 · Claude\nlist' }
    expect(composeRoleSystem('base', appendices, 'openai/gpt-4o')).toContain('short')
    expect(composeRoleSystem('base', appendices, 'openai/gpt-4o')).not.toContain('list')
    expect(composeRoleSystem('base', appendices, 'anthropic/claude-3')).toContain('list')
    expect(composeRoleSystem('base', appendices, 'example/worker')).toBe('base')
    expect(selectRoleAppendix(appendices, undefined)).toBe('')
  })

  test('task hints are short and family-specific', () => {
    expect(modelFamilyTaskHint('openai/gpt-4o')).toBe(MODEL_FAMILY_TASK_HINTS.gpt)
    expect(modelFamilyTaskHint('anthropic/claude-sonnet-4')).toBe(MODEL_FAMILY_TASK_HINTS.claude)
    expect(modelFamilyTaskHint('owner/model')).toBe('')
    expect(MODEL_FAMILY_TASK_HINTS.gpt.length).toBeLessThan(400)
    expect(MODEL_FAMILY_TASK_HINTS.claude.length).toBeLessThan(400)
    expect(MODEL_FAMILY_TASK_HINTS.gpt).toContain('principle')
    expect(MODEL_FAMILY_TASK_HINTS.claude).toContain('mechanics')
  })
})
