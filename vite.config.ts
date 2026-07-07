import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Injected into the built HTML only. It enforces the product's core promise —
// "the trace never leaves the page" — by blocking network egress: connect-src
// 'self' means fetch/XHR/WebSocket to other origins are refused by the browser,
// while still allowing the bundled sample to load. Applied at build time only so
// the dev server's HMR websocket + inline scripts keep working.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'", // Tailwind ships styles inline
  "img-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'self'",
  "form-action 'none'",
  "object-src 'none'",
].join('; ')

function cspPlugin() {
  return {
    name: 'inject-csp',
    apply: 'build' as const,
    transformIndexHtml(html: string) {
      const tag = `<meta http-equiv="Content-Security-Policy" content="${CSP}" />`
      return html.replace('</title>', `</title>\n    ${tag}`)
    },
  }
}

// GitHub Pages friendly: set base to './' so the static build works from any subpath.
export default defineConfig({
  base: './',
  plugins: [react(), cspPlugin()],
})
