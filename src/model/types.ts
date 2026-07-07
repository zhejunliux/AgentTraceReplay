// Internal normalized model. The UI depends only on this — never on raw OTLP.
// New input formats (Langfuse, custom) just need another adapter -> ReplayModel.

// Track = which horizontal lane a span lives on in the subway map.
// Derived from gen_ai.operation.name; tool spans are further split into
// semantic sub-lanes (command / file / query / search / network) so the kind
// of action is readable at a glance. 'tool' is the generic fallback.
export type Track =
  | 'reasoning'
  | 'agent'
  | 'plan'
  | 'memory'
  | 'retrieval'
  | 'tool_cmd'
  | 'tool_file'
  | 'tool_query'
  | 'tool_search'
  | 'tool_net'
  | 'tool'
  | 'other'

export type SpanStatus = 'ok' | 'error'

// A single part of a chat message, per OTel gen_ai message schema.
export type MessagePart =
  | { type: 'text'; content: string }
  | { type: 'tool_call'; id?: string; name: string; arguments?: unknown }
  | { type: 'tool_call_response'; id?: string; response: unknown }

export interface Message {
  role: string // user | assistant | tool | system
  parts: MessagePart[]
  finishReason?: string
}

// Token accounting — the data source for the future "Context X-ray".
// Parsed now, only lightly surfaced in this MVP.
export interface TokenUsage {
  input?: number
  output?: number
  cacheRead?: number
  cacheCreation?: number
  reasoning?: number
}

export interface ReplaySpan {
  id: string
  parentId?: string
  track: Track
  operation: string // raw gen_ai.operation.name
  name: string // display label
  model?: string
  provider?: string
  toolName?: string
  // Times normalized to milliseconds relative to run start (t=0).
  tStart: number
  tEnd: number
  status: SpanStatus
  errorType?: string
  tokens?: TokenUsage
  systemInstructions?: string
  inputMessages?: Message[]
  outputMessages?: Message[]
  toolArguments?: unknown
  toolResult?: unknown
  // Depth in the parent/child tree (0 = root), used for lane offset & folding.
  depth: number
}

export interface ReplayMeta {
  title: string
  // Total duration in ms. When timeAxis is 'step', this is a synthetic axis
  // (one unit per step) rather than real wall-clock time.
  duration: number
  spanCount: number
  // Sum of output tokens across the run — a cheap headline stat.
  totalInputTokens: number
  totalOutputTokens: number
  rootModel?: string
  // Where the model came from + whether the timeline is real time or step-based.
  sourceFormat: string
  timeAxis: 'time' | 'step'
}

export interface ReplayModel {
  meta: ReplayMeta
  spans: ReplaySpan[]
}
