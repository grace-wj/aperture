import { useState } from 'react'
import { parseTraceJson, type Trace } from './trace'
import './App.css'

type LoadState =
  | { kind: 'empty' }
  | { kind: 'loaded'; trace: Trace; filename: string }
  | { kind: 'error'; message: string; filename: string }

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

      {state.kind === 'loaded' && (
        <section className="panel">
          <h2>
            {state.trace.name ?? state.trace.id}
            <small>{state.filename}</small>
          </h2>
          <p className="summary">
            {state.trace.spans.length} spans · {Math.round((state.trace.endMs - state.trace.startMs) / 1000)}s
          </p>
          <pre>{JSON.stringify(state.trace, null, 2)}</pre>
        </section>
      )}
    </main>
  )
}

export default App
