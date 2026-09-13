import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // packages/shared compiles to CommonJS (apps/api needs it that way), and a
  // linked workspace package is otherwise served straight to the browser as
  // source — so its runtime exports have to be pre-bundled into ESM first.
  optimizeDeps: {
    include: ['@regimen-works/shared'],
  },
  // Components render into jsdom (DN-95). The pure helpers in src/lib do not
  // need a DOM, but they cost nothing to run in one, so there is a single
  // environment rather than a per-file annotation to keep straight.
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
