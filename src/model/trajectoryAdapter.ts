import { STEP_MS, buildModel } from './buildModel'
import { toolTrack } from './toolTrack'
import type { ReplayModel, ReplaySpan, Track } from './types'

// Handles ReAct-style trajectories (e.g. DAComp): an array of steps, each with
// some subset of { thought, action, observation, response }. Each step becomes
// a reasoning span (the thought), optionally with a tool span (the action)
// branching off it. Laid out on a synthetic step axis.

interface TrajStep {
  thought?: string
  action?: string
  observation?: string
  response?: string
  [k: string]: unknown
}

interface TrajectoryDoc {
  trajectory?: TrajStep[]
  steps?: unknown
  Task?: unknown
  task?: unknown
  system_message?: string
  result?: unknown
  finished?: boolean
}

// Parse "ToolName(arg=..., other=...)" or "ToolName(code=\"...\")" into a name
// plus a best-effort argument object/string.
function parseAction(action: string): { name: string; args: unknown; isTerminate: boolean } {
  const m = action.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(([\s\S]*)\)\s*$/)
  if (!m) {
    const word = action.trim().split(/[\s(]/)[0] || 'action'
    return { name: word, args: action.trim(), isTerminate: /terminate|finish|done/i.test(word) }
  }
  const name = m[1]
  const inner = m[2].trim()
  return {
    name,
    args: inner.length ? inner : undefined,
    isTerminate: /terminate|finish|done/i.test(name),
  }
}

function cleanThought(t?: string): string | undefined {
  if (!t) return undefined
  // Strip stray think-tag fragments some models emit.
  return t.replace(/<\/?[a-z_]*think[a-z_]*>/gi, '').trim() || undefined
}

export function trajectoryToReplayModel(doc: TrajectoryDoc, fallbackTitle = 'Agent trajectory'): ReplayModel {
  const steps = doc.trajectory ?? []
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new Error('No trajectory[] steps found.')
  }

  const spans: ReplaySpan[] = []
  let slot = 0
  const take = (frac = 0.8) => {
    const start = slot * STEP_MS
    slot += 1
    return { start, end: start + STEP_MS * frac }
  }

  steps.forEach((st, i) => {
    const thought = cleanThought(st.thought)
    const response = typeof st.response === 'string' ? st.response.trim() : undefined
    const think = take()
    const thinkId = `step-${i}`
    // A step may carry both a thought and a final response (e.g. the last
    // ReAct step). Surface both as parts so neither is silently dropped.
    const outParts = []
    if (thought) outParts.push({ type: 'text' as const, content: thought })
    if (response) outParts.push({ type: 'text' as const, content: response })
    spans.push({
      id: thinkId,
      track: 'reasoning',
      operation: 'chat',
      name: `step ${i + 1}`,
      tStart: think.start,
      tEnd: think.end,
      status: 'ok',
      outputMessages: outParts.length
        ? [{ role: 'assistant', parts: outParts }]
        : undefined,
      depth: 0,
    })

    if (st.action) {
      const { name, args, isTerminate } = parseAction(st.action)
      const track: Track = isTerminate ? 'agent' : toolTrack(name)
      const act = take()
      spans.push({
        id: `act-${i}`,
        parentId: thinkId,
        track,
        operation: isTerminate ? 'invoke_agent' : 'execute_tool',
        name,
        toolName: isTerminate ? undefined : name,
        tStart: act.start,
        tEnd: act.end,
        status: 'ok',
        toolArguments: isTerminate ? undefined : args,
        toolResult: st.observation,
        depth: 0,
      })
    } else if (st.observation) {
      // Observation without an explicit action — attach to the thought span.
      const last = spans[spans.length - 1]
      last.toolResult = st.observation
    }
  })

  const taskText =
    typeof doc.Task === 'string' ? doc.Task : typeof doc.task === 'string' ? doc.task : undefined
  const title = taskText ? truncate(taskText, 60) : fallbackTitle

  // Surface the task as system instructions on the first step.
  if (taskText && spans[0]) spans[0].systemInstructions = taskText

  return buildModel({
    title,
    sourceFormat: 'Agent trajectory (ReAct / DAComp)',
    timeAxis: 'step',
    spans,
  })
}

function truncate(s: string, n: number): string {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > n ? one.slice(0, n - 1) + '…' : one
}
