import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseTraceJson, type Span } from './trace'
import { diffLines, previousTurn, serializeTurn } from './turn-diff'

function llm(id: string, parentId: string | null, content: unknown[]): Span {
  return {
    id,
    parentId,
    kind: 'llm',
    name: 'llm',
    status: 'ok',
    startMs: 0,
    endMs: 0,
    attributes: { content },
  }
}

describe('diffLines', () => {
  it('marks identical input as all same', () => {
    const d = diffLines(['a', 'b'], ['a', 'b'])
    expect(d.every((l) => l.op === 'same')).toBe(true)
  })

  it('reports a mid-sequence change as del + add', () => {
    const d = diffLines(['a', 'x', 'c'], ['a', 'y', 'c'])
    expect(d).toEqual([
      { op: 'same', text: 'a' },
      { op: 'del', text: 'x' },
      { op: 'add', text: 'y' },
      { op: 'same', text: 'c' },
    ])
  })

  it('handles pure addition and pure deletion', () => {
    expect(diffLines([], ['a'])).toEqual([{ op: 'add', text: 'a' }])
    expect(diffLines(['a'], [])).toEqual([{ op: 'del', text: 'a' }])
  })
})

describe('serializeTurn', () => {
  it('flattens thinking, text, and tool calls with args to lines', () => {
    const span = llm('m1', null, [
      { type: 'thinking', thinking: 'think' },
      { type: 'text', text: 'hello' },
      { type: 'tool_use', name: 'Read', input: { file: 'a' } },
    ])
    expect(serializeTurn(span)).toEqual([
      '[thinking]',
      'think',
      '[text]',
      'hello',
      '→ Read',
      '{',
      '  "file": "a"',
      '}',
    ])
  })

  it('returns [] for a turn with no content', () => {
    expect(serializeTurn(llm('m1', null, []))).toEqual([])
  })

  it('serializes a tool call with no input as null', () => {
    const span = llm('m1', null, [{ type: 'tool_use', name: 'Bash' }])
    expect(serializeTurn(span)).toEqual(['→ Bash', 'null'])
  })

  it('does not silently drop unknown block types', () => {
    const span = llm('m1', null, [{ type: 'redacted_thinking' }])
    expect(serializeTurn(span)[0]).toBe('[redacted_thinking]')
  })
})

describe('the README scenario (repeated tool call, one changed arg)', () => {
  it('reduces to a single changed line', () => {
    const t1 = llm('a', 'root', [{ type: 'tool_use', name: 'lookup_order', input: { order_id: 'A-42' } }])
    const t2 = llm('b', 'root', [{ type: 'tool_use', name: 'lookup_order', input: { order_id: 'A-47' } }])
    const changed = diffLines(serializeTurn(t1), serializeTurn(t2)).filter((l) => l.op !== 'same')
    expect(changed).toEqual([
      { op: 'del', text: '  "order_id": "A-42"' },
      { op: 'add', text: '  "order_id": "A-47"' },
    ])
  })
})

describe('previousTurn', () => {
  const a = llm('a', 'root', [])
  const tool: Span = { ...a, id: 't', kind: 'tool', parentId: 'a' }
  const b = llm('b', 'root', [])
  const sub = llm('sub', 'tool-x', [])
  const c = llm('c', 'root', [])
  const spans = [a, tool, b, sub, c]

  it('finds the prior llm in the same context, skipping tool spans', () => {
    expect(previousTurn(b, spans)?.id).toBe('a')
  })

  it('skips turns from a different agent context (subagent boundary)', () => {
    expect(previousTurn(c, spans)?.id).toBe('b')
  })

  it('returns null for the first turn and for non-llm spans', () => {
    expect(previousTurn(a, spans)).toBeNull()
    expect(previousTurn(tool, spans)).toBeNull()
  })
})

describe('on the canonical fixture', () => {
  const trace = parseTraceJson(readFileSync('samples/canonical.json', 'utf8'))
  const mainTurns = trace.spans.filter((s) => s.kind === 'llm' && s.parentId === trace.id)

  it('diffs the second main-loop turn against the first and finds changes', () => {
    const prev = previousTurn(mainTurns[1], trace.spans)
    expect(prev?.id).toBe(mainTurns[0].id)
    const diff = diffLines(serializeTurn(prev!), serializeTurn(mainTurns[1]))
    expect(diff.some((l) => l.op !== 'same')).toBe(true)
    expect(diff.some((l) => l.op === 'same')).toBe(true)
  })
})
