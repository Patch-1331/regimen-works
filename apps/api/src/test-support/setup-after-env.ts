import {
  disconnectTestPrisma,
  truncateAll,
  TEST_DATABASE_URL,
} from './database';

// Set per worker as well as in global-setup: a worker is its own process, and
// PrismaService reads DATABASE_URL at construction.
process.env.DATABASE_URL = TEST_DATABASE_URL;

// Migrating and connecting costs more than any single assertion, so the
// default 5s is too tight for the first test in a run.
jest.setTimeout(30_000);

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await disconnectTestPrisma();
});
