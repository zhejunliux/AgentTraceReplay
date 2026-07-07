import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReplayModel, ReplaySpan, Track } from '../model/types'
import { DANGER, TRACK_ORDER, TRACK_STYLE } from '../styles/tracks'

interface Props {
  model: ReplayModel
  t: number // current playback clock (ms)
  zoom: number // horizontal stretch factor (1 = fit width)
  selectedId?: string
  onSelect: (span: ReplaySpan) => void
  onSeek: (ms: number) => void // click the timeline background to scrub there
}

const LANE_H = 64
const LEFT_GUTTER = 96
const RIGHT_PAD = 32
const TOP_PAD = 28
const NODE_R = 7
const MIN_W = 900

// Which tracks actually appear in this run, in canonical order.
function usedTracks(spans: ReplaySpan[]): Track[] {
  const present = new Set(spans.map((s) => s.track))
  return TRACK_ORDER.filter((tr) => present.has(tr))
}

export default function Timeline({ model, t, zoom, selectedId, onSelect, onSeek }: Props) {
  const { spans, meta } = model
  const tracks = useMemo(() => usedTracks(spans), [spans])
  const laneIndex = useMemo(() => {
    const m = new Map<Track, number>()
    tracks.forEach((tr, i) => m.set(tr, i))
    return m
  }, [tracks])

  // Measure the scroll container so zoom=1 fills it exactly (matches the
  // playback bar width, no horizontal scroll); zoom>1 stretches beyond it.
  const scrollRef = useRef<HTMLDivElement>(null)
  const [containerW, setContainerW] = useState(0)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      setContainerW(entries[0].contentRect.width)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const baseW = Math.max(MIN_W, containerW || MIN_W)
  const width = baseW * zoom
  const plotW = width - LEFT_GUTTER - RIGHT_PAD
  const height = TOP_PAD * 2 + tracks.length * LANE_H

  const xOf = (ms: number) => LEFT_GUTTER + (ms / meta.duration) * plotW
  const yOf = (tr: Track) => TOP_PAD + (laneIndex.get(tr) ?? 0) * LANE_H + LANE_H / 2

  // "playhead" x position
  const playX = xOf(Math.min(t, meta.duration))

  // When a span is selected while zoomed, scroll it into the visible area so
  // clicking a dense node doesn't leave it off-screen.
  const selectedSpan = selectedId ? spans.find((s) => s.id === selectedId) : undefined
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !selectedSpan) return
    const x = xOf(selectedSpan.tStart)
    const view = el.clientWidth
    if (x < el.scrollLeft + 60 || x > el.scrollLeft + view - 60) {
      el.scrollTo({ left: Math.max(0, x - view / 2), behavior: 'smooth' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, zoom])

  // Keep the playhead in view during playback: when it crosses out of the
  // visible band (zoomed in), scroll to re-center it. No-op at zoom=1 since the
  // whole timeline already fits. Uses instant scroll to track smoothly.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (el.scrollWidth <= el.clientWidth + 1) return // fully visible, nothing to follow
    const view = el.clientWidth
    const margin = view * 0.15
    if (playX < el.scrollLeft + margin || playX > el.scrollLeft + view - margin) {
      el.scrollLeft = Math.max(0, Math.min(playX - view / 2, el.scrollWidth - view))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playX])

  // Decide which spans may render a text label. Walking each track left→right,
  // skip a label when it would collide with the previous shown one, so dense
  // regions stay readable. The node dot always renders; only the text is gated.
  const labelIds = useMemo(() => {
    const CHAR_W = 6.2 // approx px per (latin) char at 11px mono
    const GAP = 8
    const show = new Set<string>()
    const lastEndByTrack = new Map<Track, number>()
    const ordered = [...spans].sort((a, b) => a.tStart - b.tStart)
    for (const s of ordered) {
      const labelStart = xOf(s.tStart) + NODE_R + 6
      const label = truncate(labelOf(s), MAX_LABEL)
      const labelEnd = labelStart + displayWidth(label) * CHAR_W
      const prevEnd = lastEndByTrack.get(s.track) ?? -Infinity
      if (labelStart > prevEnd + GAP) {
        show.add(s.id)
        lastEndByTrack.set(s.track, labelEnd)
      }
    }
    return show
    // xOf is derived from width/plotW/meta.duration, all captured below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spans, meta.duration, width])

  return (
    <div ref={scrollRef} className="w-full overflow-x-auto scanlines rounded-lg border border-grid bg-panel/40">
      <svg width={width} height={height} className="block">
        {/* click anywhere on the plot to scrub the playhead there. Sits behind
            the nodes, so clicking a node still selects it rather than seeking. */}
        <rect
          x={LEFT_GUTTER}
          y={0}
          width={Math.max(0, width - LEFT_GUTTER - RIGHT_PAD)}
          height={height}
          fill="transparent"
          className="cursor-text"
          onClick={(e) => {
            const rect = e.currentTarget.ownerSVGElement?.getBoundingClientRect()
            if (!rect) return
            const x = e.clientX - rect.left
            const ms = ((x - LEFT_GUTTER) / plotW) * meta.duration
            onSeek(Math.max(0, Math.min(meta.duration, ms)))
          }}
        />
        {/* lane baselines + labels */}
        {tracks.map((tr) => {
          const y = yOf(tr)
          const st = TRACK_STYLE[tr]
          return (
            <g key={tr}>
              <line
                x1={LEFT_GUTTER}
                y1={y}
                x2={width - RIGHT_PAD}
                y2={y}
                stroke={st.color}
                strokeOpacity={0.12}
                strokeWidth={2}
              />
              <text
                x={12}
                y={y + 4}
                fill={st.color}
                fillOpacity={0.75}
                fontSize={11}
                fontWeight={600}
                letterSpacing={1}
              >
                {st.label}
              </text>
            </g>
          )
        })}

        {/* parent -> child feeder lines (subway branch) */}
        {spans.map((s) => {
          if (!s.parentId) return null
          const parent = spans.find((p) => p.id === s.parentId)
          if (!parent || parent.track === s.track) return null
          const x = xOf(s.tStart)
          const y1 = yOf(parent.track)
          const y2 = yOf(s.track)
          const started = t >= s.tStart
          const st = TRACK_STYLE[s.track]
          return (
            <path
              key={`feed-${s.id}`}
              d={`M ${x} ${y1} C ${x} ${(y1 + y2) / 2}, ${x} ${(y1 + y2) / 2}, ${x} ${y2}`}
              stroke={st.color}
              strokeWidth={2}
              fill="none"
              strokeOpacity={started ? 0.5 : 0.12}
            />
          )
        })}

        {/* span bars + nodes */}
        {spans.map((s) => {
          const st = TRACK_STYLE[s.track]
          const y = yOf(s.track)
          const x1 = xOf(s.tStart)
          const x2 = Math.max(x1 + NODE_R * 2, xOf(s.tEnd))
          const started = t >= s.tStart
          const done = t >= s.tEnd
          const active = started && !done
          const isError = s.status === 'error'
          const color = isError ? DANGER : st.color
          const opacity = started ? 1 : 0.22
          const selected = s.id === selectedId

          return (
            <g
              key={s.id}
              className="cursor-pointer"
              opacity={opacity}
              onClick={() => onSelect(s)}
            >
              {/* duration bar */}
              <rect
                x={x1}
                y={y - 4}
                width={x2 - x1}
                height={8}
                rx={4}
                fill={color}
                fillOpacity={done ? 0.35 : active ? 0.55 : 0.25}
              />
              {/* active pulse */}
              {active && (
                <rect x={x1} y={y - 4} width={x2 - x1} height={8} rx={4} fill={color} fillOpacity={0.25}>
                  <animate attributeName="fill-opacity" values="0.15;0.5;0.15" dur="1.1s" repeatCount="indefinite" />
                </rect>
              )}
              {/* start node */}
              <circle
                cx={x1}
                cy={y}
                r={selected ? NODE_R + 2 : NODE_R}
                fill={started ? color : '#0a0e14'}
                stroke={color}
                strokeWidth={2}
              />
              {isError && started && (
                <text x={x1} y={y + 3.5} fontSize={10} fontWeight={700} textAnchor="middle" fill="#0a0e14">
                  !
                </text>
              )}
              {selected && (
                <circle cx={x1} cy={y} r={NODE_R + 6} fill="none" stroke={color} strokeOpacity={0.5} strokeWidth={1.5} />
              )}
              {/* label — shown when it won't collide, or when this span is selected */}
              {(labelIds.has(s.id) || selected) && (
                <text
                  x={x1 + NODE_R + 6}
                  y={y - 10}
                  fontSize={11}
                  fill={selected ? '#ffffff' : '#cdd6e0'}
                  fillOpacity={started ? 0.9 : 0.35}
                >
                  {truncate(labelOf(s), MAX_LABEL)}
                </text>
              )}
            </g>
          )
        })}

        {/* playhead */}
        <line x1={playX} y1={TOP_PAD - 10} x2={playX} y2={height - TOP_PAD + 10} stroke="#e2e8f0" strokeOpacity={0.55} strokeWidth={1} />
        <polygon
          points={`${playX - 5},${TOP_PAD - 14} ${playX + 5},${TOP_PAD - 14} ${playX},${TOP_PAD - 6}`}
          fill="#e2e8f0"
          fillOpacity={0.7}
        />
      </svg>
    </div>
  )
}

// Labels are truncated by *display width*, not char count, so CJK text (which
// renders ~2× as wide as latin at the same point size) doesn't overflow its lane
// or defeat the collision spacing above.
const MAX_LABEL = 34 // in display-width units (a CJK glyph = 2)

// A CJK / full-width codepoint counts as 2, everything else as 1.
function isWide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
    (cp >= 0x2e80 && cp <= 0xa4cf) || // CJK radicals … Yi
    (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul syllables
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK compatibility ideographs
    (cp >= 0xff00 && cp <= 0xff60) || // full-width forms
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x20000 && cp <= 0x3fffd) // CJK extension B+
  )
}

function displayWidth(s: string): number {
  let w = 0
  for (const ch of s) w += isWide(ch.codePointAt(0)!) ? 2 : 1
  return w
}

function truncate(s: string, maxWidth: number): string {
  let w = 0
  let out = ''
  for (const ch of s) {
    const cw = isWide(ch.codePointAt(0)!) ? 2 : 1
    if (w + cw > maxWidth - 1) return out + '…'
    w += cw
    out += ch
  }
  return out
}

// Timeline labels drop the model suffix ("chat · claude-opus-4" → "chat");
// the model is already shown in the stat strip and the detail panel.
function labelOf(s: ReplaySpan): string {
  const i = s.name.indexOf(' · ')
  return i === -1 ? s.name : s.name.slice(0, i)
}
