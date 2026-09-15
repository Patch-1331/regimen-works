import { test as base, expect, type Page } from '@playwright/test';
import { clerk } from '@clerk/testing/playwright';
import { testUserEmail } from './config';

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
    await use(page);
  },
});

export { expect };
