#!/usr/bin/env node
// Convert a DAComp / ReAct trajectory JSON into a standard OTLP trace whose
// spans carry OpenTelemetry gen_ai.* attributes. Since trajectories have no
// real timestamps, each step is laid out on a synthetic clock (1s per span).
//
// Usage:  node trajectory-to-otlp.mjs <input.json> [output.json]

import { readFileSync, writeFileSync } from 'node:fs'

const inPath = process.argv[2]
if (!inPath) {
  console.error('usage: node trajectory-to-otlp.mjs <input.json> [output.json]')
  process.exit(1)
}
const outPath = process.argv[3] ?? inPath.replace(/\.json$/, '') + '.otlp.json'

const doc = JSON.parse(readFileSync(inPath, 'utf8'))
const steps = doc.trajectory
if (!Array.isArray(steps) || steps.length === 0) {
  console.error('No trajectory[] array found in input.')
  process.exit(1)
}

const BASE_NANO = 1_700_000_000_000_000_000n // arbitrary fixed epoch (ns)
const SLOT_NANO = 1_000_000_000n // 1s per synthetic slot
let slot = 0n
const nano = () => BASE_NANO + slot * SLOT_NANO
const advance = () => {
  slot += 1n
}

function strVal(s) {
  return { stringValue: String(s) }
}

// Parse `Tool(k="v", k2="v2")` into a name + arguments object (best effort).
function parseAction(action) {
  const m = String(action).match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(([\s\S]*)\)\s*$/)
  if (!m) {
    const name = String(action).trim().split(/[\s(]/)[0] || 'action'
    return { name, args: { raw: String(action).trim() } }
  }
  const name = m[1]
  const inner = m[2]
  const args = {}
  // Match key="value" (allowing escaped quotes) or key=value.
  const re = /([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^,]+))/g
  let mm
  while ((mm = re.exec(inner)) !== null) {
    const key = mm[1]
    const val = mm[2] ?? mm[3] ?? (mm[4] || '').trim()
    args[key] = val.replace(/\\"/g, '"').replace(/\\n/g, '\n')
  }
  if (Object.keys(args).length === 0 && inner.trim()) args.raw = inner.trim()
  return { name, args }
}

const isTerminate = (name) => /terminate|finish|done/i.test(name)

const spans = []
const traceId = 'traj-' + Date.now().toString(16)
const rootId = 'span-root'
const rootStart = nano()

steps.forEach((st, i) => {
  // reasoning span (thought)
  const thoughtStart = nano()
  advance()
  const thoughtEnd = nano()
  const thoughtText = String(st.thought ?? '')
    .replace(/<\/?[a-z_]*think[a-z_]*>/gi, '')
    .trim()

  const thinkAttrs = [
    { key: 'gen_ai.operation.name', value: strVal('chat') },
    { key: 'gen_ai.provider.name', value: strVal('longcat') },
  ]
  if (thoughtText) {
    thinkAttrs.push({
      key: 'gen_ai.output.messages',
      value: strVal(
        JSON.stringify([
          { role: 'assistant', parts: [{ type: 'text', content: thoughtText }] },
        ]),
      ),
    })
  }
  const thinkId = `span-step-${i}`
  spans.push({
    traceId,
    spanId: thinkId,
    parentSpanId: rootId,
    name: 'chat',
    startTimeUnixNano: thoughtStart.toString(),
    endTimeUnixNano: thoughtEnd.toString(),
    status: { code: 1 },
    attributes: thinkAttrs,
  })

  // tool / terminate span (action)
  if (st.action) {
    const { name, args } = parseAction(st.action)
    const actStart = nano()
    advance()
    const actEnd = nano()
    if (isTerminate(name)) {
      spans.push({
        traceId,
        spanId: `span-act-${i}`,
        parentSpanId: rootId,
        name: 'invoke_agent ' + name,
        startTimeUnixNano: actStart.toString(),
        endTimeUnixNano: actEnd.toString(),
        status: { code: 1 },
        attributes: [
          { key: 'gen_ai.operation.name', value: strVal('invoke_agent') },
          { key: 'gen_ai.agent.name', value: strVal(name) },
        ],
      })
    } else {
      const attrs = [
        { key: 'gen_ai.operation.name', value: strVal('execute_tool') },
        { key: 'gen_ai.tool.name', value: strVal(name) },
        { key: 'gen_ai.tool.call.arguments', value: strVal(JSON.stringify(args)) },
      ]
      if (st.observation !== undefined) {
        attrs.push({ key: 'gen_ai.tool.call.result', value: strVal(String(st.observation)) })
      }
      spans.push({
        traceId,
        spanId: `span-act-${i}`,
        parentSpanId: thinkId,
        name: 'execute_tool ' + name,
        startTimeUnixNano: actStart.toString(),
        endTimeUnixNano: actEnd.toString(),
        status: { code: 1 },
        attributes: attrs,
      })
    }
  }
})

const rootEnd = nano()
const taskText = typeof doc.Task === 'string' ? doc.Task : undefined
const rootAttrs = [
  { key: 'gen_ai.operation.name', value: strVal('invoke_agent') },
  { key: 'gen_ai.agent.name', value: strVal('dacomp-agent') },
]
if (doc.system_message) {
  rootAttrs.push({ key: 'gen_ai.system_instructions', value: strVal(String(doc.system_message).trim()) })
}
if (taskText) {
  rootAttrs.push({
    key: 'gen_ai.input.messages',
    value: strVal(JSON.stringify([{ role: 'user', parts: [{ type: 'text', content: taskText }] }])),
  })
}

spans.unshift({
  traceId,
  spanId: rootId,
  name: 'invoke_agent dacomp-agent',
  startTimeUnixNano: rootStart.toString(),
  endTimeUnixNano: rootEnd.toString(),
  status: { code: 1 },
  attributes: rootAttrs,
})

const otlp = {
  resourceSpans: [
    {
      resource: { attributes: [{ key: 'service.name', value: strVal('dacomp-agent') }] },
      scopeSpans: [{ scope: { name: 'trajectory-to-otlp' }, spans }],
    },
  ],
}

writeFileSync(outPath, JSON.stringify(otlp, null, 2))
console.log(`Wrote ${spans.length} spans → ${outPath}`)
