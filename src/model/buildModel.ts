import type { ReplayModel, ReplaySpan } from './types'

// One synthetic time unit per step (ms), used when the source has no real
// timestamps. Purely for laying spans out left-to-right on the timeline.
export const STEP_MS = 1000

export interface BuildInput {
  title: string
  sourceFormat: string
  timeAxis: 'time' | 'step'
  rootModel?: string
  spans: ReplaySpan[]
}

// Finalizes a set of spans into a ReplayModel: computes depth, duration,
// token totals, and sorts by start time. Spans must already have tStart/tEnd
// set (in ms — real or synthetic).
export function buildModel(input: BuildInput): ReplayModel {
  const { spans } = input
  const byId = new Map(spans.map((s) => [s.id, s]))

  const depthCache = new Map<string, number>()
  const depthOf = (id: string, guard = 0): number => {
    if (guard > 64) return 0
    if (depthCache.has(id)) return depthCache.get(id)!
    const s = byId.get(id)
    if (!s || !s.parentId || !byId.has(s.parentId)) {
      depthCache.set(id, 0)
      return 0
    }
    const d = depthOf(s.parentId, guard + 1) + 1
    depthCache.set(id, d)
    return d
  }
  for (const s of spans) s.depth = depthOf(s.id)

  spans.sort((a, b) => a.tStart - b.tStart)

  // Reduce, not Math.max(...spread), so large runs can't overflow the arg limit.
  let duration = 1
  for (const s of spans) if (s.tEnd > duration) duration = s.tEnd

  return {
    meta: {
      title: input.title,
      duration,
      spanCount: spans.length,
      totalInputTokens: spans.reduce((a, s) => a + (s.tokens?.input ?? 0), 0),
      totalOutputTokens: spans.reduce((a, s) => a + (s.tokens?.output ?? 0), 0),
      rootModel: input.rootModel,
      sourceFormat: input.sourceFormat,
      timeAxis: input.timeAxis,
    },
    spans,
  }
}
