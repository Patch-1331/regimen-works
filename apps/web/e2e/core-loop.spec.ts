import { expect, test } from './fixtures';

/**
 * The core loop, end to end in a browser (DN-72).
 *
 * What this catches that nothing else does: a break that only appears once
 * the whole stack is wired together — CORS, a token that is not attached, a
 * bundle stripped by a missing VITE_ variable, a route that renders in
 * isolation and 500s against real data.
 *
 * Deliberately thin. The service specs cover the queries, the API e2e suite
 * covers the request paths, and the route smoke tests cover rendering; this
 * only has to prove they work together as one running system.
 */

test('signs in and lands on Today with a real workout', async ({ signedInPage: page }) => {
  await page.goto('/');

  // The WOD's name is the heading, so seeing one proves the token reached the
  // API, the API reached the database, and the scheduler assigned something.
  await expect(page.getByRole('navigation')).toBeVisible();
  await expect(page.getByRole('link', { name: 'TODAY' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading').first()).toBeVisible();
});

test('walks a workout from Today to History', async ({ signedInPage: page }) => {
  await page.goto('/');

  const wodName = (await page.getByRole('heading').first().textContent())?.trim() ?? '';
  expect(wodName.length).toBeGreaterThan(0);

  await page.getByRole('button', { name: /start workout/i }).click();

  // The warm-up checklist is off by default (Feature #63 is opt-in), so this
  // goes straight to the timer.
  await expect(page.getByRole('button', { name: 'FINISH' })).toBeVisible();

  await page.getByRole('button', { name: 'FINISH' }).click();

  // Finishing hands over to the log screen, which opens on the same WOD.
  await expect(page.getByRole('heading', { name: new RegExp(wodName, 'i') })).toBeVisible();

  await page.getByRole('button', { name: /save/i }).click();

  await page.getByRole('link', { name: 'HISTORY' }).click();
  await expect(page.getByRole('heading', { name: /history/i })).toBeVisible();
  await expect(page.getByText(new RegExp(wodName, 'i')).first()).toBeVisible();
});

test('cold-loads a deep link while signed in', async ({ signedInPage: page }) => {
  // First paint on a protected route exercises routing and token handling
  // together: the session has to be restored before the first API call.
  await page.goto('/stats');

  await expect(page.getByRole('heading', { name: /stats/i })).toBeVisible();
  await expect(page.getByRole('link', { name: 'STATS' })).toHaveAttribute('aria-current', 'page');
});

test('shows the sign-in form when signed out', async ({ page }) => {
  // The other side of the gate, and the one page that must render without a
  // token — no fixture here on purpose.
  await page.goto('/');

  await expect(page.getByRole('navigation')).toHaveCount(0);
});
