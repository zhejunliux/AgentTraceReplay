import { toolTrack } from './toolTrack'
import type {
  Message,
  MessagePart,
  ReplayModel,
  ReplaySpan,
  Track,
  TokenUsage,
} from './types'

// ---- OTLP JSON shapes (only the parts we read) ----

interface OtlpAnyValue {
  stringValue?: string
  intValue?: string | number
  doubleValue?: number
  boolValue?: boolean
  arrayValue?: { values?: OtlpAnyValue[] }
  kvlistValue?: { values?: OtlpKeyValue[] }
}
interface OtlpKeyValue {
  key: string
  value: OtlpAnyValue
}
interface OtlpSpan {
  traceId?: string
  spanId: string
  parentSpanId?: string
  name?: string
  startTimeUnixNano: string | number
  endTimeUnixNano: string | number
  attributes?: OtlpKeyValue[]
  status?: { code?: number; message?: string }
}
interface OtlpScopeSpans {
  spans?: OtlpSpan[]
}
interface OtlpResourceSpans {
  scopeSpans?: OtlpScopeSpans[]
  instrumentationLibrarySpans?: OtlpScopeSpans[] // legacy field name
}
interface OtlpDocument {
  resourceSpans?: OtlpResourceSpans[]
}

// ---- attribute decoding ----

function decodeValue(v: OtlpAnyValue): unknown {
  if (v.stringValue !== undefined) return v.stringValue
  if (v.intValue !== undefined) return Number(v.intValue)
  if (v.doubleValue !== undefined) return v.doubleValue
  if (v.boolValue !== undefined) return v.boolValue
  if (v.arrayValue) return (v.arrayValue.values ?? []).map(decodeValue)
  if (v.kvlistValue) {
    const o: Record<string, unknown> = {}
    for (const kv of v.kvlistValue.values ?? []) o[kv.key] = decodeValue(kv.value)
    return o
  }
  return undefined
}

function attrsToMap(attributes: OtlpKeyValue[] = []): Record<string, unknown> {
  const m: Record<string, unknown> = {}
  for (const kv of attributes) m[kv.key] = decodeValue(kv.value)
  return m
}

function asNumber(x: unknown): number | undefined {
  const n = typeof x === 'string' ? Number(x) : (x as number)
  return typeof n === 'number' && !Number.isNaN(n) ? n : undefined
}

// gen_ai message content may arrive as a structured object/array or a JSON string.
function parseMaybeJson(x: unknown): unknown {
  if (typeof x !== 'string') return x
  const s = x.trim()
  if (!s || (s[0] !== '{' && s[0] !== '[')) return x
  try {
    return JSON.parse(s)
  } catch {
    return x
  }
}

// ---- track mapping from gen_ai.operation.name ----

function trackFor(operation: string, toolName?: string): Track {
  switch (operation) {
    case 'chat':
    case 'text_completion':
    case 'generate_content':
      return 'reasoning'
    case 'execute_tool':
      return toolTrack(toolName)
    case 'invoke_agent':
    case 'create_agent':
    case 'invoke_workflow':
      return 'agent'
    case 'plan':
      return 'plan'
    case 'retrieval':
    case 'embeddings':
      return 'retrieval'
    default:
      if (operation.endsWith('_memory') || operation.endsWith('_memory_store')) return 'memory'
      return 'other'
  }
}

// ---- message normalization ----

function normalizeParts(rawParts: unknown): MessagePart[] {
  if (!Array.isArray(rawParts)) {
    // Some producers put a bare string as content.
    if (typeof rawParts === 'string') return [{ type: 'text', content: rawParts }]
    return []
  }
  const parts: MessagePart[] = []
  for (const p of rawParts) {
    if (typeof p === 'string') {
      parts.push({ type: 'text', content: p })
      continue
    }
    if (!p || typeof p !== 'object') continue
    const obj = p as Record<string, unknown>
    const t = obj.type
    if (t === 'tool_call') {
      parts.push({
        type: 'tool_call',
        id: obj.id as string | undefined,
        name: (obj.name as string) ?? 'tool',
        arguments: obj.arguments,
      })
    } else if (t === 'tool_call_response') {
      parts.push({
        type: 'tool_call_response',
        id: obj.id as string | undefined,
        response: obj.response,
      })
    } else {
      // default: text
      const content = (obj.content ?? obj.text ?? '') as unknown
      parts.push({ type: 'text', content: typeof content === 'string' ? content : JSON.stringify(content) })
    }
  }
  return parts
}

function normalizeMessages(raw: unknown): Message[] | undefined {
  const data = parseMaybeJson(raw)
  if (!Array.isArray(data)) return undefined
  const msgs: Message[] = []
  for (const m of data) {
    if (!m || typeof m !== 'object') continue
    const obj = m as Record<string, unknown>
    msgs.push({
      role: (obj.role as string) ?? 'unknown',
      parts: normalizeParts(obj.parts ?? obj.content),
      finishReason: obj.finish_reason as string | undefined,
    })
  }
  return msgs.length ? msgs : undefined
}

function normalizeSystemInstructions(raw: unknown): string | undefined {
  const data = parseMaybeJson(raw)
  if (typeof data === 'string') return data
  if (Array.isArray(data)) {
    const texts = data
      .map((p) => (p && typeof p === 'object' ? (p as Record<string, unknown>).content : p))
      .filter((c): c is string => typeof c === 'string')
    return texts.join('\n') || undefined
  }
  return undefined
}

// ---- main adapter ----

export function otlpToReplayModel(doc: OtlpDocument, fallbackTitle = 'Agent run'): ReplayModel {
  const rawSpans: OtlpSpan[] = []
  for (const rs of doc.resourceSpans ?? []) {
    const scopes = rs.scopeSpans ?? rs.instrumentationLibrarySpans ?? []
    for (const sc of scopes) for (const sp of sc.spans ?? []) rawSpans.push(sp)
  }

  if (rawSpans.length === 0) {
    throw new Error('No spans found. Is this an OTLP trace export (resourceSpans[])?')
  }

  // Find the earliest start to normalize t=0. Reduce (not Math.min(...spread))
  // so a trace with 100k+ spans can't overflow the JS argument limit.
  let minStart = Infinity
  for (const s of rawSpans) {
    const n = Number(s.startTimeUnixNano)
    if (n < minStart) minStart = n
  }
  const nanoToMs = (n: string | number) => (Number(n) - minStart) / 1e6

  // Only keep spans that carry gen_ai semantics OR have a gen_ai child;
  // for the MVP we keep everything but classify non-gen_ai as 'other'.
  const built: ReplaySpan[] = rawSpans.map((s) => {
    const a = attrsToMap(s.attributes)
    const operation = (a['gen_ai.operation.name'] as string) ?? inferOperationFromName(s.name)
    const tokens: TokenUsage = {
      input: asNumber(a['gen_ai.usage.input_tokens']),
      output: asNumber(a['gen_ai.usage.output_tokens']),
      cacheRead: asNumber(a['gen_ai.usage.cache_read.input_tokens']),
      cacheCreation: asNumber(a['gen_ai.usage.cache_creation.input_tokens']),
      reasoning: asNumber(a['gen_ai.usage.reasoning.output_tokens']),
    }
    const hasTokens = Object.values(tokens).some((v) => v !== undefined)
    const model = (a['gen_ai.response.model'] ?? a['gen_ai.request.model']) as string | undefined
    const toolName = a['gen_ai.tool.name'] as string | undefined
    const agentName = a['gen_ai.agent.name'] as string | undefined

    const status: ReplaySpan['status'] = s.status?.code === 2 || a['error.type'] ? 'error' : 'ok'

    return {
      id: s.spanId,
      parentId: s.parentSpanId || undefined,
      track: trackFor(operation, toolName),
      operation,
      name: displayName(operation, model, toolName, agentName, s.name),
      model,
      provider: a['gen_ai.provider.name'] as string | undefined,
      toolName,
      tStart: nanoToMs(s.startTimeUnixNano),
      tEnd: nanoToMs(s.endTimeUnixNano),
      status,
      errorType: a['error.type'] as string | undefined,
      tokens: hasTokens ? tokens : undefined,
      systemInstructions: normalizeSystemInstructions(a['gen_ai.system_instructions']),
      inputMessages: normalizeMessages(a['gen_ai.input.messages']),
      outputMessages: normalizeMessages(a['gen_ai.output.messages']),
      toolArguments: parseMaybeJson(a['gen_ai.tool.call.arguments']),
      toolResult: parseMaybeJson(a['gen_ai.tool.call.result']),
      depth: 0, // filled below
    }
  })

  // Compute depth from parent chain.
  const byId = new Map(built.map((s) => [s.id, s]))
  const depthCache = new Map<string, number>()
  const depthOf = (id: string, guard = 0): number => {
    if (guard > 64) return 0
    if (depthCache.has(id)) return depthCache.get(id)!
    const span = byId.get(id)
    if (!span || !span.parentId || !byId.has(span.parentId)) {
      depthCache.set(id, 0)
      return 0
    }
    const d = depthOf(span.parentId, guard + 1) + 1
    depthCache.set(id, d)
    return d
  }
  for (const s of built) s.depth = depthOf(s.id)

  built.sort((x, y) => x.tStart - y.tStart)

  let duration = 1
  for (const s of built) if (s.tEnd > duration) duration = s.tEnd
  const rootSpan = built.find((s) => !s.parentId || !byId.has(s.parentId))

  return {
    meta: {
      title: rootSpan?.name ?? fallbackTitle,
      duration,
      spanCount: built.length,
      totalInputTokens: sum(built.map((s) => s.tokens?.input ?? 0)),
      totalOutputTokens: sum(built.map((s) => s.tokens?.output ?? 0)),
      rootModel: rootSpan?.model,
      sourceFormat: 'OpenTelemetry gen_ai',
      timeAxis: 'time',
    },
    spans: built,
  }
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0)
}

function inferOperationFromName(name?: string): string {
  if (!name) return 'other'
  const first = name.trim().split(/\s+/)[0]
  return first || 'other'
}

function displayName(
  operation: string,
  model?: string,
  toolName?: string,
  agentName?: string,
  rawName?: string,
): string {
  if (operation === 'execute_tool' && toolName) return toolName
  if ((operation === 'invoke_agent' || operation === 'create_agent') && agentName) return agentName
  if (model) return `${operation} · ${model}`
  return rawName || operation
}
