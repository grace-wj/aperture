import type { ContentBlock, Span, SpanKind } from './trace'

export type Filter = {
  query: string
  kinds: Set<SpanKind>
  errorsOnly: boolean
}

export const EMPTY_FILTER: Filter = { query: '', kinds: new Set(), errorsOnly: false }

export function isFilterActive(f: Filter): boolean {
  return f.query.trim().length > 0 || f.kinds.size > 0 || f.errorsOnly
}

export function buildHaystack(spans: Span[]): Map<string, string> {
  const m = new Map<string, string>()
  for (const span of spans) {
    const parts: string[] = [span.name]
    const a = span.attributes as Record<string, unknown>
    if (span.kind === 'llm' && Array.isArray(a.content)) {
      for (const b of a.content as ContentBlock[]) {
        if (typeof b.text === 'string') parts.push(b.text)
        if (typeof b.thinking === 'string') parts.push(b.thinking)
      }
    }
    if (a.input !== undefined) parts.push(JSON.stringify(a.input))
    if (a.result !== undefined) parts.push(JSON.stringify(a.result))
    m.set(span.id, parts.join('\n').toLowerCase())
  }
  return m
}

export function matchSpan(
  span: Span,
  queryLower: string,
  filter: Pick<Filter, 'kinds' | 'errorsOnly'>,
  haystack: Map<string, string>,
): boolean {
  if (filter.kinds.size > 0 && !filter.kinds.has(span.kind)) return false
  if (filter.errorsOnly && span.status !== 'error') return false
  if (queryLower.length > 0 && !haystack.get(span.id)?.includes(queryLower)) return false
  return true
}

export function expandToReveal(targets: Set<string>, spans: Span[]): Set<string> {
  const byId = new Map(spans.map((s) => [s.id, s]))
  const ancestors = new Set<string>()
  for (const targetId of targets) {
    const target = byId.get(targetId)
    if (!target) continue
    let parentId = target.parentId
    while (parentId !== null) {
      if (ancestors.has(parentId)) break
      ancestors.add(parentId)
      const parent = byId.get(parentId)
      if (!parent) break
      parentId = parent.parentId
    }
  }
  return ancestors
}
