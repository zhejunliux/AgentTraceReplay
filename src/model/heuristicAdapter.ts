import { messagesToReplayModel } from './messagesAdapter'
import { trajectoryToReplayModel } from './trajectoryAdapter'
import type { ReplayModel } from './types'

// Last-resort adapter for unknown JSON. It walks the object graph to find the
// most promising array — either message-like (objects with a `role`) or
// step-like (objects with thought/action/observation) — then hands it to the
// matching structured adapter. Marks the result as best-effort.

type Json = unknown

function isObj(x: Json): x is Record<string, Json> {
  return !!x && typeof x === 'object' && !Array.isArray(x)
}

interface Candidate {
  kind: 'messages' | 'trajectory'
  score: number
  array: Record<string, Json>[]
  key: string
}

function scoreArray(key: string, arr: Json[]): Candidate | null {
  const objs = arr.filter(isObj) as Record<string, Json>[]
  if (objs.length < 2) return null
  const frac = objs.length / arr.length
  if (frac < 0.6) return null

  const withRole = objs.filter((o) => typeof o.role === 'string').length
  const withStep = objs.filter(
    (o) => 'thought' in o || 'action' in o || 'observation' in o,
  ).length

  const roleFrac = withRole / objs.length
  const stepFrac = withStep / objs.length

  // Key-name hints boost confidence.
  const keyBoost = /message|conversation|history|trajectory|step|turn/i.test(key) ? 0.2 : 0

  if (roleFrac >= stepFrac && roleFrac >= 0.5) {
    return { kind: 'messages', score: roleFrac + keyBoost + Math.min(objs.length, 50) / 500, array: objs, key }
  }
  if (stepFrac >= 0.5) {
    return { kind: 'trajectory', score: stepFrac + keyBoost + Math.min(objs.length, 50) / 500, array: objs, key }
  }
  return null
}

function findBest(root: Json): Candidate | null {
  let best: Candidate | null = null
  const seen = new Set<Json>()
  const visit = (node: Json, key: string, depth: number) => {
    if (depth > 6 || node === null || typeof node !== 'object') return
    if (seen.has(node)) return
    seen.add(node)
    if (Array.isArray(node)) {
      const c = scoreArray(key, node)
      if (c && (!best || c.score > best.score)) best = c
      // still descend, in case a nested array scores higher
      node.forEach((v) => visit(v, key, depth + 1))
      return
    }
    for (const [k, v] of Object.entries(node)) visit(v, k, depth + 1)
  }
  visit(root, 'root', 0)
  return best
}

export function heuristicToReplayModel(doc: Json, fallbackTitle = 'Agent run'): ReplayModel {
  const best = findBest(doc)
  if (!best) {
    throw new Error(
      'Unrecognized trace format. Convert your run to one of the supported shapes below (OTLP gen_ai, chat messages, or agent trajectory) and try again.',
    )
  }

  let model: ReplayModel
  if (best.kind === 'messages') {
    model = messagesToReplayModel({ messages: best.array as never }, fallbackTitle)
  } else {
    model = trajectoryToReplayModel({ trajectory: best.array as never }, fallbackTitle)
  }
  // Mark provenance so the UI can flag best-effort parsing.
  model.meta.sourceFormat = `Heuristic → ${best.kind} (key "${best.key}")`
  return model
}
