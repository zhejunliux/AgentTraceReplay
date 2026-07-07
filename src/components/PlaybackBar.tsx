import type { Playback } from '../hooks/usePlayback'

import { STEP_MS } from '../model/buildModel'

interface Props {
  pb: Playback
  duration: number
  timeAxis: 'time' | 'step'
  zoom: number
  onZoom: (z: number) => void
}

const SPEEDS = [1, 2, 4, 8]
const ZOOM_MIN = 1
const ZOOM_MAX = 12

export default function PlaybackBar({ pb, duration, timeAxis, zoom, onZoom }: Props) {
  const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z))
  const pct = duration > 0 ? (pb.t / duration) * 100 : 0
  const atEnd = pb.t >= duration
  const label =
    timeAxis === 'time'
      ? `${(pb.t / 1000).toFixed(1)}s / ${(duration / 1000).toFixed(1)}s`
      : `step ${Math.min(Math.floor(pb.t / STEP_MS) + 1, Math.round(duration / STEP_MS))} / ${Math.round(duration / STEP_MS)}`

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-grid bg-panel px-4 py-3">
      <button
        onClick={atEnd ? pb.restart : pb.toggle}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-signal/15 text-signal transition hover:bg-signal/25"
        aria-label={pb.playing ? 'Pause' : 'Play'}
      >
        {atEnd ? <RestartIcon /> : pb.playing ? <PauseIcon /> : <PlayIcon />}
      </button>

      <div className="flex-1">
        <input
          type="range"
          min={0}
          max={duration}
          step={Math.max(1, Math.round(duration / 1000))}
          value={pb.t}
          onChange={(e) => pb.seek(Number(e.target.value))}
          className="w-full accent-signal"
          style={{
            background: `linear-gradient(to right, #4ade80 ${pct}%, #1c2532 ${pct}%)`,
          }}
        />
      </div>

      <div className="w-28 shrink-0 text-right font-mono text-xs text-muted">
        {label}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {SPEEDS.map((s) => (
          <button
            key={s}
            onClick={() => pb.setSpeed(s)}
            className={`rounded px-2 py-1 text-xs transition ${
              pb.speed === s ? 'bg-signal/20 text-signal' : 'text-muted hover:text-white'
            }`}
          >
            {s}×
          </button>
        ))}
      </div>

      {/* divider */}
      <div className="h-6 w-px shrink-0 bg-grid" />

      {/* zoom — stretches the timeline horizontally to separate dense nodes */}
      <div className="flex shrink-0 items-center gap-1.5 text-xs text-muted">
        <span className="hidden uppercase tracking-wide sm:inline">zoom</span>
        <button
          onClick={() => onZoom(clampZoom(zoom - 1))}
          className="flex h-6 w-6 items-center justify-center rounded border border-grid hover:border-muted hover:text-white"
          aria-label="Zoom out"
        >
          −
        </button>
        <input
          type="range"
          min={ZOOM_MIN}
          max={ZOOM_MAX}
          step={0.5}
          value={zoom}
          onChange={(e) => onZoom(Number(e.target.value))}
          className="w-20 accent-signal"
        />
        <button
          onClick={() => onZoom(clampZoom(zoom + 1))}
          className="flex h-6 w-6 items-center justify-center rounded border border-grid hover:border-muted hover:text-white"
          aria-label="Zoom in"
        >
          +
        </button>
        <span className="w-7 font-mono text-white">{zoom.toFixed(zoom % 1 ? 1 : 0)}×</span>
      </div>
    </div>
  )
}

function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
      <path d="M3 2l9 5-9 5z" />
    </svg>
  )
}
function PauseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
      <rect x="3" y="2" width="3" height="10" rx="1" />
      <rect x="8" y="2" width="3" height="10" rx="1" />
    </svg>
  )
}
function RestartIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M13 8a5 5 0 1 1-1.5-3.5M13 2v3h-3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
