import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { computeLanes } from './lanes'
import { parseTraceJson, type Span } from './trace'

function span(partial: Partial<Span> & Pick<Span, 'id' | 'startMs' | 'endMs'>): Span {
  return { parentId: 'root', kind: 'tool', name: partial.id, status: 'ok', attributes: {}, ...partial }
}

const FIXTURES = [
  'samples/canonical.json',
  'samples/real-parallel-error.json',
  'samples/real-nested-subagents.json',
  'samples/real-long-run.json',
]

describe.each(FIXTURES)('computeLanes — %s', (file) => {
  const trace = parseTraceJson(readFileSync(file, 'utf-8'))
  const { laneOf } = computeLanes(trace.spans)

  test('no two spans sharing a lane overlap in time', () => {
    const byLane = new Map<number, Span[]>()
    for (const s of trace.spans) {
      const lane = laneOf.get(s.id)!
      const arr = byLane.get(lane)
      if (arr) arr.push(s)
      else byLane.set(lane, [s])
    }
    for (const arr of byLane.values()) {
      const sorted = arr.slice().sort((a, b) => a.startMs - b.startMs)
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i].startMs).toBeGreaterThanOrEqual(sorted[i - 1].endMs)
      }
    }
  })

  test('every span gets a lane', () => {
    for (const s of trace.spans) expect(laneOf.has(s.id)).toBe(true)
  })
})

describe('computeLanes — packing behaviour', () => {
  const root = span({ id: 'root', parentId: null, kind: 'agent', startMs: 0, endMs: 100 })

  test('sequential siblings collapse onto one lane', () => {
    const spans = [
      root,
      span({ id: 'a', startMs: 0, endMs: 10 }),
      span({ id: 'b', startMs: 10, endMs: 20 }),
      span({ id: 'c', startMs: 20, endMs: 30 }),
    ]
    const { laneOf, maxLane } = computeLanes(spans)
    expect(laneOf.get('a')).toBe(laneOf.get('b'))
    expect(laneOf.get('b')).toBe(laneOf.get('c'))
    expect(maxLane).toBe(1) // root on lane 0, the three sequential siblings share lane 1
  })

  test('overlapping siblings get distinct sub-lanes', () => {
    const spans = [
      root,
      span({ id: 'a', startMs: 0, endMs: 30 }),
      span({ id: 'b', startMs: 5, endMs: 25 }),
      span({ id: 'c', startMs: 10, endMs: 20 }),
    ]
    const lanes = computeLanes(spans).laneOf
    expect(new Set([lanes.get('a'), lanes.get('b'), lanes.get('c')]).size).toBe(3)
  })
})
