import { describe, expect, test } from 'bun:test'
import {
  REPORT_STATUSES,
  REPORT_STATUS_PROMPT_HINT,
  extractReportStatus,
  isReportStatus,
  parseReportStatus,
} from '../src/report-status'

describe('report-status', () => {
  test('six canonical statuses', () => {
    expect([...REPORT_STATUSES]).toEqual([
      'progress',
      'waiting',
      'ready',
      'blocked',
      'failed',
      'dropped',
    ])
  })

  test('isReportStatus accepts only the six', () => {
    for (const s of REPORT_STATUSES) expect(isReportStatus(s)).toBe(true)
    expect(isReportStatus('COMPLETE')).toBe(false)
    expect(isReportStatus('ready ')).toBe(false)
    expect(isReportStatus(null)).toBe(false)
    expect(isReportStatus(1)).toBe(false)
  })

  test('parseReportStatus maps legacy aliases', () => {
    expect(parseReportStatus('ready')).toBe('ready')
    expect(parseReportStatus(' READY ')).toBe('ready')
    expect(parseReportStatus('COMPLETE')).toBe('ready')
    expect(parseReportStatus('blocked')).toBe('blocked')
    expect(parseReportStatus('BLOCKED')).toBe('blocked')
    expect(parseReportStatus('INCOMPLETE')).toBe('progress')
    expect(parseReportStatus('nope')).toBeUndefined()
    expect(parseReportStatus(undefined)).toBeUndefined()
  })

  test('extractReportStatus reads Report line', () => {
    expect(extractReportStatus('Report: ready\nfiles: a.ts')).toBe('ready')
    expect(extractReportStatus('done.\nReport: blocked\nevidence: conflict')).toBe('blocked')
    expect(extractReportStatus('Report: COMPLETE')).toBe('ready')
    expect(extractReportStatus('no status here')).toBeUndefined()
    expect(extractReportStatus('prefix Report: ready')).toBeUndefined()
  })

  test('prompt hint names all six statuses', () => {
    for (const s of REPORT_STATUSES) expect(REPORT_STATUS_PROMPT_HINT).toContain(s)
    expect(REPORT_STATUS_PROMPT_HINT).toContain('Report:')
  })
})
