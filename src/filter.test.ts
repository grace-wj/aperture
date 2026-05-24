import { describe, expect, test } from 'vitest'
import {
  EMPTY_FILTER,
  buildHaystack,
  expandToReveal,
  isFilterActive,
  matchSpan,
  type Filter,
} from './filter'
import type { Span } from './trace'

function span(partial: Partial<Span> & Pick<Span, 'id' | 'kind' | 'name'>): Span {
  return {
    parentId: null,
    status: 'ok',
    startMs: 0,
    endMs: 0,
    attributes: {},
    ...partial,
  }
}

const spans: Span[] = [
  span({ id: 'root', kind: 'agent', name: 'session' }),
  span({
    id: 'llm-1',
    parentId: 'root',
    kind: 'llm',
    name: 'claude-sonnet',
    attributes: {
      content: [
        { type: 'text', text: 'Looking up order 42 now' },
        { type: 'thinking', thinking: 'user wants their refund' },
      ],
    },
  }),
  span({
    id: 'tool-1',
    parentId: 'llm-1',
    kind: 'tool',
    name: 'lookup_order',
    attributes: { input: { order_id: 42 }, result: 'shipped' },
  }),
  span({
    id: 'tool-2',
    parentId: 'llm-1',
    kind: 'tool',
    name: 'send_email',
    status: 'error',
    attributes: { input: { to: 'a@b.com' }, result: 'smtp timeout' },
  }),
]

describe('isFilterActive', () => {
  test('empty filter is inactive', () => {
    expect(isFilterActive(EMPTY_FILTER)).toBe(false)
  })
  test('whitespace-only query is inactive', () => {
    expect(isFilterActive({ ...EMPTY_FILTER, query: '   ' })).toBe(false)
  })
  test('any non-empty dimension activates', () => {
    expect(isFilterActive({ ...EMPTY_FILTER, query: 'x' })).toBe(true)
    expect(isFilterActive({ ...EMPTY_FILTER, kinds: new Set(['llm']) })).toBe(true)
    expect(isFilterActive({ ...EMPTY_FILTER, errorsOnly: true })).toBe(true)
  })
})

describe('buildHaystack', () => {
  const h = buildHaystack(spans)

  test('includes span name, lowercased', () => {
    expect(h.get('tool-1')).toContain('lookup_order')
  })
  test('includes LLM text and thinking blocks', () => {
    expect(h.get('llm-1')).toContain('looking up order 42')
    expect(h.get('llm-1')).toContain('user wants their refund')
  })
  test('includes JSON-stringified tool input and result', () => {
    expect(h.get('tool-1')).toContain('"order_id":42')
    expect(h.get('tool-1')).toContain('shipped')
  })
  test('output is lowercased so query can be lowercased once', () => {
    const value = h.get('llm-1')!
    expect(value).toBe(value.toLowerCase())
  })
})

describe('matchSpan — AND semantics across dimensions', () => {
  const h = buildHaystack(spans)
  const noFilter: Pick<Filter, 'kinds' | 'errorsOnly'> = { kinds: new Set(), errorsOnly: false }

  test('empty filter + empty query matches everything', () => {
    for (const s of spans) expect(matchSpan(s, '', noFilter, h)).toBe(true)
  })
  test('query matches only spans whose haystack contains it', () => {
    const tool1 = spans.find((s) => s.id === 'tool-1')!
    const tool2 = spans.find((s) => s.id === 'tool-2')!
    expect(matchSpan(tool1, 'order', noFilter, h)).toBe(true)
    expect(matchSpan(tool2, 'order', noFilter, h)).toBe(false)
  })
  test('kind filter restricts to listed kinds', () => {
    const filter = { kinds: new Set<Span['kind']>(['tool']), errorsOnly: false }
    expect(matchSpan(spans[0], '', filter, h)).toBe(false) // agent
    expect(matchSpan(spans[1], '', filter, h)).toBe(false) // llm
    expect(matchSpan(spans[2], '', filter, h)).toBe(true) // tool
  })
  test('errorsOnly restricts to error status', () => {
    const filter = { kinds: new Set<Span['kind']>(), errorsOnly: true }
    expect(matchSpan(spans[2], '', filter, h)).toBe(false) // ok
    expect(matchSpan(spans[3], '', filter, h)).toBe(true) // error
  })
  test('AND across all dimensions: query AND kind AND errorsOnly', () => {
    const filter = { kinds: new Set<Span['kind']>(['tool']), errorsOnly: true }
    // tool-1 is tool+ok+contains "order" → fails errorsOnly
    expect(matchSpan(spans[2], 'order', filter, h)).toBe(false)
    // tool-2 is tool+error but doesn't contain "order"
    expect(matchSpan(spans[3], 'order', filter, h)).toBe(false)
    // tool-2 is tool+error and contains "smtp"
    expect(matchSpan(spans[3], 'smtp', filter, h)).toBe(true)
  })
})

describe('expandToReveal — strict ancestors of target spans', () => {
  test('returns ancestors but not the target itself', () => {
    const ancestors = expandToReveal(new Set(['tool-1']), spans)
    expect(ancestors.has('tool-1')).toBe(false)
    expect(ancestors.has('llm-1')).toBe(true)
    expect(ancestors.has('root')).toBe(true)
  })
  test('root has no ancestors', () => {
    expect(expandToReveal(new Set(['root']), spans).size).toBe(0)
  })
  test('multiple targets union their ancestor chains without duplication', () => {
    const ancestors = expandToReveal(new Set(['tool-1', 'tool-2']), spans)
    expect(ancestors.size).toBe(2) // llm-1 + root, deduped
    expect(ancestors.has('llm-1')).toBe(true)
    expect(ancestors.has('root')).toBe(true)
  })
  test('unknown target ids are skipped silently', () => {
    expect(expandToReveal(new Set(['ghost', 'tool-1']), spans).has('llm-1')).toBe(true)
  })
  test('empty target set returns empty', () => {
    expect(expandToReveal(new Set(), spans).size).toBe(0)
  })
})
