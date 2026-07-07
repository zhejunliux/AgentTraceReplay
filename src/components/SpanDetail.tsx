import { useState } from 'react'
import type { Message, ReplaySpan } from '../model/types'
import { TRACK_STYLE } from '../styles/tracks'

interface Props {
  span?: ReplaySpan
  onClose: () => void
}

export default function SpanDetail({ span, onClose }: Props) {
  if (!span) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-grid bg-panel/40 p-6 text-center text-sm text-muted">
        Click any node on the timeline to inspect its messages, tool call, and tokens.
      </div>
    )
  }
  const st = TRACK_STYLE[span.track]
  const dur = (span.tEnd - span.tStart) / 1000

  return (
    <div className="flex h-full flex-col rounded-lg border border-grid bg-panel/60">
      <div className="flex items-start justify-between border-b border-grid p-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: st.color + '22', color: st.color }}>
              {st.label}
            </span>
            {span.status === 'error' && (
              <span className="rounded bg-danger/20 px-1.5 py-0.5 text-[10px] font-semibold text-danger">
                {span.errorType ?? 'ERROR'}
              </span>
            )}
          </div>
          <h2 className="mt-1.5 font-mono text-sm text-white">{span.name}</h2>
          <div className="mt-1 text-xs text-muted">
            {span.provider ? span.provider + ' · ' : ''}
            {span.model ?? span.operation} · {dur.toFixed(1)}s · @{(span.tStart / 1000).toFixed(1)}s
          </div>
        </div>
        <button onClick={onClose} className="text-muted hover:text-white" aria-label="Close">
          ✕
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {span.tokens && <TokenBar tokens={span.tokens} />}

        {span.systemInstructions && (
          <Section title="System instructions">
            <pre className="whitespace-pre-wrap text-xs text-muted">{span.systemInstructions}</pre>
          </Section>
        )}

        {span.toolName && (
          <Section title="Tool call">
            {span.toolArguments !== undefined && (
              <Labeled label="arguments">
                <Code value={span.toolArguments} />
              </Labeled>
            )}
            {span.toolResult !== undefined && (
              <Labeled label="result">
                <Code value={span.toolResult} />
              </Labeled>
            )}
          </Section>
        )}

        {span.inputMessages && <Messages title="Input messages" messages={span.inputMessages} />}
        {span.outputMessages && <Messages title="Output messages" messages={span.outputMessages} />}
      </div>
    </div>
  )
}

function TokenBar({ tokens }: { tokens: NonNullable<ReplaySpan['tokens']> }) {
  const items = [
    { label: 'in', v: tokens.input, c: '#38bdf8' },
    { label: 'cache', v: tokens.cacheRead, c: '#2dd4bf' },
    { label: 'out', v: tokens.output, c: '#4ade80' },
    { label: 'reason', v: tokens.reasoning, c: '#fbbf24' },
  ].filter((i) => i.v !== undefined)
  if (!items.length) return null
  return (
    <div className="flex flex-wrap gap-3">
      {items.map((i) => (
        <div key={i.label} className="flex items-baseline gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: i.c }} />
          <span className="font-mono text-sm text-white">{i.v!.toLocaleString('en-US')}</span>
          <span className="text-[10px] uppercase text-muted">{i.label}</span>
        </div>
      ))}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">{title}</h3>
      {children}
    </div>
  )
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-2">
      <div className="mb-1 text-[10px] uppercase text-muted">{label}</div>
      {children}
    </div>
  )
}

function Messages({ title, messages }: { title: string; messages: Message[] }) {
  return (
    <Section title={title}>
      <div className="space-y-2">
        {messages.map((m, i) => (
          <div key={i} className="rounded border border-grid bg-ink/60 p-2">
            <div className="mb-1 text-[10px] uppercase text-signal">{m.role}{m.finishReason ? ` · ${m.finishReason}` : ''}</div>
            <div className="space-y-1.5">
              {m.parts.map((p, j) => (
                <PartView key={j} part={p} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </Section>
  )
}

function PartView({ part }: { part: Message['parts'][number] }) {
  if (part.type === 'text') {
    return <p className="whitespace-pre-wrap text-xs text-[#cdd6e0]">{part.content}</p>
  }
  if (part.type === 'tool_call') {
    return (
      <div className="rounded bg-tool/10 p-1.5">
        <span className="text-[11px] text-tool">→ {part.name}(</span>
        <Code value={part.arguments} inline />
        <span className="text-[11px] text-tool">)</span>
      </div>
    )
  }
  return (
    <div className="rounded bg-grid/40 p-1.5">
      <span className="text-[10px] uppercase text-muted">← response </span>
      <Code value={part.response} inline />
    </div>
  )
}

// Long tool results/args are collapsed to a preview with a "Show all" toggle
// so a giant table or log dump doesn't blow out the panel height.
const COLLAPSE_LINES = 12
const COLLAPSE_CHARS = 800

function Code({ value, inline }: { value: unknown; inline?: boolean }) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, inline ? 0 : 2)
  const [expanded, setExpanded] = useState(false)

  const lines = text.split('\n')
  const isLong = !inline && (lines.length > COLLAPSE_LINES || text.length > COLLAPSE_CHARS)

  if (!isLong) {
    return (
      <pre className={`overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] text-[#9fb0c3] ${inline ? 'inline' : ''}`}>
        {text}
      </pre>
    )
  }

  const preview = lines.slice(0, COLLAPSE_LINES).join('\n')
  const hiddenLines = lines.length - COLLAPSE_LINES

  return (
    <div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] text-[#9fb0c3]">
        {expanded ? text : preview + (hiddenLines > 0 ? '\n…' : '')}
      </pre>
      <button
        onClick={() => setExpanded((e) => !e)}
        className="mt-1 text-[11px] font-semibold text-signal hover:underline"
      >
        {expanded ? 'Show less' : `Show all (${lines.length.toLocaleString('en-US')} lines)`}
      </button>
    </div>
  )
}
