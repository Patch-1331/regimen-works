import { defineConfig, devices } from '@playwright/test';
import {
  API_ORIGIN,
  API_PORT,
  E2E_DATABASE_URL,
  WEB_ORIGIN,
  WEB_PORT,
} from './e2e/config';

/**
 * The browser suite (DN-72): a real Chromium driving the real web client
 * against the real API, signed in through Clerk.
 *
 * Local only, deliberately. The core loop starts a workout, finishes it and
 * logs a result, so running it against production — the only deployed
 * environment — would write fabricated history into live data. A read-only
 * smoke test against the deployed app is a different, narrower thing.
 *
 * Playwright starts both servers itself on ports of their own, so a dev stack
 * can stay up while this runs. The web app talks to the API directly through
 * VITE_API_BASE_URL rather than through vite's proxy, which is hardcoded to
 * the development port.
 */
export default defineConfig({
  testDir: './e2e',
  // Serial: the suite shares one database and one athlete, and the core loop
  // is a sequence — a workout cannot be started twice at once.
  workers: 1,
  fullyParallel: false,
  // A failure here is a real failure; a retry would only hide a flake worth
  // knowing about.
  retries: 0,
  reporter: process.env.CI ? 'list' : [['list'], ['html', { open: 'never' }]],
  globalSetup: './e2e/global-setup.ts',
  timeout: 60_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL: WEB_ORIGIN,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: [
    {
      command: 'npm run start:dev --workspace apps/api',
      cwd: '../..',
      url: `${API_ORIGIN}/`,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 120_000,
      env: {
        DATABASE_URL: E2E_DATABASE_URL,
        PORT: String(API_PORT),
        // CORS, and the authorizedParties the Clerk guard verifies against.
        WEB_ORIGIN,
        CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY ?? '',
      },
    },
    {
      command: `npm run dev --workspace apps/web -- --port ${WEB_PORT} --strictPort`,
      cwd: '../..',
      url: WEB_ORIGIN,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 120_000,
      env: {
        VITE_API_BASE_URL: API_ORIGIN,
        VITE_CLERK_PUBLISHABLE_KEY: process.env.VITE_CLERK_PUBLISHABLE_KEY ?? '',
      },
    },
  ],
});
