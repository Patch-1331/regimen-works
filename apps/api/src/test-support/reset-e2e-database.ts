import 'dotenv/config';

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

/**
 * Drops, recreates, migrates and seeds the browser suite's database (DN-72).
 *
 * Lives in `apps/api` because this is where the schema, the migrations and
 * the catalogue seed are — `apps/web`'s Playwright setup shells out to it
 * rather than reaching across the workspace for Prisma. It also cannot use
 * `prisma db execute`, which in Prisma 7 reads its URL from the config file
 * and no longer takes `--url`, so DROP/CREATE go through a client of their
 * own pointed at the maintenance database.
 *
 * Recreated per run rather than reused: the suite writes as it goes — a
 * started session, a logged result — and a run inheriting the last one's
 * leftovers is a run whose first assertion depends on what happened before it.
 */

const API_DIR = path.resolve(__dirname, '../..');

async function main(): Promise<void> {
  const url = process.env.E2E_DATABASE_URL;
  if (!url) throw new Error('E2E_DATABASE_URL is not set');

  const parsed = new URL(url);
  const name = parsed.pathname.replace(/^\//, '');
  if (!name) throw new Error(`E2E_DATABASE_URL names no database: ${url}`);

  const admin = new URL(url);
  admin.pathname = '/postgres';
  admin.search = '';

  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: admin.toString() }),
  });
  try {
    // Identifiers cannot be parameterised; the name comes from the operator's
    // own E2E_DATABASE_URL, never from a test.
    await client.$executeRawUnsafe(
      `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`,
    );
    await client.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  } finally {
    await client.$disconnect();
  }

  const env = { ...process.env, DATABASE_URL: url };
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: API_DIR,
    env,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  // The shared exercise and WOD catalogue. Without it the scheduler has
  // nothing to assign and every test opens on a 500.
  execFileSync('npx', ['ts-node', 'prisma/seed.ts'], {
    cwd: API_DIR,
    env,
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  console.log(`Reset ${name}: migrated and seeded.`);
}

void main();
