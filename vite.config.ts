import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { copyFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

// Axis MEP Design (public/mep) is a no-build app that reads PDF underlays with
// pdf.js. Copy the same pdf.js the main app uses next to it, so the published
// site needs no CDN.
const PDFJS_FILES = ['pdf.min.mjs', 'pdf.worker.min.mjs']
export function copyPdfjs(outDir: string) {
  mkdirSync(outDir, { recursive: true })
  for (const f of PDFJS_FILES) copyFileSync(resolve('node_modules/pdfjs-dist/legacy/build', f), resolve(outDir, f))
}
const mepPdfjs = {
  name: 'mep-pdfjs',
  writeBundle(options: { dir?: string }) {
    copyPdfjs(resolve(options.dir ?? 'dist', 'mep/vendor'))
  },
}

export default defineConfig({
  plugins: [react(), mepPdfjs],
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // Keep the PDF writer out of the initial payload — it is only pulled in
        // when someone exports, which on site is rare compared with capture.
        manualChunks(id: string) {
          // pdf.js is only pulled in when someone imports a plan, so keep it out
          // of `vendor` — that chunk loads on every visit.
          if (id.includes('pdfjs-dist')) return 'pdfjs'
          // Likewise the PDF writer: exporting is rare compared with capture.
          if (id.includes('jspdf')) return 'pdf'
          // The QR decoder only loads when someone scans.
          if (id.includes('jsqr')) return 'jsqr'
          // Likewise the map, when someone opens it.
          if (id.includes('node_modules/leaflet')) return 'leaflet'
          if (id.includes('node_modules')) return 'vendor'
          return undefined
        },
      },
    },
  },
})
