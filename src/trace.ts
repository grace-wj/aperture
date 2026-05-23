import { z } from 'zod'

export const SpanKindSchema = z.enum(['llm', 'tool', 'agent', 'other'])
export type SpanKind = z.infer<typeof SpanKindSchema>

export const SpanStatusSchema = z.enum(['ok', 'error', 'in_progress'])
export type SpanStatus = z.infer<typeof SpanStatusSchema>

export const SpanSchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  kind: SpanKindSchema,
  name: z.string(),
  status: SpanStatusSchema,
  startMs: z.number(),
  endMs: z.number(),
  attributes: z.record(z.string(), z.unknown()),
})
export type Span = z.infer<typeof SpanSchema>

export const TraceSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  startMs: z.number(),
  endMs: z.number(),
  spans: z.array(SpanSchema),
})
export type Trace = z.infer<typeof TraceSchema>

export function parseTraceJson(text: string): Trace {
  const raw: unknown = JSON.parse(text)
  if (looksLikeClaudeAgentSdk(raw)) {
    return claudeAgentSdkToTrace(raw)
  }
  return TraceSchema.parse(raw)
}

type SdkEvent = { type: string } & Record<string, unknown>

function looksLikeClaudeAgentSdk(raw: unknown): raw is SdkEvent[] {
  if (!Array.isArray(raw) || raw.length === 0) return false
  const first = raw[0] as Record<string, unknown> | undefined
  return first?.type === 'system' && first?.subtype === 'init'
}

type ContentBlock = {
  type: string
  id?: string
  name?: string
  input?: unknown
  tool_use_id?: string
  content?: unknown
  is_error?: boolean
}

function claudeAgentSdkToTrace(events: SdkEvent[]): Trace {
  const init = events.find((e) => e.type === 'system' && e.subtype === 'init')
  const result = events.find((e) => e.type === 'result')
  const diagnostics: string[] = []

  let tsMin = Infinity
  let tsMax = -Infinity
  for (const e of events) {
    if (typeof e.timestamp !== 'string') continue
    const t = Date.parse(e.timestamp)
    if (!Number.isFinite(t)) continue
    if (t < tsMin) tsMin = t
    if (t > tsMax) tsMax = t
  }
  const hasTimestamps = tsMin !== Infinity

  const durationMs = typeof result?.duration_ms === 'number' ? result.duration_ms : 0
  let traceEnd: number
  let traceStart: number
  if (hasTimestamps) {
    traceEnd = tsMax
    traceStart = durationMs ? traceEnd - durationMs : tsMin
  } else if (durationMs) {
    traceStart = 0
    traceEnd = durationMs
    diagnostics.push('No event timestamps; trace anchored at epoch 0 using result.duration_ms.')
  } else {
    traceStart = 0
    traceEnd = 0
    diagnostics.push('No event timestamps and no result.duration_ms; all spans collapsed to t=0.')
  }

  const sessionId =
    (typeof init?.session_id === 'string' && init.session_id) ||
    (typeof result?.session_id === 'string' && result.session_id) ||
    'session'

  const rootSpan: Span = {
    id: sessionId,
    parentId: null,
    kind: 'agent',
    name: 'session',
    status: result?.is_error === true ? 'error' : 'ok',
    startMs: traceStart,
    endMs: traceEnd,
    attributes: {
      model: init?.model,
      cwd: init?.cwd,
      mcpServers: init?.mcp_servers,
      durationMs: result?.duration_ms,
      durationApiMs: result?.duration_api_ms,
      costUsd: result?.total_cost_usd,
      stopReason: result?.stop_reason,
      result: result?.result,
      numTurns: result?.num_turns,
      modelUsage: result?.modelUsage,
    },
  }

  const spans: Span[] = [rootSpan]
  const llmByMessageId = new Map<string, Span>()
  const toolByUseId = new Map<string, Span>()
  let cursor = traceStart

  for (const ev of events) {
    if (typeof ev.timestamp === 'string') {
      const t = Date.parse(ev.timestamp)
      if (Number.isFinite(t) && t > cursor) cursor = t
    }
    const parentToolUseId =
      typeof ev.parent_tool_use_id === 'string' ? ev.parent_tool_use_id : null
    const contextParentId = parentToolUseId ?? rootSpan.id

    if (ev.type === 'assistant') {
      const msg = ev.message as
        | { id?: string; model?: string; content?: ContentBlock[]; usage?: unknown; stop_reason?: unknown }
        | undefined
      const messageId = msg?.id
      if (!messageId) {
        diagnostics.push('assistant event without message.id; dropped.')
        continue
      }
      let llmSpan = llmByMessageId.get(messageId)
      if (!llmSpan) {
        llmSpan = {
          id: messageId,
          parentId: contextParentId,
          kind: 'llm',
          name: msg?.model ?? 'llm',
          status: 'ok',
          startMs: cursor,
          endMs: cursor,
          attributes: { content: [] as ContentBlock[] },
        }
        llmByMessageId.set(messageId, llmSpan)
        spans.push(llmSpan)
      }
      const content = llmSpan.attributes.content as ContentBlock[]
      for (const block of msg?.content ?? []) {
        content.push(block)
        if (block.type === 'tool_use') {
          if (typeof block.id !== 'string') {
            diagnostics.push(`tool_use without string id in message ${messageId}; span dropped.`)
            continue
          }
          if (toolByUseId.has(block.id)) {
            diagnostics.push(`duplicate tool_use.id ${block.id}; later occurrence replaces earlier.`)
          }
          const toolSpan: Span = {
            id: block.id,
            parentId: llmSpan.id,
            kind: block.name === 'Agent' ? 'agent' : 'tool',
            name: block.name ?? 'tool',
            status: 'in_progress',
            startMs: cursor,
            endMs: cursor,
            attributes: { input: block.input },
          }
          toolByUseId.set(block.id, toolSpan)
          spans.push(toolSpan)
        }
      }
      if (msg?.usage != null) llmSpan.attributes.usage = msg.usage
      if (msg?.stop_reason != null) llmSpan.attributes.stopReason = msg.stop_reason
      llmSpan.endMs = cursor
    } else if (ev.type === 'user') {
      const blocks = (ev.message as { content?: ContentBlock[] } | undefined)?.content ?? []
      for (const block of blocks) {
        if (block.type !== 'tool_result') continue
        if (typeof block.tool_use_id !== 'string') {
          diagnostics.push('tool_result without string tool_use_id; dropped.')
          continue
        }
        const toolSpan = toolByUseId.get(block.tool_use_id)
        if (!toolSpan) {
          diagnostics.push(`orphan tool_result for tool_use_id ${block.tool_use_id}; no matching tool_use.`)
          continue
        }
        toolSpan.endMs = cursor
        toolSpan.status = block.is_error ? 'error' : 'ok'
        toolSpan.attributes.result = block.content
        const tur = ev.tool_use_result
        if (tur !== undefined) toolSpan.attributes.toolUseResult = tur
        const dur =
          tur && typeof tur === 'object' && 'durationMs' in tur
            ? (tur as { durationMs?: unknown }).durationMs
            : undefined
        if (typeof dur === 'number') {
          toolSpan.startMs = Math.max(traceStart, toolSpan.endMs - dur)
        }
      }
    } else if (ev.type === 'system' && ev.subtype === 'task_notification') {
      const tuId = typeof ev.tool_use_id === 'string' ? ev.tool_use_id : null
      const toolSpan = tuId ? toolByUseId.get(tuId) : undefined
      if (!toolSpan) {
        if (tuId) diagnostics.push(`task_notification for tool_use_id ${tuId}; no matching span.`)
        continue
      }
      if (ev.status === 'completed') toolSpan.status = 'ok'
      else if (ev.status === 'error') toolSpan.status = 'error'
      if (ev.usage !== undefined) toolSpan.attributes.subagentUsage = ev.usage
      toolSpan.endMs = cursor
    }
  }

  for (const span of spans) {
    if (span.endMs < span.startMs) {
      diagnostics.push(`span ${span.id} (${span.name}) endMs < startMs; clamped.`)
      span.endMs = span.startMs
    }
  }

  if (diagnostics.length) rootSpan.attributes.diagnostics = diagnostics

  return TraceSchema.parse({
    id: sessionId,
    name: 'Claude Agent SDK session',
    startMs: traceStart,
    endMs: traceEnd,
    spans,
  })
}
