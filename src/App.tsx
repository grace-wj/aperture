import { Fragment, useMemo, useState } from 'react'
import { parseTraceJson, type ContentBlock, type Span, type Trace } from './trace'
import './App.css'

type LoadState =
  | { kind: 'empty' }
  | { kind: 'loaded'; trace: Trace; filename: string }
  | { kind: 'error'; message: string; filename: string }

function App() {
  const [state, setState] = useState<LoadState>({ kind: 'empty' })
  const [dragging, setDragging] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selectedId, setSelectedId] = useState<string | null>(null)

  async function handleFile(file: File) {
    const text = await file.text()
    try {
      const trace = parseTraceJson(text)
      const root = trace.spans.find((s) => s.parentId === null)
      setExpanded(new Set(root ? [root.id] : []))
      setSelectedId(root?.id ?? null)
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
          selectedId={selectedId}
          onToggle={toggle}
          onSelect={setSelectedId}
        />
      )}
    </main>
  )
}

function LoadedView({
  trace,
  filename,
  expanded,
  selectedId,
  onToggle,
  onSelect,
}: {
  trace: Trace
  filename: string
  expanded: Set<string>
  selectedId: string | null
  onToggle: (id: string) => void
  onSelect: (id: string) => void
}) {
  const childMap = useMemo(() => buildChildren(trace.spans), [trace.spans])
  const roots = childMap.get(null) ?? []
  const diagnostics = trace.spans[0]?.attributes.diagnostics
  const diagnosticList = Array.isArray(diagnostics) ? (diagnostics as string[]) : []
  const selected = selectedId ? trace.spans.find((s) => s.id === selectedId) ?? null : null

  return (
    <section className="loaded">
      <div className="loaded__head">
        <h2>{trace.name ?? trace.id}</h2>
        <span className="loaded__meta">
          {filename} · {trace.spans.length} spans · {fmtMs(trace.endMs - trace.startMs)}
        </span>
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
      <div className="split">
        <div className="tree" role="tree">
          {roots.map((span) => (
            <Row
              key={span.id}
              span={span}
              depth={0}
              childMap={childMap}
              expanded={expanded}
              selectedId={selectedId}
              onToggle={onToggle}
              onSelect={onSelect}
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
  selectedId,
  onToggle,
  onSelect,
}: {
  span: Span
  depth: number
  childMap: Map<string | null, Span[]>
  expanded: Set<string>
  selectedId: string | null
  onToggle: (id: string) => void
  onSelect: (id: string) => void
}) {
  const kids = childMap.get(span.id) ?? []
  const hasKids = kids.length > 0
  const isExpanded = expanded.has(span.id)
  const isSelected = selectedId === span.id
  const duration = span.endMs - span.startMs
  return (
    <>
      <div
        className={`row${isSelected ? ' row--selected' : ''}`}
        style={{ paddingLeft: 8 + depth * 16 }}
        onClick={() => onSelect(span.id)}
        role="treeitem"
        aria-expanded={hasKids ? isExpanded : undefined}
        aria-selected={isSelected}
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
            selectedId={selectedId}
            onToggle={onToggle}
            onSelect={onSelect}
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

function fmtMs(ms: number) {
  if (ms < 1) return '0ms'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

function prettyJson(v: unknown) {
  return JSON.stringify(v, null, 2)
}

function compactJson(v: unknown) {
  const s = JSON.stringify(v)
  return s.length > 80 ? s.slice(0, 80) + '…' : s
}

export default App
