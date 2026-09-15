/**
 * Everything the browser suite needs from the environment, in one place so a
 * missing value fails with a sentence rather than a blank page (DN-72).
 */

function required(name: string, hint: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. ${hint}`);
  }
  return value;
}

/**
 * Its own database, never the development one. A run starts a workout,
 * finishes it and logs a result, so pointing it at the database you develop
 * against would leave fabricated history in it.
 */
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  'postgresql://regimen_works:regimen_works@localhost:5432/regimen_works_e2e?schema=public';

/** Ports of their own, so a dev stack can stay up while the suite runs. */
export const API_PORT = Number(process.env.E2E_API_PORT ?? 3101);
export const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5273);
export const API_ORIGIN = `http://localhost:${API_PORT}`;
export const WEB_ORIGIN = `http://localhost:${WEB_PORT}`;

export function clerkSecretKey(): string {
  return required(
    'CLERK_SECRET_KEY',
    'The API verifies every request against it, and @clerk/testing needs it to mint a sign-in ticket. See apps/api/.env.example.',
  );
}

export function clerkPublishableKey(): string {
  return required(
    'VITE_CLERK_PUBLISHABLE_KEY',
    'Without it the web app throws at startup rather than rendering a sign-in form. See apps/web/.env.example.',
  );
}

export function testUserEmail(): string {
  return required(
    'E2E_USER_EMAIL',
    'The Clerk test user to sign in as — a "+clerk_test" address, which Clerk accepts without sending mail. See the README.',
  );
}
