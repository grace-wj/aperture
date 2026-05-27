import type { Span } from './trace'

export function computeLanes(spans: Span[]): { laneOf: Map<string, number>; maxLane: number } {
  const byId = new Map(spans.map((s) => [s.id, s]))
  const depthCache = new Map<string, number>()
  const depthOf = (span: Span): number => {
    const cached = depthCache.get(span.id)
    if (cached !== undefined) return cached
    let d = 0
    if (span.parentId !== null) {
      const parent = byId.get(span.parentId)
      if (parent) d = depthOf(parent) + 1
    }
    depthCache.set(span.id, d)
    return d
  }

  const byDepth = new Map<number, Span[]>()
  let maxDepth = 0
  for (const s of spans) {
    const d = depthOf(s)
    if (d > maxDepth) maxDepth = d
    const arr = byDepth.get(d)
    if (arr) arr.push(s)
    else byDepth.set(d, [s])
  }

  // Depth is the primary swimlane (parent above children). Within a depth, pack
  // temporally-overlapping spans into sub-lanes so parallel calls don't draw on top
  // of each other; non-overlapping bands collapse back to a single row.
  const laneOf = new Map<string, number>()
  let bandOffset = 0
  let maxLane = 0
  for (let d = 0; d <= maxDepth; d++) {
    const band = (byDepth.get(d) ?? []).slice().sort((a, b) => a.startMs - b.startMs)
    const laneEnds: number[] = []
    for (const s of band) {
      let sub = laneEnds.findIndex((end) => end <= s.startMs)
      if (sub === -1) {
        sub = laneEnds.length
        laneEnds.push(s.endMs)
      } else {
        laneEnds[sub] = s.endMs
      }
      const lane = bandOffset + sub
      laneOf.set(s.id, lane)
      if (lane > maxLane) maxLane = lane
    }
    bandOffset += Math.max(1, laneEnds.length)
  }
  return { laneOf, maxLane }
}
