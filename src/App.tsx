import { Fragment, useEffect, useMemo, useState } from 'react'
import {
  EMPTY_FILTER,
  buildHaystack,
  expandToReveal,
  isFilterActive,
  matchSpan,
  type Filter,
} from './filter'
import { useAppStore } from './store'
import { Timeline } from './timeline'
import {
  fmtMs,
  parseTraceJson,
  type ContentBlock,
  type Span,
  type SpanKind,
  type Trace,
} from './trace'
import './App.css'

const FILTER_KINDS: SpanKind[] = ['llm', 'tool', 'agent']

type LoadState =
  | { kind: 'empty' }
  | { kind: 'loaded'; trace: Trace; filename: string }
  | { kind: 'error'; message: string; filename: string }

function App() {
  const [state, setState] = useState<LoadState>({ kind: 'empty' })
  const [dragging, setDragging] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const select = useAppStore((s) => s.select)

  async function handleFile(file: File) {
    const text = await file.text()
    try {
      const trace = parseTraceJson(text)
      const root = trace.spans.find((s) => s.parentId === null)
      setExpanded(new Set(root ? [root.id] : []))
      select(root?.id ?? null)
      setState({ kind: 'loaded', trace, filename: file.name })
    } catch (err) {
      setState({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
        filename: file.name,
      })
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <main
      className="app"
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <header className="topbar">
        <h1>Aperture</h1>
        {state.kind !== 'empty' && (
          <button onClick={() => setState({ kind: 'empty' })}>Clear</button>
        )}
      </header>

      {state.kind === 'empty' && (
        <div
          className={`dropzone${dragging ? ' dropzone--over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
        >
          <p>Drop a trace JSON file here</p>
          <label className="filepick">
            or pick a file
            <input
              type="file"
              accept="application/json,.json"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) handleFile(f)
              }}
            />
          </label>
        </div>
      )}

      {state.kind === 'error' && (
        <section className="panel panel--error">
          <h2>Failed to parse {state.filename}</h2>
          <pre>{state.message}</pre>
        </section>
      )}

      {state.kind === 'loaded' && (
        <LoadedView
          trace={state.trace}
          filename={state.filename}
          expanded={expanded}
          onToggle={toggle}
        />
      )}
    </main>
  )
}

function LoadedView({
  trace,
  filename,
  expanded,
  onToggle,
}: {
  trace: Trace
  filename: string
  expanded: Set<string>
  onToggle: (id: string) => void
}) {
  const selectedId = useAppStore((s) => s.selectedId)
  const childMap = useMemo(() => buildChildren(trace.spans), [trace.spans])
  const roots = childMap.get(null) ?? []
  const diagnostics = trace.spans[0]?.attributes.diagnostics
  const diagnosticList = Array.isArray(diagnostics) ? (diagnostics as string[]) : []
  const selected = selectedId ? trace.spans.find((s) => s.id === selectedId) ?? null : null

  const [filter, setFilter] = useState<Filter>(EMPTY_FILTER)
  const haystack = useMemo(() => buildHaystack(trace.spans), [trace.spans])
  const filterActive = isFilterActive(filter)
  const matchedIds = useMemo(() => {
    if (!filterActive) return null
    const queryLower = filter.query.trim().toLowerCase()
    const ids = new Set<string>()
    for (const s of trace.spans) {
      if (matchSpan(s, queryLower, filter, haystack)) ids.add(s.id)
    }
    return ids
  }, [trace.spans, filter, filterActive, haystack])

  const matchAncestors = useMemo(() => {
    if (matchedIds === null) return new Set<string>()
    return expandToReveal(matchedIds, trace.spans)
  }, [matchedIds, trace.spans])

  const selectionAncestors = useMemo(() => {
    if (!selectedId) return new Set<string>()
    return expandToReveal(new Set([selectedId]), trace.spans)
  }, [selectedId, trace.spans])

  const effectiveExpanded = useMemo(
    () => new Set([...expanded, ...matchAncestors, ...selectionAncestors]),
    [expanded, matchAncestors, selectionAncestors],
  )

  useEffect(() => {
    if (!selectedId) return
    const el = document.querySelector<HTMLDivElement>(
      `.tree [data-row-id="${CSS.escape(selectedId)}"]`,
    )
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selectedId])

  function toggleKind(k: SpanKind) {
    setFilter((f) => {
      const kinds = new Set(f.kinds)
      if (kinds.has(k)) kinds.delete(k)
      else kinds.add(k)
      return { ...f, kinds }
    })
  }

  return (
    <section className="loaded">
      <div className="loaded__head">
        <h2>{trace.name ?? trace.id}</h2>
        <span className="loaded__meta">
          {filename} · {trace.spans.length} spans · {fmtMs(trace.endMs - trace.startMs)}
        </span>
      </div>
      <div className="filterbar">
        <input
          type="search"
          className="filterbar__search"
          placeholder="Search spans…"
          value={filter.query}
          onChange={(e) => setFilter((f) => ({ ...f, query: e.target.value }))}
        />
        {FILTER_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            className={`chip${filter.kinds.has(k) ? ' chip--on' : ''}`}
            onClick={() => toggleKind(k)}
          >
            {k}
          </button>
        ))}
        <button
          type="button"
          className={`chip${filter.errorsOnly ? ' chip--on chip--err' : ''}`}
          onClick={() => setFilter((f) => ({ ...f, errorsOnly: !f.errorsOnly }))}
        >
          errors only
        </button>
        {matchedIds && (
          <span className="filterbar__count">
            {matchedIds.size} of {trace.spans.length}
          </span>
        )}
      </div>
      {diagnosticList.length > 0 && (
        <div className="diagnostics" role="status">
          <strong>Adapter notes</strong>
          <ul>
            {diagnosticList.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </div>
      )}
      <Timeline trace={trace} matchedIds={matchedIds} matchAncestors={matchAncestors} />
      <div className="split">
        <div className="tree" role="tree">
          {roots.map((span) => (
            <Row
              key={span.id}
              span={span}
              depth={0}
              childMap={childMap}
              expanded={effectiveExpanded}
              onToggle={onToggle}
              matchedIds={matchedIds}
              matchAncestors={matchAncestors}
            />
          ))}
        </div>
        <div className="detail">
          {selected ? <SpanDetail span={selected} /> : <p className="detail__empty">Select a span.</p>}
        </div>
      </div>
    </section>
  )
}

function Row({
  span,
  depth,
  childMap,
  expanded,
  onToggle,
  matchedIds,
  matchAncestors,
}: {
  span: Span
  depth: number
  childMap: Map<string | null, Span[]>
  expanded: Set<string>
  onToggle: (id: string) => void
  matchedIds: Set<string> | null
  matchAncestors: Set<string>
}) {
  const isSelected = useAppStore((s) => s.selectedId === span.id)
  const select = useAppStore((s) => s.select)
  const kids = childMap.get(span.id) ?? []
  const hasKids = kids.length > 0
  const isExpanded = expanded.has(span.id)
  const duration = span.endMs - span.startMs
  const matchState =
    matchedIds === null
      ? null
      : matchedIds.has(span.id)
        ? 'match'
        : matchAncestors.has(span.id)
          ? 'ancestor'
          : 'dim'
  const rowClasses = [
    'row',
    isSelected ? 'row--selected' : '',
    matchState === 'match' ? 'row--match' : '',
    matchState === 'dim' ? 'row--dim' : '',
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <>
      <div
        className={rowClasses}
        style={{ paddingLeft: 8 + depth * 16 }}
        onClick={() => select(span.id)}
        role="treeitem"
        aria-expanded={hasKids ? isExpanded : undefined}
        aria-selected={isSelected}
        data-row-id={span.id}
      >
        <button
          type="button"
          className="row__caret"
          onClick={(e) => {
            e.stopPropagation()
            onToggle(span.id)
          }}
          tabIndex={-1}
          style={{ visibility: hasKids ? 'visible' : 'hidden' }}
          aria-label={isExpanded ? 'collapse' : 'expand'}
        >
          {isExpanded ? '▾' : '▸'}
        </button>
        <span className={`row__dot row__dot--${span.status}`} title={span.status} />
        <span className={`row__kind row__kind--${span.kind}`}>{span.kind}</span>
        <span className="row__name">{span.name}</span>
        {/* LLM endMs===startMs by adapter design; richer LLM timing is a week-4 capture problem. */}
        <span className="row__dur">{span.kind === 'llm' ? '—' : fmtMs(duration)}</span>
      </div>
      {hasKids && isExpanded &&
        kids.map((c) => (
          <Row
            key={c.id}
            span={c}
            depth={depth + 1}
            childMap={childMap}
            expanded={expanded}
            onToggle={onToggle}
            matchedIds={matchedIds}
            matchAncestors={matchAncestors}
          />
        ))}
    </>
  )
}

function SpanDetail({ span }: { span: Span }) {
  const isSessionRoot = span.kind === 'agent' && span.parentId === null
  const a = span.attributes as Record<string, unknown>

  const usage =
    span.kind === 'llm' && a.usage && typeof a.usage === 'object'
      ? (a.usage as Record<string, unknown>)
      : null
  const usageStats: Array<[string, unknown]> = usage
    ? [
        ['in', usage.input_tokens],
        ['out', usage.output_tokens],
        ['cache w', usage.cache_creation_input_tokens],
        ['cache r', usage.cache_read_input_tokens],
      ]
    : []

  const meta: Array<[string, unknown]> = isSessionRoot
    ? [
        ['model', a.model],
        ['cwd', a.cwd],
        ['cost (USD)', a.costUsd],
        ['turns', a.numTurns],
        ['duration', typeof a.durationMs === 'number' ? fmtMs(a.durationMs) : undefined],
        ['api duration', typeof a.durationApiMs === 'number' ? fmtMs(a.durationApiMs) : undefined],
        ['stop reason', a.stopReason],
      ]
    : []

  return (
    <div className="detailbody">
      <div className="detailbody__head">
        <span className={`row__dot row__dot--${span.status}`} />
        <span className={`row__kind row__kind--${span.kind}`}>{span.kind}</span>
        <span className="detailbody__name">{span.name}</span>
        {!isSessionRoot && span.kind !== 'llm' && (
          <span className="detailbody__dur">{fmtMs(span.endMs - span.startMs)}</span>
        )}
      </div>

      {span.kind === 'llm' && (
        <>
          {usage && (
            <div className="usage">
              {usageStats.map(([label, value]) =>
                typeof value === 'number' && value > 0 ? (
                  <span key={label} className="usage__stat">
                    <span className="usage__label">{label}</span>
                    <span className="usage__value">{value.toLocaleString()}</span>
                  </span>
                ) : null,
              )}
            </div>
          )}
          <div className="blocks">
            {((a.content as ContentBlock[] | undefined) ?? []).map((b, i) => (
              <ContentBlockView key={i} block={b} />
            ))}
          </div>
        </>
      )}

      {(span.kind === 'tool' || (span.kind === 'agent' && !isSessionRoot)) && (
        <>
          {span.status === 'error' && (
            <div className="errorbar">tool_result returned is_error: true</div>
          )}
          <JsonBlock label="input" value={a.input} />
          <JsonBlock label="result" value={a.result} />
        </>
      )}

      {isSessionRoot && (
        <>
          <dl className="meta">
            {meta.map(([label, value]) => {
              if (value == null || value === '') return null
              const display = typeof value === 'object' ? prettyJson(value) : String(value)
              return (
                <Fragment key={label}>
                  <dt>{label}</dt>
                  <dd>{display}</dd>
                </Fragment>
              )
            })}
          </dl>
          {typeof a.result === 'string' && a.result.length > 0 && (
            <div className="blocks">
              <p className="muted">final result</p>
              <p className="prose">{a.result}</p>
            </div>
          )}
        </>
      )}

      {span.kind === 'other' && <JsonBlock label="attributes" value={span.attributes} />}
    </div>
  )
}

function ContentBlockView({ block }: { block: ContentBlock }) {
  if (block.type === 'text') {
    return <p className="prose">{block.text ?? ''}</p>
  }
  if (block.type === 'thinking') {
    return (
      <div className="thinking">
        <span className="thinking__label">thinking</span>
        <p className="prose">{block.thinking ?? <em className="muted">(empty)</em>}</p>
      </div>
    )
  }
  if (block.type === 'tool_use') {
    return (
      <div className="tooluse">
        <span className="tooluse__arrow">→</span>
        <span className="tooluse__name">{block.name ?? 'tool'}</span>
        <code className="tooluse__args">{compactJson(block.input)}</code>
      </div>
    )
  }
  return <JsonBlock label={block.type} value={block} />
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  if (value === undefined) return null
  return (
    <div className="jsonblock">
      <p className="muted">{label}</p>
      <pre>{prettyJson(value)}</pre>
    </div>
  )
}

function buildChildren(spans: Span[]): Map<string | null, Span[]> {
  const m = new Map<string | null, Span[]>()
  for (const s of spans) {
    const arr = m.get(s.parentId)
    if (arr) arr.push(s)
    else m.set(s.parentId, [s])
  }
  return m
}

function prettyJson(v: unknown) {
  return JSON.stringify(v, null, 2)
}

function compactJson(v: unknown) {
  const s = JSON.stringify(v)
  return s.length > 80 ? s.slice(0, 80) + '…' : s
}

export default App
