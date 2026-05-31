import type { ContentBlock, Span } from './trace'

export type DiffOp = 'same' | 'add' | 'del'
export type DiffLine = { op: DiffOp; text: string }

// The previous LLM turn in the same agent context (same parentId), in execution order.
// Same parentId keeps the comparison within one loop — a subagent's turns don't diff
// against the main agent's. spans is in adapter insertion order, i.e. execution order.
export function previousTurn(span: Span, spans: Span[]): Span | null {
  if (span.kind !== 'llm') return null
  const idx = spans.findIndex((s) => s.id === span.id)
  for (let i = idx - 1; i >= 0; i--) {
    const s = spans[i]
    if (s.kind === 'llm' && s.parentId === span.parentId) return s
  }
  return null
}

// Tool args are pretty-printed line-per-field so a single changed argument diffs as a
// single changed line rather than a whole-call replacement.
export function serializeTurn(span: Span): string[] {
  const blocks = (span.attributes.content as ContentBlock[] | undefined) ?? []
  const lines: string[] = []
  for (const b of blocks) {
    if (b.type === 'thinking') {
      lines.push('[thinking]')
      lines.push(...(b.thinking ?? '').split('\n'))
    } else if (b.type === 'text') {
      lines.push('[text]')
      lines.push(...(b.text ?? '').split('\n'))
    } else if (b.type === 'tool_use') {
      lines.push(`→ ${b.name ?? 'tool'}`)
      lines.push(...JSON.stringify(b.input ?? null, null, 2).split('\n'))
    } else {
      // Mirror ContentBlockView's unknown-block fallback so e.g. redacted_thinking
      // shows up in the diff instead of silently vanishing.
      lines.push(`[${b.type}]`)
      lines.push(...JSON.stringify(b, null, 2).split('\n'))
    }
  }
  return lines
}

// Line-level LCS diff. `a` is the previous turn, `b` the current one: `del` lines were
// dropped since the previous turn, `add` lines are new in the current turn.
export function diffLines(a: string[], b: string[]): DiffLine[] {
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ op: 'same', text: a[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ op: 'del', text: a[i] })
      i++
    } else {
      out.push({ op: 'add', text: b[j] })
      j++
    }
  }
  while (i < n) out.push({ op: 'del', text: a[i++] })
  while (j < m) out.push({ op: 'add', text: b[j++] })
  return out
}
