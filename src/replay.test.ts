import { describe, expect, test } from 'vitest'
import { replayOrder } from './replay'
import type { Span } from './trace'

function span(partial: Partial<Span> & Pick<Span, 'id'>): Span {
  return {
    parentId: null,
    kind: 'tool',
    name: partial.id,
    status: 'ok',
    startMs: 0,
    endMs: 0,
    attributes: {},
    ...partial,
  }
}

const spans: Span[] = [
  span({ id: 'root', kind: 'agent', startMs: 0 }),
  span({ id: 'llm-2', parentId: 'root', kind: 'llm', startMs: 5 }),
  span({ id: 'llm-1', parentId: 'root', kind: 'llm', startMs: 0 }),
  span({ id: 'tool-b', parentId: 'llm-1', startMs: 20 }),
  span({ id: 'tool-a', parentId: 'llm-1', startMs: 10 }),
]

describe('replayOrder — DFS pre-order, siblings sorted by startMs', () => {
  test('parent precedes its children; siblings ordered by startMs', () => {
    expect(replayOrder(spans)).toEqual(['root', 'llm-1', 'tool-a', 'tool-b', 'llm-2'])
  })
  test('every span appears exactly once', () => {
    const order = replayOrder(spans)
    expect(order).toHaveLength(spans.length)
    expect(new Set(order).size).toBe(spans.length)
  })
  test('a parent always comes before every one of its descendants', () => {
    const order = replayOrder(spans)
    const at = (id: string) => order.indexOf(id)
    for (const s of spans) {
      if (s.parentId !== null) expect(at(s.parentId)).toBeLessThan(at(s.id))
    }
  })
  test('empty trace yields empty order', () => {
    expect(replayOrder([])).toEqual([])
  })
})
