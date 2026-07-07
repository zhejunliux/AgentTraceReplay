import { heuristicToReplayModel } from './heuristicAdapter'
import { messagesToReplayModel } from './messagesAdapter'
import { otlpToReplayModel } from './otlpAdapter'
import { trajectoryToReplayModel } from './trajectoryAdapter'
import type { ReplayModel } from './types'

// Picks the right adapter for an arbitrary parsed-JSON trace. Structured
// formats are detected by signature fields; anything else falls through to the
// heuristic scanner. Never throws for detection alone — the chosen adapter may
// still throw if the data is malformed, and we chain to the next best option.

type Json = unknown

function isObj(x: Json): x is Record<string, Json> {
  return !!x && typeof x === 'object' && !Array.isArray(x)
}

export function toReplayModel(doc: Json, title = 'Agent run'): ReplayModel {
  // 1. OTLP: has resourceSpans[].
  if (isObj(doc) && Array.isArray(doc.resourceSpans)) {
    return otlpToReplayModel(doc as never, title)
  }

  // 2. Trajectory: top-level trajectory[] (ReAct / DAComp).
  if (isObj(doc) && Array.isArray(doc.trajectory)) {
    return trajectoryToReplayModel(doc as never, title)
  }

  // 3. Chat messages: top-level messages[] with role fields.
  if (isObj(doc) && Array.isArray(doc.messages) && looksLikeMessages(doc.messages)) {
    return messagesToReplayModel(doc as never, title)
  }

  // 4. A bare array — could be messages or steps.
  if (Array.isArray(doc)) {
    if (looksLikeMessages(doc)) return messagesToReplayModel({ messages: doc as never }, title)
    return heuristicToReplayModel(doc, title)
  }

  // 5. Fallback: scan for the best array anywhere in the object.
  return heuristicToReplayModel(doc, title)
}

function looksLikeMessages(arr: Json[]): boolean {
  const objs = arr.filter(isObj)
  if (objs.length === 0) return false
  const withRole = objs.filter((o) => typeof o.role === 'string').length
  return withRole / objs.length >= 0.5
}
