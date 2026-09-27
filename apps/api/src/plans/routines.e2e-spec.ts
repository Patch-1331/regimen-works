import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  routineSummarySchema,
  setupOptionsSchema,
} from '@regimen-works/shared';
import { z } from 'zod';
import { asUser, createE2eApp } from '../test-support/e2e-app';
import { upsertJustWods } from './just-wods';
import { testPrisma } from '../test-support/database';

/**
 * Authoring a routine through HTTP (DN-145), end to end: write it, find it in
 * your list and the setup picker, start it -- and nobody else can do any of
 * that with it.
 *
 * The admin case is here rather than in the service spec because it is a
 * claim about the route: `POST /routines` is the personal tier whoever calls
 * it, the same way `POST /exercises` is.
 */
jest.mock('@clerk/backend', () => ({
  verifyToken: jest.fn((token: string) => {
    if (token.startsWith('admin_'))
      return Promise.resolve({ sub: token, isAdmin: true });
    if (token.startsWith('user_')) return Promise.resolve({ sub: token });
    return Promise.reject(new Error('invalid token'));
  }),
}));

let app: INestApplication<App>;

let seq = 0;
let ALICE: string;
let BOB: string;
let ADMIN: string;

beforeEach(async () => {
  seq += 1;
  ALICE = `user_alice_${seq}`;
  BOB = `user_bob_${seq}`;
  ADMIN = `admin_root_${seq}`;
  // The picker is never empty in a real database; Just WODs is always there.
  await upsertJustWods(testPrisma());
});

beforeAll(async () => {
  process.env.CLERK_SECRET_KEY = 'sk_test_not_a_real_key';
  app = await createE2eApp();
});

afterAll(async () => {
  await app.close();
});

function http() {
  return request(app.getHttpServer());
}

const routine = {
  name: 'Two-day pull',
  summary: null,
  scheduleMode: 'fixed',
  days: [1, 4].map((dayOfWeek) => ({
    dayOfWeek,
    lines: [
      {
        movementGroup: 'pull',
        exerciseId: null,
        sets: 4,
        reps: 6,
        repsMax: 10,
        toFailure: false,
        restSeconds: 120,
      },
    ],
  })),
};

async function author(user: string) {
  const res = await http()
    .post('/routines')
    .set(...asUser(user))
    .send(routine)
    .expect(201);
  return routineSummarySchema.parse(res.body);
}

async function listed(user: string) {
  const res = await http()
    .get('/routines')
    .set(...asUser(user))
    .expect(200);
  return z.array(routineSummarySchema).parse(res.body);
}

async function picker(user: string) {
  const res = await http()
    .get('/setup')
    .set(...asUser(user))
    .expect(200);
  return setupOptionsSchema.parse(res.body).programs.map((p) => p.id);
}

function start(user: string, planId: string) {
  return http()
    .post('/setup')
    .set(...asUser(user))
    .send({
      planId,
      trainingDays: null,
      weeks: 8,
      startDate: new Date().toISOString().slice(0, 10),
      defaultRestSeconds: null,
    });
}

it('lets an athlete build a routine, find it, and start it', async () => {
  const created = await author(ALICE);

  expect(await listed(ALICE)).toEqual([created]);
  expect(await picker(ALICE)).toContain(created.id);
  await start(ALICE, created.id).expect(201);
});

it('keeps it from a second athlete', async () => {
  const created = await author(ALICE);

  expect(await listed(BOB)).toEqual([]);
  expect(await picker(BOB)).not.toContain(created.id);
  await start(BOB, created.id).expect(404);
});

it('gives an admin a personal routine through this route, not a global one', async () => {
  const created = await author(ADMIN);

  expect(await listed(ADMIN)).toEqual([created]);
  expect(await picker(ALICE)).not.toContain(created.id);
});

it('refuses a half-written routine with the rule it broke', async () => {
  const res = await http()
    .post('/routines')
    .set(...asUser(ALICE))
    .send({ ...routine, days: [{ dayOfWeek: 1, lines: [] }] })
    .expect(400);

  expect(JSON.stringify(res.body)).toContain(
    'a training day needs at least one line',
  );
});
