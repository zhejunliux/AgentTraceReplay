import { useMemo, useState } from 'react'
import { analyze } from '../model/analyze'
import type { Finding } from '../model/analyze'
import type { ReplayModel } from '../model/types'

interface Props {
  model: ReplayModel
  onJump: (spanId: string) => void
}

const KIND_STYLE: Record<string, { label: string; color: string }> = {
  error: { label: 'ERROR', color: '#f87171' },
  retry: { label: 'RETRY', color: '#fbbf24' },
  loop: { label: 'LOOP', color: '#f472b6' },
  slow: { label: 'SLOW', color: '#38bdf8' },
}

const fmt = (n: number) => n.toLocaleString('en-US')

// Findings carry structured params; the wording lives here in the UI layer
// (single place to localize later) rather than baked into analysis logic.
function findingText(f: Finding<string>): { title: string; detail: string } {
  switch (f.kind) {
    case 'error':
      return {
        title: `${f.label} failed`,
        detail: f.errorType ? `Error: ${f.errorType}` : 'Step ended in an error state.',
      }
    case 'retry':
      return {
        title: `${f.label} retried after failure`,
        detail: 'A tool call was repeated immediately after the previous one failed.',
      }
    case 'loop':
      return {
        title: `Possible loop: ${f.label} ×${f.count}`,
        detail: `The identical call (same arguments) was made ${f.count} times — the agent may be stuck.`,
      }
    case 'slow':
      return {
        title: `Slow step: ${f.label} (${(f.seconds ?? 0).toFixed(1)}s)`,
        detail: `This step took ${(f.ratio ?? 0).toFixed(1)}× the median step time.`,
      }
    default:
      return { title: f.label, detail: '' }
  }
}

export default function AnalysisPanel({ model, onJump }: Props) {
  const { overview: o, issues, warnings } = useMemo(() => analyze(model), [model])
  const [open, setOpen] = useState(true)

  return (
    <div className="rounded-lg border border-grid bg-panel/40">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-white">
          Analysis
          {issues.length > 0 && (
            <span className="rounded bg-danger/20 px-1.5 py-0.5 text-[11px] font-normal text-danger">
              {issues.length} {issues.length === 1 ? 'issue' : 'issues'}
            </span>
          )}
          {warnings.length > 0 && (
            <span className="rounded bg-tool/15 px-1.5 py-0.5 text-[11px] font-normal text-tool">
              {warnings.length} {warnings.length === 1 ? 'warning' : 'warnings'}
            </span>
          )}
        </span>
        <span className="text-muted">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="grid grid-cols-1 gap-4 border-t border-grid p-4 lg:grid-cols-[1fr_1fr]">
          {/* ---- overview ---- */}
          <div>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Overview</h3>
            <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
              <Stat v={String(o.spanCount)} l="spans" />
              {o.timeAxis === 'time' && <Stat v={`${(o.durationMs / 1000).toFixed(1)}s`} l="duration" />}
              <Stat v={String(o.reasoningSteps)} l="think" />
              <Stat v={String(o.toolCalls)} l="tools" />
              {o.agentSteps > 0 && <Stat v={String(o.agentSteps)} l="agents" />}
              {o.errorCount > 0 && <Stat v={String(o.errorCount)} l="errors" danger />}
            </div>

            {(o.totalInputTokens > 0 || o.totalOutputTokens > 0) && (
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
                <Stat v={fmt(o.totalInputTokens)} l="in tok" />
                <Stat v={fmt(o.totalOutputTokens)} l="out tok" />
                {o.cacheHitRate !== undefined && o.cacheReadTokens > 0 && (
                  <Stat v={`${(o.cacheHitRate * 100).toFixed(0)}%`} l="cache hit" />
                )}
              </div>
            )}

            {o.toolUsage.length > 0 && (
              <div className="mt-3">
                <div className="mb-1 text-[10px] uppercase text-muted">tool usage</div>
                <div className="flex flex-wrap gap-1.5">
                  {o.toolUsage.map((t) => (
                    <span key={t.name} className="rounded bg-tool/10 px-2 py-0.5 text-[11px] text-tool">
                      {t.name} <span className="text-muted">×{t.count}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ---- issues ---- */}
          <div>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
              Issues
            </h3>
            {issues.length === 0 ? (
              <p className="text-sm text-muted">No obvious issues detected — no errors, retries, or loops.</p>
            ) : (
              <FindingList findings={issues} onJump={onJump} />
            )}

            {warnings.length > 0 && (
              <>
                <h3 className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wide text-muted">
                  Warnings
                </h3>
                <FindingList findings={warnings} onJump={onJump} />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function FindingList({ findings, onJump }: { findings: Finding<string>[]; onJump: (id: string) => void }) {
  return (
    <ul className="space-y-1.5">
      {findings.map((f, i) => {
        const st = KIND_STYLE[f.kind] ?? { label: f.kind.toUpperCase(), color: '#5b6a7d' }
        const { title, detail } = findingText(f)
        return (
          <li key={i}>
            <button
              onClick={() => onJump(f.spanId)}
              className="flex w-full items-start gap-2 rounded border border-grid bg-ink/40 px-2.5 py-1.5 text-left transition hover:border-muted"
            >
              <span
                className="mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold"
                style={{ background: st.color + '22', color: st.color }}
              >
                {st.label}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-xs text-white">{title}</span>
                <span className="block text-[11px] text-muted">{detail}</span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function Stat({ v, l, danger }: { v: string; l: string; danger?: boolean }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className={`font-mono ${danger ? 'text-danger' : 'text-white'}`}>{v}</span>
      <span className="text-[11px] uppercase text-muted">{l}</span>
    </span>
  )
}
