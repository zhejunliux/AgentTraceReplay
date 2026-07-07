/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Oscilloscope / flight-recorder palette
        ink: '#0a0e14',        // near-black background
        panel: '#111722',      // raised surface
        grid: '#1c2532',       // gridlines / borders
        muted: '#5b6a7d',      // dim text
        signal: '#4ade80',     // primary signal green (main reasoning track)
        tool: '#38bdf8',       // tool calls (cyan)
        agent: '#c084fc',      // sub-agent (violet)
        plan: '#fbbf24',       // planning (amber)
        danger: '#f87171',     // errors / retries (red)
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'monospace'],
      },
    },
  },
  plugins: [],
}
