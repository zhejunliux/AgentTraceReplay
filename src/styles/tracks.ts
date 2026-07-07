import type { Track } from '../model/types'

// Ordered lanes of the subway map, top to bottom. Tool sub-lanes are grouped
// together (blue family) so they read as "kinds of tool call".
export const TRACK_ORDER: Track[] = [
  'agent',
  'plan',
  'reasoning',
  'tool_cmd',
  'tool_file',
  'tool_query',
  'tool_search',
  'tool_net',
  'tool',
  'retrieval',
  'memory',
  'other',
]

interface TrackStyle {
  label: string
  color: string // hex, matches tailwind.config colors
}

export const TRACK_STYLE: Record<Track, TrackStyle> = {
  agent: { label: 'AGENT', color: '#c084fc' },
  plan: { label: 'PLAN', color: '#fbbf24' },
  reasoning: { label: 'THINK', color: '#4ade80' },
  // Tool sub-lanes — one blue family, varied hue/lightness to stay related.
  tool_cmd: { label: 'COMMAND', color: '#38bdf8' },
  tool_file: { label: 'FILE', color: '#60a5fa' },
  tool_query: { label: 'QUERY', color: '#22d3ee' },
  tool_search: { label: 'SEARCH', color: '#818cf8' },
  tool_net: { label: 'NETWORK', color: '#0ea5e9' },
  tool: { label: 'TOOL', color: '#38bdf8' },
  retrieval: { label: 'RETRIEVE', color: '#2dd4bf' },
  memory: { label: 'MEMORY', color: '#f472b6' },
  other: { label: 'OTHER', color: '#5b6a7d' },
}

export const DANGER = '#f87171'
