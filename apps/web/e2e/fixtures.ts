import { test as base, expect, type Page } from '@playwright/test';
import { clerk } from '@clerk/testing/playwright';
import { API_ORIGIN, testUserEmail } from './config';

/**
 * Finishes first-run setup for the test athlete, on a seven-day week.
 *
 * Two things at once, because setup writes both (DN-15). The athlete's row is
 * created by their first request with `onboardedAt` null, so without this
 * every test below lands on the wizard instead of the page it is about -- the
 * route guard is doing exactly its job. And the days it commits are all seven,
 * without which the suite fails every Saturday and Sunday (DN-122) and not
 * because anything is broken: a freshly provisioned athlete trains Monday to
 * Friday, so on a weekend Today is correctly a rest day, there is no WOD
 * heading to read, and `walks a workout from Today to History` times out
 * clicking a button that was never rendered.
 *
 * Committed through the API the wizard itself posts to, rather than by
 * clicking through four screens: the wizard's own screens are covered by the
 * route tests and by the API's e2e walk, and this suite is deliberately thin.
 * Driving it from inside the page is the only place the signed-in athlete's
 * id exists -- the database is reset before anyone has signed in.
 */
async function finishesSetup(page: Page, apiOrigin: string): Promise<void> {
  const failure = await page.evaluate(async (origin) => {
    const clerkGlobal = (
      window as unknown as {
        Clerk?: { session?: { getToken(): Promise<string | null> } };
      }
    ).Clerk;
    const token = await clerkGlobal?.session?.getToken();
    if (!token) return 'no Clerk session token in the page';

    const authorization = `Bearer ${token}`;

    // Once only. The fixture runs per test but the database is reset once a
    // suite, so a second commit would move the enrollment's start date to
    // tomorrow -- the earliest the API offers after an earlier test has
    // started a session on today.
    const meRes = await fetch(`${origin}/me`, { headers: { authorization } });
    if (!meRes.ok) return `GET /me answered ${meRes.status}`;
    const me = (await meRes.json()) as { onboardedAt: string | null };
    if (me.onboardedAt !== null) return null;

    const optionsRes = await fetch(`${origin}/setup`, {
      headers: { authorization },
    });
    if (!optionsRes.ok) return `GET /setup answered ${optionsRes.status}`;

    // Just WODs is first, and the earliest date the API offers is a date it
    // has already agreed to -- rather than today by the browser's clock,
    // which need not be the API's.
    const options = (await optionsRes.json()) as {
      programs: { id: string }[];
      earliestStartDate: string;
    };

    const res = await fetch(`${origin}/setup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization },
      body: JSON.stringify({
        planId: options.programs[0].id,
        trainingDays: [0, 1, 2, 3, 4, 5, 6],
        weeks: null,
        startDate: options.earliestStartDate,
      }),
    });
    return res.ok ? null : `POST /setup answered ${res.status}`;
  }, apiOrigin);

  if (failure) {
    throw new Error(
      `Could not finish setup for the test athlete: ${failure}. ` +
        'Every assertion below depends on it (DN-15, DN-122).',
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
    await finishesSetup(page, API_ORIGIN);
    await use(page);
  },
});

export { expect };
