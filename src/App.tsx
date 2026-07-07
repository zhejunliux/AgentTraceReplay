import { useCallback, useEffect, useMemo, useState } from 'react'
import AnalysisPanel from './components/AnalysisPanel'
import FileDropzone from './components/FileDropzone'
import PlaybackBar from './components/PlaybackBar'
import SpanDetail from './components/SpanDetail'
import SupportedFormats from './components/SupportedFormats'
import Timeline from './components/Timeline'
import { usePlayback } from './hooks/usePlayback'
import { STEP_MS } from './model/buildModel'
import { toReplayModel } from './model/detect'
import type { ReplayModel, ReplaySpan } from './model/types'

export default function App() {
  const [model, setModel] = useState<ReplayModel | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<ReplaySpan | undefined>()

  const loadJson = useCallback((json: unknown, title: string) => {
    try {
      const m = toReplayModel(json, title)
      setModel(m)
      setSelected(undefined)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to parse trace.')
    }
  }, [])

  // Load the built-in sample on first mount.
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}samples/coding-agent.otlp.json`)
      .then((r) => r.json())
      .then((j) => loadJson(j, 'Fix failing auth test'))
      .catch(() => setError('Could not load the built-in sample.'))
  }, [loadJson])

  return (
    <div className="mx-auto flex min-h-screen max-w-[1400px] flex-col gap-4 p-5">
      <Header onLoad={loadJson} onError={setError} />

      {error && (
        <div className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      {model ? (
        <ReplayView model={model} selected={selected} onSelect={setSelected} />
      ) : error ? (
        <SupportedFormats />
      ) : (
        <div className="p-10 text-center text-muted">Loading sample…</div>
      )}

      <Footer />
    </div>
  )
}

function ReplayView({
  model,
  selected,
  onSelect,
}: {
  model: ReplayModel
  selected?: ReplaySpan
  onSelect: (s: ReplaySpan | undefined) => void
}) {
  const pb = usePlayback(model.meta.duration)
  const stats = useMemo(() => model.meta, [model])
  const [zoom, setZoom] = usePersistentNumber('agenttracereplay.zoom', 1)

  // Keyboard controls, video-player style. Ignored while typing in an input so
  // the range sliders keep their native arrow-key behavior.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
      const step = model.meta.timeAxis === 'step' ? STEP_MS : model.meta.duration / 40
      switch (e.key) {
        case ' ':
          e.preventDefault()
          pb.t >= model.meta.duration ? pb.restart() : pb.toggle()
          break
        case 'ArrowRight':
          e.preventDefault()
          pb.seek(pb.t + step)
          break
        case 'ArrowLeft':
          e.preventDefault()
          pb.seek(pb.t - step)
          break
        case 'Escape':
          onSelect(undefined)
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pb, model.meta.duration, model.meta.timeAxis, onSelect])

  return (
    <>
      <StatStrip meta={stats} />
      <PlaybackBar
        pb={pb}
        duration={model.meta.duration}
        timeAxis={stats.timeAxis}
        zoom={zoom}
        onZoom={setZoom}
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_380px]">
        <Timeline model={model} t={pb.t} zoom={zoom} selectedId={selected?.id} onSelect={onSelect} onSeek={pb.seek} />
        <div className="h-[420px] lg:h-auto">
          <SpanDetail span={selected} onClose={() => onSelect(undefined)} />
        </div>
      </div>
      <AnalysisPanel
        model={model}
        onJump={(id) => {
          const s = model.spans.find((sp) => sp.id === id)
          if (s) onSelect(s)
        }}
      />
    </>
  )
}

function Header({
  onLoad,
  onError,
}: {
  onLoad: (j: unknown, n: string) => void
  onError: (m: string) => void
}) {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-white">
          <img src="./favicon.svg" alt="" className="h-6 w-6" />
          AgentTrace<span className="text-signal">Replay</span>
        </h1>
        <p className="mt-0.5 text-sm text-muted">
          Play back an agent run like a video. Watch it think, call tools, recover from failures.
        </p>
      </div>
      <div className="sm:w-[380px]">
        <FileDropzone onLoad={onLoad} onError={onError} />
      </div>
    </header>
  )
}

function StatStrip({ meta }: { meta: ReplayModel['meta'] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg border border-grid bg-panel/40 px-4 py-2.5 text-sm">
      <span className="font-semibold text-white">{meta.title}</span>
      <Stat label="spans" value={String(meta.spanCount)} />
      {meta.timeAxis === 'time' && <Stat label="duration" value={`${(meta.duration / 1000).toFixed(1)}s`} />}
      {meta.totalInputTokens > 0 && <Stat label="in" value={meta.totalInputTokens.toLocaleString('en-US')} />}
      {meta.totalOutputTokens > 0 && <Stat label="out" value={meta.totalOutputTokens.toLocaleString('en-US')} />}
      {meta.rootModel && <Stat label="model" value={meta.rootModel} />}
      <span className="ml-auto flex items-center gap-1.5 text-[11px] text-muted">
        <span className="h-1.5 w-1.5 rounded-full bg-signal/60" />
        {meta.sourceFormat}
        {meta.timeAxis === 'step' && <span className="text-muted/70"> · step axis</span>}
      </span>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="font-mono text-white">{value}</span>
      <span className="text-[11px] uppercase text-muted">{label}</span>
    </span>
  )
}

// A number backed by localStorage, so UI prefs (zoom) survive trace reloads
// and page refreshes. Degrades to plain state if storage is unavailable.
function usePersistentNumber(key: string, fallback: number) {
  const [v, setV] = useState(() => {
    try {
      const raw = localStorage.getItem(key)
      const n = raw === null ? NaN : Number(raw)
      return Number.isFinite(n) ? n : fallback
    } catch {
      return fallback
    }
  })
  const set = useCallback(
    (n: number) => {
      setV(n)
      try {
        localStorage.setItem(key, String(n))
      } catch {
        /* ignore */
      }
    },
    [key],
  )
  return [v, set] as const
}

function Footer() {
  return (
    <footer className="mt-auto pt-2 text-center text-xs text-muted">
      Reads OpenTelemetry <code className="text-signal">gen_ai.*</code> traces · runs 100% in your browser · no data leaves the page
    </footer>
  )
}
