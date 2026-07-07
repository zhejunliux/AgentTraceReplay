import type { ReplayModel, ReplaySpan } from './types'

// Pure, front-end-only trajectory analysis: statistical overview + heuristic
// issue detection. No LLM, no network — everything is derived from the spans.

export interface Overview {
  spanCount: number
  timeAxis: 'time' | 'step'
  durationMs: number
  reasoningSteps: number
  toolCalls: number
  agentSteps: number
  totalInputTokens: number
  totalOutputTokens: number
  cacheReadTokens: number
  cacheHitRate?: number // cacheRead / totalInput, when input tokens known
  toolUsage: { name: string; count: number }[] // sorted desc
  errorCount: number
}

// Issues are deterministic anomalies (something went wrong). Warnings are
// noteworthy-but-not-wrong signals (e.g. a slow step). They are surfaced
// separately so "slow" doesn't read as an error.
export type IssueKind = 'error' | 'retry' | 'loop'
export type WarningKind = 'slow'

// Findings carry structured params, NOT prebuilt sentences — the UI layer owns
// wording (and can localize it). Keeps analysis logic free of display strings.
export interface Finding<K extends string> {
  kind: K
  // What the finding is about (a tool/step name) and any numbers the message
  // needs (count for loops, seconds/×median for slow). The UI turns these into
  // human text; nothing here is user-facing prose.
  label: string
  count?: number
  seconds?: number
  ratio?: number
  errorType?: string
  spanId: string // the span to jump to when clicked
}

export type Issue = Finding<IssueKind>
export type Warning = Finding<WarningKind>

export interface Analysis {
  overview: Overview
  issues: Issue[]
  warnings: Warning[]
}

const isTool = (s: ReplaySpan) => s.operation === 'execute_tool'
const isReasoning = (s: ReplaySpan) => s.track === 'reasoning'
const isAgent = (s: ReplaySpan) => s.track === 'agent'

// Stable key for "same call" detection — tool name + serialized arguments.
function callKey(s: ReplaySpan): string {
  const args = s.toolArguments === undefined ? '' : JSON.stringify(s.toolArguments)
  return `${s.toolName ?? s.name}::${args}`
}

export function analyze(model: ReplayModel): Analysis {
  const { spans, meta } = model
  const tools = spans.filter(isTool)

  // ---- overview ----
  const toolCounts = new Map<string, number>()
  for (const s of tools) {
    const n = s.toolName ?? s.name
    toolCounts.set(n, (toolCounts.get(n) ?? 0) + 1)
  }
  const toolUsage = [...toolCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)

  // Cache-read tokens are reported *alongside* input tokens (not as a subset),
  // so the hit rate is cacheRead / (input + cacheRead) — otherwise it can
  // exceed 100%.
  const cacheRead = spans.reduce((a, s) => a + (s.tokens?.cacheRead ?? 0), 0)
  const cacheDenom = meta.totalInputTokens + cacheRead
  const cacheHitRate = cacheDenom > 0 ? cacheRead / cacheDenom : undefined

  const overview: Overview = {
    spanCount: meta.spanCount,
    timeAxis: meta.timeAxis,
    durationMs: meta.duration,
    reasoningSteps: spans.filter(isReasoning).length,
    toolCalls: tools.length,
    agentSteps: spans.filter(isAgent).length,
    totalInputTokens: meta.totalInputTokens,
    totalOutputTokens: meta.totalOutputTokens,
    cacheReadTokens: cacheRead,
    cacheHitRate,
    toolUsage,
    errorCount: spans.filter((s) => s.status === 'error').length,
  }

  // ---- issues (anomalies) + warnings (noteworthy) ----
  const issues: Issue[] = []
  const warnings: Warning[] = []

  // 1. Failed tool calls / errored spans.
  for (const s of spans) {
    if (s.status === 'error') {
      issues.push({
        kind: 'error',
        label: s.toolName ?? s.name,
        errorType: s.errorType,
        spanId: s.id,
      })
    }
  }

  // 2. Retries: the same tool called again shortly after (regardless of args).
  //    We flag the *second+* occurrence when it directly follows the same tool.
  const toolsByTime = [...tools].sort((a, b) => a.tStart - b.tStart)
  for (let i = 1; i < toolsByTime.length; i++) {
    const prev = toolsByTime[i - 1]
    const cur = toolsByTime[i]
    const sameName = (prev.toolName ?? prev.name) === (cur.toolName ?? cur.name)
    // a retry is most meaningful right after a failure
    if (sameName && prev.status === 'error') {
      issues.push({
        kind: 'retry',
        label: cur.toolName ?? cur.name,
        spanId: cur.id,
      })
    }
  }

  // 3. Loops: the exact same call (name + args) made 3+ times total.
  const keyCounts = new Map<string, ReplaySpan[]>()
  for (const s of tools) {
    const k = callKey(s)
    const arr = keyCounts.get(k) ?? []
    arr.push(s)
    keyCounts.set(k, arr)
  }
  for (const [, group] of keyCounts) {
    if (group.length >= 3) {
      const first = group[0]
      issues.push({
        kind: 'loop',
        label: first.toolName ?? first.name,
        count: group.length,
        spanId: first.id,
      })
    }
  }

  // Slow steps → WARNING, not an issue: a long step is noteworthy but not
  // necessarily wrong (heavy reasoning, a real install, etc.). Only meaningful
  // on a real time axis. Root/container agent spans cover the whole run by
  // definition, so they're excluded. Report only the few slowest outliers.
  if (meta.timeAxis === 'time') {
    const parentIds = new Set(spans.map((s) => s.parentId).filter(Boolean))
    const leafish = spans.filter((s) => !(isAgent(s) && parentIds.has(s.id)))
    const durations = leafish.map((s) => s.tEnd - s.tStart).filter((d) => d > 0)
    if (durations.length >= 4) {
      const sorted = [...durations].sort((a, b) => a - b)
      const median = sorted[Math.floor(sorted.length / 2)] || 1
      const threshold = Math.max(median * 4, 3000) // ≥4× median and ≥3s
      const slow = leafish
        .filter((s) => s.tEnd - s.tStart >= threshold)
        .sort((a, b) => b.tEnd - b.tStart - (a.tEnd - a.tStart))
        .slice(0, 3) // only the top few outliers
      for (const s of slow) {
        const dur = s.tEnd - s.tStart
        warnings.push({
          kind: 'slow',
          label: s.name,
          seconds: dur / 1000,
          ratio: dur / median,
          spanId: s.id,
        })
      }
    }
  }

  return { overview, issues, warnings }
}
