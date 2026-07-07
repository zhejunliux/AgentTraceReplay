import { useCallback, useEffect, useRef, useState } from 'react'

export interface Playback {
  t: number // current virtual clock in ms (relative to run start)
  playing: boolean
  speed: number
  play: () => void
  pause: () => void
  toggle: () => void
  seek: (t: number) => void
  setSpeed: (s: number) => void
  restart: () => void
}

// Playback speed persists across trace loads so a user's chosen pace sticks.
const SPEED_KEY = 'agenttracereplay.speed'
function loadSpeed(): number {
  try {
    const v = Number(localStorage.getItem(SPEED_KEY))
    return v > 0 ? v : 4
  } catch {
    return 4
  }
}

// A virtual clock that advances t from 0..duration while playing.
// speed is a wall-clock multiplier (2 = 2x faster than the real run).
export function usePlayback(duration: number): Playback {
  const [t, setT] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeedState] = useState(loadSpeed)
  const setSpeed = useCallback((s: number) => {
    setSpeedState(s)
    try {
      localStorage.setItem(SPEED_KEY, String(s))
    } catch {
      /* ignore quota / privacy-mode errors */
    }
  }, [])
  const rafRef = useRef<number | null>(null)
  const lastTsRef = useRef<number | null>(null)

  const stopLoop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    lastTsRef.current = null
  }, [])

  useEffect(() => {
    if (!playing) {
      stopLoop()
      return
    }
    const tick = (ts: number) => {
      if (lastTsRef.current === null) lastTsRef.current = ts
      const dtWall = ts - lastTsRef.current
      lastTsRef.current = ts
      setT((prev) => {
        const next = prev + dtWall * speed
        if (next >= duration) {
          setPlaying(false)
          return duration
        }
        return next
      })
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return stopLoop
  }, [playing, speed, duration, stopLoop])

  const play = useCallback(() => {
    setT((prev) => (prev >= duration ? 0 : prev))
    setPlaying(true)
  }, [duration])

  const pause = useCallback(() => setPlaying(false), [])
  const toggle = useCallback(() => setPlaying((p) => !p), [])
  const seek = useCallback(
    (nt: number) => setT(Math.max(0, Math.min(duration, nt))),
    [duration],
  )
  const restart = useCallback(() => {
    setT(0)
    setPlaying(true)
  }, [])

  return { t, playing, speed, play, pause, toggle, seek, setSpeed, restart }
}
