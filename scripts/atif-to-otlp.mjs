#!/usr/bin/env node
// Convert an ATIF (Agent Trajectory Interchange Format, e.g. ATIF-v1.2) JSON
// into a standard OTLP trace with OpenTelemetry gen_ai.* attributes.
//
// ATIF carries REAL timestamps and per-step token metrics, so unlike the plain
// trajectory converter this produces a real-time axis and full token data.
// Nothing from each step is dropped: reasoning, assistant message, tool name,
// tool arguments, tool result, error flag, and token/cache counts all map over.
//
// Usage:  node atif-to-otlp.mjs <input.json> [output.json]

import { readFileSync, writeFileSync } from 'node:fs'

const inPath = process.argv[2]
if (!inPath) {
  console.error('usage: node atif-to-otlp.mjs <input.json> [output.json]')
  process.exit(1)
}
const outPath = process.argv[3] ?? inPath.replace(/\.json$/, '') + '.otlp.json'

const doc = JSON.parse(readFileSync(inPath, 'utf8'))
const steps = doc.steps
if (!Array.isArray(steps) || steps.length === 0) {
  console.error('No steps[] array found — is this an ATIF trajectory?')
  process.exit(1)
}

const sv = (s) => ({ stringValue: String(s) })
const iv = (n) => ({ intValue: String(n) })

const nowNano = (isoOrMs) => BigInt(Math.round(new Date(isoOrMs).getTime())) * 1_000_000n

// Step end = next step's timestamp; last step gets a 1s default.
const tsMs = steps.map((s) => new Date(s.timestamp).getTime())
const endMsOf = (i) => (i + 1 < tsMs.length ? tsMs[i + 1] : tsMs[i] + 1000)

const agent = doc.agent ?? {}
const model = agent.model_name
const traceId = (doc.session_id ?? 'atif').replace(/[^a-z0-9]/gi, '').slice(0, 32) || 'atif'
const rootId = 'span-root'

const spans = []

// Root invoke_agent span covering the whole session.
const rootAttrs = [
  { key: 'gen_ai.operation.name', value: sv('invoke_agent') },
  { key: 'gen_ai.agent.name', value: sv(agent.name ?? 'agent') },
]
if (model) rootAttrs.push({ key: 'gen_ai.request.model', value: sv(model) })
if (agent.version) rootAttrs.push({ key: 'gen_ai.agent.version', value: sv(agent.version) })
if (doc.session_id) rootAttrs.push({ key: 'gen_ai.conversation.id', value: sv(doc.session_id) })
const fm = doc.final_metrics
if (fm) {
  if (fm.total_prompt_tokens != null) rootAttrs.push({ key: 'gen_ai.usage.input_tokens', value: iv(fm.total_prompt_tokens) })
  if (fm.total_completion_tokens != null) rootAttrs.push({ key: 'gen_ai.usage.output_tokens', value: iv(fm.total_completion_tokens) })
}

spans.push({
  traceId,
  spanId: rootId,
  name: `invoke_agent ${agent.name ?? 'agent'}`,
  startTimeUnixNano: nowNano(tsMs[0]).toString(),
  endTimeUnixNano: nowNano(endMsOf(steps.length - 1)).toString(),
  status: { code: 1 },
  attributes: rootAttrs,
})

// Returns a uniform list of { id, name, args, result, isError } for a step,
// covering both ATIF v1.2 (extra.*) and v1.3 (tool_calls[] + observation).
function normalizeToolCalls(st) {
  // v1.2 first: extra.tool_use_name carries the richest info (result + error
  // flag). Some v1.2 steps ALSO include a tool_calls[] array, so this branch
  // must win to avoid dropping extra.tool_result_is_error.
  if (st.extra?.tool_use_name) {
    return [
      {
        id: undefined,
        name: st.extra.tool_use_name,
        args: st.extra.raw_arguments,
        result: st.extra.tool_result_metadata?.tool_use_result ?? st.extra.metadata?.tool_use_result,
        isError: st.extra.tool_result_is_error === true,
      },
    ]
  }
  // v1.3: explicit tool_calls array + observation.results[].
  if (Array.isArray(st.tool_calls) && st.tool_calls.length) {
    const results = st.observation?.results
    return st.tool_calls.map((tc, idx) => ({
      id: tc.tool_call_id ?? tc.id,
      name: tc.function_name ?? tc.function?.name ?? tc.name ?? tc.tool_name ?? 'tool',
      args: tc.arguments ?? tc.function?.arguments,
      result: Array.isArray(results) ? results[idx]?.content ?? results[idx] : st.observation,
      isError: tc.is_error === true || results?.[idx]?.is_error === true,
    }))
  }
  return []
}

function tokensAttrs(metrics) {
  if (!metrics) return []
  const out = []
  const push = (k, v) => v != null && out.push({ key: k, value: iv(v) })
  push('gen_ai.usage.input_tokens', metrics.prompt_tokens)
  push('gen_ai.usage.output_tokens', metrics.completion_tokens)
  const ex = metrics.extra ?? {}
  push('gen_ai.usage.cache_read.input_tokens', ex.cache_read_input_tokens ?? metrics.cached_tokens)
  push('gen_ai.usage.cache_creation.input_tokens', ex.cache_creation_input_tokens)
  return out
}

steps.forEach((st, i) => {
  const startMs = tsMs[i]
  const endMs = endMsOf(i)
  const mid = startMs + (endMs - startMs) * 0.5

  // system prompt (v1.3) or the initial user ask (v1.2) → root context.
  if (st.source === 'system') {
    spans[0].attributes.push({ key: 'gen_ai.system_instructions', value: sv(String(st.message ?? '')) })
    return
  }
  if (st.source === 'user') {
    const msg = JSON.stringify([{ role: 'user', parts: [{ type: 'text', content: String(st.message ?? '') }] }])
    spans[0].attributes.push({ key: 'gen_ai.input.messages', value: sv(msg) })
    return
  }

  // Normalize tool calls across ATIF variants:
  //   v1.2: single call in extra.tool_use_name / extra.raw_arguments,
  //         result in extra.tool_result_metadata, error in extra.tool_result_is_error.
  //   v1.3: tool_calls[] (function_name + arguments + tool_call_id),
  //         results in observation.results[].content.
  const toolCalls = normalizeToolCalls(st)
  const hasTool = toolCalls.length > 0
  const chatEnd = hasTool ? mid : endMs
  const chatId = `span-chat-${st.step_id ?? i}`

  const outParts = []
  if (st.reasoning_content) outParts.push({ type: 'text', content: String(st.reasoning_content) })
  if (st.message) outParts.push({ type: 'text', content: String(st.message) })
  const finish = st.extra?.stop_reason
  const outMsg = JSON.stringify([{ role: 'assistant', parts: outParts, finish_reason: finish }])

  const chatAttrs = [
    { key: 'gen_ai.operation.name', value: sv('chat') },
    { key: 'gen_ai.request.model', value: sv(st.model_name ?? model ?? 'model') },
    { key: 'gen_ai.output.messages', value: sv(outMsg) },
    ...tokensAttrs(st.metrics),
  ]
  if (finish) chatAttrs.push({ key: 'gen_ai.response.finish_reasons', value: { arrayValue: { values: [sv(finish)] } } })

  spans.push({
    traceId,
    spanId: chatId,
    parentSpanId: rootId,
    name: 'chat',
    startTimeUnixNano: nowNano(startMs).toString(),
    endTimeUnixNano: nowNano(chatEnd).toString(),
    status: { code: 1 },
    attributes: chatAttrs,
  })

  // One execute_tool span per call, packed into the step's second half.
  toolCalls.forEach((tc, j) => {
    const n = toolCalls.length
    const tStart = mid + ((endMs - mid) * j) / n
    const tEnd = mid + ((endMs - mid) * (j + 1)) / n
    const toolAttrs = [
      { key: 'gen_ai.operation.name', value: sv('execute_tool') },
      { key: 'gen_ai.tool.name', value: sv(tc.name) },
    ]
    if (tc.id) toolAttrs.push({ key: 'gen_ai.tool.call.id', value: sv(tc.id) })
    if (tc.args !== undefined)
      toolAttrs.push({ key: 'gen_ai.tool.call.arguments', value: sv(typeof tc.args === 'string' ? tc.args : JSON.stringify(tc.args)) })
    if (tc.result !== undefined)
      toolAttrs.push({ key: 'gen_ai.tool.call.result', value: sv(typeof tc.result === 'string' ? tc.result : JSON.stringify(tc.result)) })
    if (tc.isError) toolAttrs.push({ key: 'error.type', value: sv('ToolError') })

    spans.push({
      traceId,
      spanId: `span-tool-${st.step_id ?? i}-${j}`,
      parentSpanId: chatId,
      name: 'execute_tool ' + tc.name,
      startTimeUnixNano: nowNano(tStart).toString(),
      endTimeUnixNano: nowNano(tEnd).toString(),
      status: tc.isError ? { code: 2 } : { code: 1 },
      attributes: toolAttrs,
    })
  })
})

const otlp = {
  resourceSpans: [
    {
      resource: {
        attributes: [
          { key: 'service.name', value: sv(agent.name ?? 'agent') },
          { key: 'gen_ai.agent.name', value: sv(agent.name ?? 'agent') },
        ],
      },
      scopeSpans: [{ scope: { name: 'atif-to-otlp', version: doc.schema_version ?? '' }, spans }],
    },
  ],
}

writeFileSync(outPath, JSON.stringify(otlp, null, 2))
console.log(`Wrote ${spans.length} spans (from ${steps.length} ATIF steps) → ${outPath}`)
