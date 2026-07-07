import type { Track } from './types'

// Classify a tool by name into a semantic sub-lane, so the timeline shows what
// KIND of action each tool call is (run a command, touch a file, query data,
// search, hit the network) rather than piling every tool on one row.
// Matching is by lowercased substring — resilient to framework naming quirks
// (Bash, run_shell, execute_command all land on "command", etc.).

const RULES: { track: Track; patterns: RegExp }[] = [
  { track: 'tool_query', patterns: /sql|query|database|\bdb\b|sqlite|postgres|mysql/ },
  { track: 'tool_file', patterns: /read|write|edit|create_?file|open|cat|file|patch|apply_?patch|notebook/ },
  { track: 'tool_search', patterns: /search|grep|glob|find|ripgrep|lookup|retrieve/ },
  { track: 'tool_net', patterns: /fetch|http|web|url|browse|curl|request|api/ },
  { track: 'tool_cmd', patterns: /bash|shell|command|exec|terminal|run_?tests?|sh\b|zsh/ },
]

export function toolTrack(name: string | undefined): Track {
  if (!name) return 'tool'
  const n = name.toLowerCase()
  for (const r of RULES) if (r.patterns.test(n)) return r.track
  return 'tool'
}
