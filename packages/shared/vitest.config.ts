import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      // Every source file, not only the ones a test happened to import --
      // otherwise an untested module is invisible and the percentage measures
      // the tests rather than the package.
      all: true,
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
