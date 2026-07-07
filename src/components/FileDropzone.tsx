import { useCallback, useRef, useState } from 'react'

interface Props {
  onLoad: (json: unknown, name: string) => void
  onError: (msg: string) => void
}

// Reject files large enough to freeze the tab on JSON.parse. Generous enough
// for real traces (a 50MB OTLP export is already huge) while stopping a
// multi-hundred-MB file from OOMing the page.
const MAX_BYTES = 50 * 1024 * 1024

// A thin drop target + file picker for OTLP JSON traces.
export default function FileDropzone({ onLoad, onError }: Props) {
  const [over, setOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback(
    (file: File) => {
      if (file.size > MAX_BYTES) {
        onError(
          `${file.name} is ${(file.size / 1024 / 1024).toFixed(0)}MB — too large to parse in-browser (limit ${MAX_BYTES / 1024 / 1024}MB). Trim the trace or split it into smaller runs.`,
        )
        return
      }
      const reader = new FileReader()
      reader.onload = () => {
        try {
          const json = JSON.parse(String(reader.result))
          onLoad(json, file.name)
        } catch {
          onError(`Could not parse ${file.name} as JSON. See the supported formats below.`)
        }
      }
      reader.onerror = () => onError(`Failed to read ${file.name}.`)
      reader.readAsText(file)
    },
    [onLoad, onError],
  )

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        const f = e.dataTransfer.files[0]
        if (f) handleFile(f)
      }}
      onClick={() => inputRef.current?.click()}
      className={`cursor-pointer rounded-lg border border-dashed px-4 py-2 text-center text-xs transition ${
        over ? 'border-signal bg-signal/10 text-signal' : 'border-grid text-muted hover:border-muted'
      }`}
    >
      Drop an OTLP <code className="text-signal">gen_ai</code> trace (.json) — or click to browse
      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) handleFile(f)
          e.target.value = ''
        }}
      />
    </div>
  )
}
