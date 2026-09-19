import { test as base, expect, type Page } from '@playwright/test';
import { clerk } from '@clerk/testing/playwright';
import { API_ORIGIN, testUserEmail } from './config';

/**
 * Puts the test athlete on a seven-day week before any test looks at Today.
 *
 * Without it the suite fails every Saturday and Sunday (DN-122), and not
 * because anything is broken: a freshly provisioned athlete trains Monday to
 * Friday, so on a weekend Today is correctly a rest day, there is no WOD
 * heading to read, and `walks a workout from Today to History` times out
 * clicking a button that was never rendered.
 *
 * Done from inside the page, through the same API the app calls and with the
 * same session token, because that is the only place the signed-in athlete's
 * id exists: the database is reset before anyone has signed in, and the row
 * is created by their first request.
 */
async function trainsEveryDay(page: Page, apiOrigin: string): Promise<void> {
  const failure = await page.evaluate(async (origin) => {
    const clerkGlobal = (
      window as unknown as {
        Clerk?: { session?: { getToken(): Promise<string | null> } };
      }
    ).Clerk;
    const token = await clerkGlobal?.session?.getToken();
    if (!token) return 'no Clerk session token in the page';

    const res = await fetch(`${origin}/settings`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ trainingDays: [0, 1, 2, 3, 4, 5, 6] }),
    });
    return res.ok ? null : `PATCH /settings answered ${res.status}`;
  }, apiOrigin);

  if (failure) {
    throw new Error(
      `Could not put the test athlete on a seven-day week: ${failure}. ` +
        'Every Today assertion below depends on it (DN-122).',
    );
  }
}

/**
 * A page already signed in as the Clerk test user.
 *
 * Signs in through Clerk for real — `clerk.signIn` mints a ticket through
 * Clerk's backend API and injects the Testing Token that gets past bot
 * detection. There is no auth bypass in the app to lean on, deliberately
 * (DN-58), so this is the same path a person takes.
 *
 * `e2e/**` is in `.oxlintrc.json`'s ignorePatterns because of the `use`
 * below: Playwright names a fixture's callback `use`, and the React hooks
 * rule reads that as a hook called outside a component. There is no React in
 * this directory at all.
 */
export const test = base.extend<{ signedInPage: Page }>({
  signedInPage: async ({ page }, use) => {
    // Clerk has to be loaded before the helper can drive it, and every route
    // sits behind the gate, so "/" signed out is the page that loads it.
    await page.goto('/');
    await clerk.signIn({ page, emailAddress: testUserEmail() });
    await trainsEveryDay(page, API_ORIGIN);
    await use(page);
  },
});

export { expect };
