import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      // `include` is what makes this every source file rather than only the
      // ones a test happened to import -- without it an untested module is
      // invisible and the percentage measures the tests rather than the package.
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/index.ts'],
      reporter: ['text', 'text-summary', 'json-summary'],
      // RATCHET, NEVER TARGET -- see apps/web/vite.config.ts for the rule.
      // High here because the package is small and almost entirely covered;
      // that makes it the one place a single untested file moves the number
      // sharply, which is the point.
      thresholds: {
        statements: 97,
        branches: 99,
        functions: 99,
        lines: 97,
      },
    },
  },
});
