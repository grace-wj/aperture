import { useMemo, useState } from 'react'
import { parseTraceJson, type Span, type Trace } from './trace'
import './App.css'

type LoadState =
  | { kind: 'empty' }
  | { kind: 'loaded'; trace: Trace; filename: string }
  | { kind: 'error'; message: string; filename: string }

function buildTree(spans: Span[]): Array<{ span: Span; depth: number }> {
  const childrenOf = new Map<string | null, Span[]>()
  for (const s of spans) {
    const arr = childrenOf.get(s.parentId) ?? []
    arr.push(s)
    childrenOf.set(s.parentId, arr)
  }
  const rows: Array<{ span: Span; depth: number }> = []
  const walk = (parentId: string | null, depth: number) => {
    for (const span of childrenOf.get(parentId) ?? []) {
      rows.push({ span, depth })
      walk(span.id, depth + 1)
    }
  }
  walk(null, 0)
  return rows
}

function formatDuration(ms: number): string {
  if (ms >= 10000) return `${(ms / 1000).toFixed(1)}s`
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`
  return `${Math.round(ms)}ms`
}

function App() {
  const [state, setState] = useState<LoadState>({ kind: 'empty' })
  const [dragging, setDragging] = useState(false)

  async function handleFile(file: File) {
    const text = await file.text()
    try {
      const trace = parseTraceJson(text)
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

  return (
    <main className="app">
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
          onDrop={onDrop}
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

      {state.kind === 'loaded' && <LoadedView trace={state.trace} filename={state.filename} />}
    </main>
  )
}

function LoadedView({ trace, filename }: { trace: Trace; filename: string }) {
  const rows = useMemo(() => buildTree(trace.spans), [trace])
  const byKind: Record<string, number> = {}
  let errors = 0
  for (const s of trace.spans) {
    byKind[s.kind] = (byKind[s.kind] ?? 0) + 1
    if (s.status === 'error') errors++
  }
  const summaryBits = [
    `${trace.spans.length} spans`,
    ...Object.entries(byKind).map(([k, n]) => `${n} ${k}`),
    errors > 0 ? `${errors} error${errors > 1 ? 's' : ''}` : null,
    formatDuration(trace.endMs - trace.startMs),
  ].filter((s): s is string => s !== null)

  return (
    <section className="panel">
      <h2>
        {trace.name ?? trace.id}
        <small>{filename}</small>
      </h2>
      <p className="summary">{summaryBits.join(' · ')}</p>
      <pre className="tree">
        {rows.map(({ span, depth }) => (
          <div key={span.id} className="tree-row">
            <span className="tree-indent">{'  '.repeat(depth)}</span>
            <span className={`tree-kind tree-kind--${span.kind}`}>{span.kind}</span>
            <span className={`tree-status tree-status--${span.status}`}>{span.status}</span>
            <span className="tree-duration">{formatDuration(span.endMs - span.startMs)}</span>
            <span className="tree-name">{span.name}</span>
          </div>
        ))}
      </pre>
      <details className="raw">
        <summary>Raw Trace JSON</summary>
        <pre>{JSON.stringify(trace, null, 2)}</pre>
      </details>
    </section>
  )
}

export default App
