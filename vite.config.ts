import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
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
          if (id.includes('node_modules')) return 'vendor'
          return undefined
        },
      },
    },
  },
})
