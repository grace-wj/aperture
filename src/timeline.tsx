import { useEffect, useMemo, useRef, useState } from 'react'
import { computeLanes } from './lanes'
import { useAppStore } from './store'
import { fmtMs, type Trace } from './trace'

const LANE_HEIGHT = 16
const LANE_GAP = 4
const MIN_BAR_PX = 3
const AXIS_HEIGHT = 22
const PAD_X = 12
const PAD_BOTTOM = 6

export function Timeline({
  trace,
  matchedIds,
  matchAncestors,
}: {
  trace: Trace
  matchedIds: Set<string> | null
  matchAncestors: Set<string>
}) {
  const selectedId = useAppStore((s) => s.selectedId)
  const selectByUser = useAppStore((s) => s.selectByUser)
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      setWidth(entry.contentRect.width)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const { laneOf, maxLane } = useMemo(() => computeLanes(trace.spans), [trace.spans])
  const duration = trace.endMs - trace.startMs
  const innerWidth = Math.max(0, width - PAD_X * 2)
  const xScale = (ms: number) =>
    duration > 0 ? ((ms - trace.startMs) / duration) * innerWidth : 0

  const svgHeight =
    AXIS_HEIGHT + (maxLane + 1) * (LANE_HEIGHT + LANE_GAP) + PAD_BOTTOM

  const tickCount = 5
  const ticks =
    duration > 0
      ? Array.from({ length: tickCount }, (_, i) => {
          const ms = (duration * i) / (tickCount - 1)
          return { x: xScale(trace.startMs + ms), label: fmtMs(ms) }
        })
      : [{ x: 0, label: '0ms' }]

  return (
    <div ref={containerRef} className="timeline">
      <svg width={width} height={svgHeight} className="timeline__svg">
        {ticks.map((t, i) => (
          <line
            key={`g${i}`}
            x1={PAD_X + t.x}
            x2={PAD_X + t.x}
            y1={AXIS_HEIGHT - 4}
            y2={svgHeight - PAD_BOTTOM}
            className="timeline__gridline"
          />
        ))}
        {ticks.map((t, i) => (
          <text
            key={`t${i}`}
            x={PAD_X + t.x}
            y={12}
            className="timeline__ticklabel"
            textAnchor={i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle'}
          >
            {t.label}
          </text>
        ))}
        {trace.spans.map((span) => {
            const lane = laneOf.get(span.id) ?? 0
            const rawW = xScale(span.endMs) - xScale(span.startMs)
            const w = Math.max(MIN_BAR_PX, rawW)
            const x = PAD_X + xScale(span.startMs)
            const y = AXIS_HEIGHT + lane * (LANE_HEIGHT + LANE_GAP)
            const isSelected = selectedId === span.id
            const matchState =
              matchedIds === null
                ? null
                : matchedIds.has(span.id)
                  ? 'match'
                  : matchAncestors.has(span.id)
                    ? 'ancestor'
                    : 'dim'
            const cls = [
              'timeline__bar',
              `timeline__bar--${span.kind}`,
              `timeline__bar--${span.status}`,
              isSelected ? 'timeline__bar--selected' : '',
              matchState === 'match' ? 'timeline__bar--match' : '',
              matchState === 'dim' && !isSelected ? 'timeline__bar--dim' : '',
            ]
              .filter(Boolean)
              .join(' ')
            return (
              <rect
                key={span.id}
                x={x}
                y={y}
                width={w}
                height={LANE_HEIGHT}
                rx={2}
                className={cls}
                onClick={() => selectByUser(span.id)}
              >
                <title>{`${span.kind} · ${span.name} · ${fmtMs(span.endMs - span.startMs)}`}</title>
              </rect>
            )
          })}
      </svg>
    </div>
  )
}

