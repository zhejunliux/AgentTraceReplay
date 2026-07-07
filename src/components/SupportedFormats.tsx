// Explains the input contract: we don't chase every framework's native log —
// you convert your trace into one of these shapes and drop it in.

interface FormatCard {
  name: string
  blurb: string
  axis: string
  snippet: string
}

const FORMATS: FormatCard[] = [
  {
    name: 'OpenTelemetry gen_ai',
    blurb: 'Standard OTLP trace export. Real timestamps.',
    axis: 'real time',
    snippet: `{ "resourceSpans": [{ "scopeSpans": [{ "spans": [
  { "spanId": "...", "startTimeUnixNano": "...",
    "endTimeUnixNano": "...", "attributes": [
      { "key": "gen_ai.operation.name",
        "value": { "stringValue": "chat" } } ] } ]}]}] }`,
  },
  {
    name: 'Chat messages',
    blurb: 'OpenAI / Anthropic message log with tool calls.',
    axis: 'step axis',
    snippet: `{ "messages": [
  { "role": "user", "content": "fix the test" },
  { "role": "assistant", "content": "...",
    "tool_calls": [{ "function":
      { "name": "Bash", "arguments": {...} } }] },
  { "role": "tool", "tool_call_id": "...",
    "name": "Bash", "content": "..." } ] }`,
  },
  {
    name: 'Agent trajectory',
    blurb: 'ReAct-style steps (thought / action / observation).',
    axis: 'step axis',
    snippet: `{ "trajectory": [
  { "thought": "explore the workspace",
    "action": "Bash(code=\\"ls -la\\")",
    "observation": "app/  tests/  README" } ] }`,
  },
]

export default function SupportedFormats() {
  return (
    <div className="rounded-lg border border-grid bg-panel/40 p-5">
      <h2 className="text-sm font-semibold text-white">Supported input formats</h2>
      <p className="mt-1 text-xs text-muted">
        AgentTraceReplay reads three trace shapes. Using Claude Code, Codex, OpenHands, opencode, goose, or
        anything else? Convert your run into one of these and drop it in — format is auto-detected.
      </p>
      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        {FORMATS.map((f) => (
          <div key={f.name} className="flex flex-col rounded-lg border border-grid bg-ink/50 p-3">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-semibold text-signal">{f.name}</span>
              <span className="text-[10px] uppercase text-muted">{f.axis}</span>
            </div>
            <p className="mt-1 mb-2 text-[11px] text-muted">{f.blurb}</p>
            <pre className="flex-1 overflow-x-auto rounded bg-black/40 p-2 font-mono text-[10px] leading-relaxed text-[#9fb0c3]">
              {f.snippet}
            </pre>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-muted/80">
        Unknown JSON is still parsed best-effort: any array of role-tagged messages or
        thought/action steps found anywhere in the file will be mapped.
      </p>
    </div>
  )
}
