import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { clerkSetup } from '@clerk/testing/playwright';
import {
  E2E_DATABASE_URL,
  clerkPublishableKey,
  clerkSecretKey,
  testUserEmail,
} from './config';

// apps/web is an ES module package, so there is no __dirname here.
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

/**
 * Stands the suite's database up, then hands Clerk its Testing Token.
 *
 * Playwright brings the web servers up before this runs. That is fine rather
 * than luck worth relying on quietly: the API's Prisma adapter connects per
 * query, not at boot, so it starts happily against a database that does not
 * exist yet and finds it by the time the first request arrives.
 */
export default async function globalSetup(): Promise<void> {
  // Read these first, so a missing one fails with a sentence instead of the
  // suite arriving at a blank page a minute later.
  clerkSecretKey();
  clerkPublishableKey();
  testUserEmail();

  // apps/api owns the schema, the migrations and the catalogue seed.
  execFileSync('npm', ['run', 'e2e:db:reset', '--workspace', 'apps/api'], {
    cwd: REPO_ROOT,
    env: { ...process.env, E2E_DATABASE_URL },
    stdio: ['ignore', 'inherit', 'inherit'],
  });

  // Fetches the Testing Token. Without it Clerk's bot detection rejects an
  // automated sign-in with "Bot traffic detected".
  await clerkSetup();
}
