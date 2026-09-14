import { execFileSync } from 'node:child_process';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

/**
 * The throwaway Postgres the `*.db-spec.ts` suites run against (DN-99).
 *
 * A real database rather than a mocked Prisma client, deliberately: a mocked
 * client mostly proves that a mock was called with certain arguments, and it
 * keeps passing while the query is subtly wrong — bad `where`, missing
 * `include`, wrong ordering — which is the class of bug these tests exist for.
 */

/**
 * Defaults to the `docker-compose.yml` credentials with a different database
 * name, so a developer who has the dev stack up needs no extra setup and the
 * test database can never be their development one by accident.
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://regimen_works:regimen_works@localhost:5432/regimen_works_test?schema=public';

/** The `postgres` maintenance database on the same server — you cannot drop a database you are connected to. */
function adminUrl(): string {
  const url = new URL(TEST_DATABASE_URL);
  url.pathname = '/postgres';
  url.search = '';
  return url.toString();
}

function databaseName(): string {
  return new URL(TEST_DATABASE_URL).pathname.replace(/^\//, '');
}

/**
 * Drops and recreates the test database, then applies migrations to it.
 *
 * Recreated rather than reused so the schema always matches the migrations on
 * this branch: a database left behind by a branch with different migrations is
 * the kind of stale state that produces failures nobody can reproduce.
 */
export async function resetSchema(): Promise<void> {
  const name = databaseName();
  const admin = new PrismaClient({
    adapter: new PrismaPg({ connectionString: adminUrl() }),
  });
  try {
    // Identifiers cannot be parameterised, so the name is quoted instead. It
    // comes from this file's own default or TEST_DATABASE_URL, never a test.
    await admin.$executeRawUnsafe(
      `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`,
    );
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.$disconnect();
  }

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: `${__dirname}/../..`,
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'inherit',
  });
}

let client: PrismaClient | null = null;

/** The one client the DB suites share. Reconnecting per suite costs more than the tests do. */
export function testPrisma(): PrismaClient {
  client ??= new PrismaClient({
    adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }),
  });
  return client;
}

export async function disconnectTestPrisma(): Promise<void> {
  await client?.$disconnect();
  client = null;
}

let tableNames: string[] | null = null;

/**
 * Empties every table between tests, so no test can see what its predecessor
 * wrote and the order they run in cannot change the result.
 *
 * `TRUNCATE` over per-model `deleteMany` because one statement over all tables
 * needs no knowledge of the foreign keys between them — `CASCADE` settles the
 * order. `_prisma_migrations` is left alone; emptying it would make the next
 * `migrate deploy` replay everything.
 */
export async function truncateAll(): Promise<void> {
  const prisma = testPrisma();
  tableNames ??= (
    await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    `
  ).map((row) => row.tablename);

  if (tableNames.length === 0) return;
  const quoted = tableNames.map((name) => `"public"."${name}"`).join(', ');
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`,
  );
}
