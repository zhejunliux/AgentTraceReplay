import { STEP_MS, buildModel } from './buildModel'
import { toolTrack } from './toolTrack'
import type { Message, MessagePart, ReplayModel, ReplaySpan, TokenUsage } from './types'

// Handles the two most common "chat log" shapes:
//   - OpenAI style: messages[] with role + optional tool_calls[]; tool results
//     as separate { role: 'tool', tool_call_id, content } messages.
//   - Anthropic style: messages[] where content is an array of blocks
//     (text / tool_use / tool_result).
// Both are laid out on a synthetic step axis (no real timestamps).

interface OpenAIToolCall {
  id?: string
  type?: string
  function?: { name?: string; arguments?: unknown }
  name?: string
  arguments?: unknown
}

interface RawMessage {
  role: string
  content?: unknown
  reasoning_content?: string
  tool_calls?: OpenAIToolCall[]
  tool_call_id?: string
  name?: string
  usage?: Record<string, unknown>
}

interface MessagesDoc {
  messages?: RawMessage[]
  synthetic_model?: string
  model?: string
  source?: string
  tag?: unknown
}

// ---- content coercion (string | Anthropic blocks | array of parts) ----

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        if (typeof b === 'string') return b
        if (b && typeof b === 'object') {
          const o = b as Record<string, unknown>
          if (typeof o.text === 'string') return o.text
          if (typeof o.content === 'string') return o.content
        }
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

// Extract Anthropic-style tool_use / tool_result blocks from a content array.
function extractBlocks(content: unknown): {
  toolUses: { id?: string; name: string; input: unknown }[]
  toolResults: { id?: string; output: unknown }[]
} {
  const toolUses: { id?: string; name: string; input: unknown }[] = []
  const toolResults: { id?: string; output: unknown }[] = []
  if (Array.isArray(content)) {
    for (const b of content) {
      if (!b || typeof b !== 'object') continue
      const o = b as Record<string, unknown>
      if (o.type === 'tool_use') {
        toolUses.push({ id: o.id as string, name: (o.name as string) ?? 'tool', input: o.input })
      } else if (o.type === 'tool_result') {
        toolResults.push({ id: o.tool_use_id as string, output: o.content })
      }
    }
  }
  return { toolUses, toolResults }
}

function normalizeToolCall(tc: OpenAIToolCall): { id?: string; name: string; args: unknown } {
  const fn = tc.function
  return {
    id: tc.id,
    name: fn?.name ?? tc.name ?? 'tool',
    args: fn?.arguments ?? tc.arguments,
  }
}

function tokensFromUsage(usage?: Record<string, unknown>): TokenUsage | undefined {
  if (!usage) return undefined
  const num = (k: string) => (typeof usage[k] === 'number' ? (usage[k] as number) : undefined)
  const t: TokenUsage = {
    input: num('prompt_tokens') ?? num('input_tokens'),
    output: num('completion_tokens') ?? num('output_tokens'),
    cacheRead: num('cache_read_input_tokens') ?? num('cached_tokens'),
    reasoning: num('reasoning_tokens'),
  }
  return Object.values(t).some((v) => v !== undefined) ? t : undefined
}

export function messagesToReplayModel(doc: MessagesDoc, fallbackTitle = 'Chat run'): ReplayModel {
  const messages = doc.messages ?? []
  if (messages.length === 0) throw new Error('No messages[] found.')

  const model = doc.synthetic_model ?? doc.model
  const spans: ReplaySpan[] = []
  let step = 0
  const nextSlot = () => {
    const start = step * STEP_MS
    step += 1
    return { start, end: start + STEP_MS * 0.8 }
  }

  // Map tool_call_id -> the tool span we created, so OpenAI tool-result
  // messages can attach their output to the right call.
  const toolSpanByCallId = new Map<string, ReplaySpan>()
  let lastAssistantId: string | undefined
  let systemInstructions: string | undefined

  messages.forEach((m, i) => {
    const role = m.role
    if (role === 'system') {
      systemInstructions = contentToText(m.content)
      return
    }

    if (role === 'tool' || role === 'function') {
      // OpenAI tool result — attach to the matching tool span if we have one.
      const callId = m.tool_call_id
      const target = callId ? toolSpanByCallId.get(callId) : undefined
      if (target) {
        target.toolResult = m.content
        target.tEnd = Math.max(target.tEnd, (step - 1) * STEP_MS + STEP_MS * 0.8)
      } else {
        const slot = nextSlot()
        spans.push({
          id: `tool-${i}`,
          parentId: lastAssistantId,
          track: toolTrack(m.name),
          operation: 'execute_tool',
          name: m.name ?? 'tool',
          toolName: m.name,
          tStart: slot.start,
          tEnd: slot.end,
          status: 'ok',
          toolResult: m.content,
          depth: 0,
        })
      }
      return
    }

    // user / assistant → a reasoning span on the main line.
    const slot = nextSlot()
    const id = `msg-${i}`
    const text = contentToText(m.content)
    const parts: MessagePart[] = []
    if (text) parts.push({ type: 'text', content: text })

    const outMsg: Message = { role, parts }
    const reasoning = m.reasoning_content
    const span: ReplaySpan = {
      id,
      parentId: undefined,
      track: role === 'assistant' ? 'reasoning' : 'other',
      operation: role === 'assistant' ? 'chat' : 'user_input',
      name: role === 'assistant' ? (model ? `chat · ${model}` : 'assistant') : 'user',
      model: role === 'assistant' ? model : undefined,
      tStart: slot.start,
      tEnd: slot.end,
      status: 'ok',
      tokens: tokensFromUsage(m.usage),
      systemInstructions: role === 'assistant' ? systemInstructions : undefined,
      outputMessages: [outMsg],
      depth: 0,
    }
    if (reasoning) {
      span.outputMessages = [{ role: 'assistant', parts: [{ type: 'text', content: reasoning }] }, outMsg]
    }
    spans.push(span)
    if (role === 'assistant') {
      lastAssistantId = id
      systemInstructions = undefined // only attach once, to first assistant turn

      // OpenAI tool_calls → tool spans branching off this assistant turn.
      for (const tcRaw of m.tool_calls ?? []) {
        const tc = normalizeToolCall(tcRaw)
        const tslot = nextSlot()
        const toolSpan: ReplaySpan = {
          id: `call-${tc.id ?? `${i}-${spans.length}`}`,
          parentId: id,
          track: toolTrack(tc.name),
          operation: 'execute_tool',
          name: tc.name,
          toolName: tc.name,
          tStart: tslot.start,
          tEnd: tslot.end,
          status: 'ok',
          toolArguments: tc.args,
          depth: 0,
        }
        spans.push(toolSpan)
        if (tc.id) toolSpanByCallId.set(tc.id, toolSpan)
        // Also surface the call as a part on the assistant message.
        parts.push({ type: 'tool_call', id: tc.id, name: tc.name, arguments: tc.args })
      }

      // Anthropic content blocks → tool_use spans.
      const { toolUses } = extractBlocks(m.content)
      for (const tu of toolUses) {
        const tslot = nextSlot()
        const toolSpan: ReplaySpan = {
          id: `use-${tu.id ?? `${i}-${spans.length}`}`,
          parentId: id,
          track: toolTrack(tu.name),
          operation: 'execute_tool',
          name: tu.name,
          toolName: tu.name,
          tStart: tslot.start,
          tEnd: tslot.end,
          status: 'ok',
          toolArguments: tu.input,
          depth: 0,
        }
        spans.push(toolSpan)
        if (tu.id) toolSpanByCallId.set(tu.id, toolSpan)
        parts.push({ type: 'tool_call', id: tu.id, name: tu.name, arguments: tu.input })
      }
    } else {
      // user turn: attach Anthropic tool_result blocks to their calls.
      const { toolResults } = extractBlocks(m.content)
      for (const tr of toolResults) {
        const target = tr.id ? toolSpanByCallId.get(tr.id) : undefined
        if (target) target.toolResult = tr.output
      }
    }
  })

  const label = doc.source ? `${doc.source} run` : fallbackTitle
  return buildModel({
    title: label,
    sourceFormat: 'Chat messages (OpenAI / Anthropic)',
    timeAxis: 'step',
    rootModel: model,
    spans,
  })
}
