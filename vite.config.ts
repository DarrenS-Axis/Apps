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
          if (id.includes('jspdf')) return 'pdf'
          if (id.includes('node_modules')) return 'vendor'
          return undefined
        },
      },
    },
  },
})
