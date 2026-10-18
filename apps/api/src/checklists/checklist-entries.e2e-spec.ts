import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { athleteChecklistEntrySchema } from '@regimen-works/shared';
import { z } from 'zod';
import { asUser, createE2eApp } from '../test-support/e2e-app';
import { createExercise } from '../test-support/fixtures';

/**
 * The athlete's checklist-entry routes through HTTP (DN-173). The service
 * spec proves the rules; this proves the routes reach them: that a body is
 * validated, that the tier comes from the caller and never the body, and
 * that `PUT /checklist-entries/order` is not read as an entry id.
 */
jest.mock('@clerk/backend', () => ({
  verifyToken: jest.fn((token: string) =>
    token.startsWith('user_')
      ? Promise.resolve({ sub: token })
      : Promise.reject(new Error('invalid token')),
  ),
}));

let app: INestApplication<App>;

// Fresh ids per test; see the note in app.e2e-spec.ts.
let seq = 0;
let ALICE: string;
let BOB: string;

beforeEach(() => {
  seq += 1;
  ALICE = `user_alice_${seq}`;
  BOB = `user_bob_${seq}`;
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

const entries = z.array(athleteChecklistEntrySchema);

describe('/checklist-entries', () => {
  it('adds, lists, reorders and removes an athlete’s own entries', async () => {
    const a = await createExercise({ name: 'A' });
    const b = await createExercise({ name: 'B' });

    const first = await http()
      .post('/checklist-entries')
      .set(...asUser(ALICE))
      .send({ exerciseId: a.id, kind: 'warmup', pattern: null })
      .expect(201);
    const second = await http()
      .post('/checklist-entries')
      .set(...asUser(ALICE))
      .send({ exerciseId: b.id, kind: 'warmup', pattern: 'push' })
      .expect(201);
    const ids = [first, second].map(
      (res) => athleteChecklistEntrySchema.parse(res.body).id,
    );

    const reordered = await http()
      .put('/checklist-entries/order')
      .set(...asUser(ALICE))
      .send({ kind: 'warmup', entryIds: [ids[1], ids[0]] })
      .expect(200);
    expect(entries.parse(reordered.body).map((e) => e.exercise.name)).toEqual([
      'B',
      'A',
    ]);

    await http()
      .delete(`/checklist-entries/${ids[1]}`)
      .set(...asUser(ALICE))
      .expect(204);

    const listed = await http()
      .get('/checklist-entries')
      .set(...asUser(ALICE))
      .expect(200);
    expect(entries.parse(listed.body).map((e) => e.exercise.name)).toEqual([
      'A',
    ]);

    // And none of it is Bob's to see.
    const forBob = await http()
      .get('/checklist-entries')
      .set(...asUser(BOB))
      .expect(200);
    expect(forBob.body).toEqual([]);
  });

  it('refuses a body that names no list', async () => {
    const a = await createExercise({ name: 'A' });
    await http()
      .post('/checklist-entries')
      .set(...asUser(ALICE))
      .send({ exerciseId: a.id, pattern: null })
      .expect(400);
  });

  it('answers a duplicate with 409', async () => {
    const a = await createExercise({ name: 'A' });
    const add = () =>
      http()
        .post('/checklist-entries')
        .set(...asUser(ALICE))
        .send({ exerciseId: a.id, kind: 'cooldown', pattern: null });
    await add().expect(201);
    const res = await add().expect(409);
    expect(res.body.message).toBe('A is already on your cool-down.');
  });

  it("will not remove another athlete's entry", async () => {
    const a = await createExercise({ name: 'A' });
    const added = await http()
      .post('/checklist-entries')
      .set(...asUser(ALICE))
      .send({ exerciseId: a.id, kind: 'warmup', pattern: null })
      .expect(201);

    await http()
      .delete(`/checklist-entries/${athleteChecklistEntrySchema.parse(added.body).id}`)
      .set(...asUser(BOB))
      .expect(404);
  });

  it('needs a signed-in athlete', async () => {
    await http().get('/checklist-entries').expect(401);
  });
});
