import { resetSchema, TEST_DATABASE_URL } from './database';

/**
 * Runs once before the DB suites, in Jest's parent process: recreate the test
 * database and migrate it.
 *
 * `DATABASE_URL` is set here as well as in the per-worker setup. `PrismaService`
 * throws at construction without it, and `prisma migrate deploy` reads it too,
 * so a test that builds a real Nest module gets a client pointed at the
 * throwaway database rather than at whatever the developer's `.env` says.
 */
export default async function globalSetup(): Promise<void> {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  await resetSchema();
}
