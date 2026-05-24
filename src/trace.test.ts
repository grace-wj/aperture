import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { parseTraceJson } from './trace'

const canonicalText = readFileSync('samples/canonical.json', 'utf-8')

describe('parseTraceJson — canonical Claude Agent SDK fixture', () => {
  const trace = parseTraceJson(canonicalText)

  test('produces a single agent root with parentId null', () => {
    const roots = trace.spans.filter((s) => s.parentId === null)
    expect(roots).toHaveLength(1)
    expect(roots[0].kind).toBe('agent')
  })

  test('contains both llm and tool spans', () => {
    const kinds = new Set(trace.spans.map((s) => s.kind))
    expect(kinds.has('llm')).toBe(true)
    expect(kinds.has('tool')).toBe(true)
  })

  test('every non-root parentId resolves to a real span', () => {
    const ids = new Set(trace.spans.map((s) => s.id))
    for (const s of trace.spans) {
      if (s.parentId === null) continue
      expect(ids.has(s.parentId)).toBe(true)
    }
  })

  test('every span has endMs >= startMs', () => {
    for (const s of trace.spans) {
      expect(s.endMs).toBeGreaterThanOrEqual(s.startMs)
    }
  })

  test('trace bounds enclose every span', () => {
    for (const s of trace.spans) {
      expect(s.startMs).toBeGreaterThanOrEqual(trace.startMs)
      expect(s.endMs).toBeLessThanOrEqual(trace.endMs)
    }
  })
})
