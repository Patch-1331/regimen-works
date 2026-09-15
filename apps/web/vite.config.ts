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
    // e2e/ is Playwright's (DN-72). Its specs import @playwright/test, which
    // throws under Vitest, and vitest's default glob would otherwise claim
    // them.
    exclude: ['node_modules/**', 'dist/**', 'e2e/**'],
    coverage: {
      provider: 'v8',
      // `include` is what makes this every source file rather than only the
      // ones a test happened to import -- without it an untested module is
      // invisible and the percentage measures the tests rather than the app.
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.spec.{ts,tsx}',
        // Test scaffolding, and the entry point, which only mounts the tree.
        'src/test/**',
        'src/main.tsx',
      ],
      reporter: ['text', 'text-summary', 'json-summary'],
      // RATCHET, NEVER TARGET. These sit just under the coverage measured
      // when they were set (DN-54): they exist so it cannot silently regress,
      // not as a goal. Raise them in the PR that raises coverage. Lowering one
      // is a decision to state in the PR description, never a quiet edit to
      // make CI pass.
      thresholds: {
        statements: 60,
        branches: 49,
        functions: 51,
        lines: 62,
      },
    },
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
