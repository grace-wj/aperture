import type { Span } from './trace'

export function replayOrder(spans: Span[]): string[] {
  const children = new Map<string | null, Span[]>()
  for (const s of spans) {
    const arr = children.get(s.parentId)
    if (arr) arr.push(s)
    else children.set(s.parentId, [s])
  }
  for (const arr of children.values()) arr.sort((a, b) => a.startMs - b.startMs)

  const order: string[] = []
  const walk = (parentId: string | null) => {
    for (const s of children.get(parentId) ?? []) {
      order.push(s.id)
      walk(s.id)
    }
  }
  walk(null)
  return order
}
