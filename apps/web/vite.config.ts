import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * msw's service worker, served by the dev server in mock mode only (DN-181).
 * Not copied into `public/`, where every production build would ship it.
 */
function mockServiceWorker(): Plugin {
  const script = createRequire(import.meta.url).resolve(
    'msw/mockServiceWorker.js',
  )
  return {
    name: 'mock-service-worker',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/mockServiceWorker.js', (_req, res) => {
        res.setHeader('Content-Type', 'text/javascript')
        res.end(readFileSync(script))
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  // `vite --mode mock` (`npm run dev:mock`, DN-181): the app with Clerk and
  // the API stood in for, for a browser with neither a key nor a sign-in.
  // Nothing below reaches any other mode.
  ...(mode === 'mock' && {
    resolve: {
      alias: {
        '@clerk/clerk-react': fileURLToPath(
          new URL('./src/mock/clerk.tsx', import.meta.url),
        ),
      },
    },
  }),
  plugins: [
    react(),
    tailwindcss(),
    ...(mode === 'mock' ? [mockServiceWorker()] : []),
  ],
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
        // Mock mode's stand-ins (DN-181), which only a browser runs.
        'src/mock/**',
        'src/main.tsx',
      ],
      reporter: ['text', 'text-summary', 'json-summary'],
      // RATCHET, NEVER TARGET. These sit just under the coverage measured
      // when they were set (DN-54): they exist so it cannot silently regress,
      // not as a goal. Raise them in the PR that raises coverage. Lowering one
      // is a decision to state in the PR description, never a quiet edit to
      // make CI pass.
      thresholds: {
        // Raised by DN-30, which measured 79.69 / 75.98 / 72.27 / 80.83.
        statements: 79,
        branches: 75,
        // The margins here are deliberate: DN-96 set a floor from a reading
        // the suite did not reproduce and turned main red the moment it
        // merged. Floors go just *under* measured (DN-54), with enough room
        // that a rounding difference is not a failure.
        functions: 71,
        lines: 80,
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
}))
