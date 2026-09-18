import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { exerciseSchema, wodSchema } from '@regimen-works/shared';
import { z } from 'zod';
import { asUser, createE2eApp } from '../test-support/e2e-app';

/**
 * The WOD write routes through HTTP (DN-26).
 *
 * `wods.service.crud.db-spec.ts` proves the rules. What only this layer can
 * prove is the claim the two controllers make: that *which tier a write lands
 * in* is a property of the route, never of the body. `POST /wods` writes the
 * caller's own; `POST /admin/wods` writes the shared pool, and is the same
 * service call with a different writer.
 *
 * It also proves the thing no service spec can reach — that the movement list
 * has no route of its own, so a `WodMovement` can only be written through the
 * `Wod` whose ownership was checked.
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

// Fresh ids per test: `UserProvisioningService` caches across the process
// while the DN-99 reset empties the tables between tests. See the note in
// app.e2e-spec.ts.
let seq = 0;
let ALICE: string;
let BOB: string;
let ADMIN: string;

beforeEach(() => {
  seq += 1;
  ALICE = `user_alice_${seq}`;
  BOB = `user_bob_${seq}`;
  ADMIN = `admin_root_${seq}`;
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

/** Reads a body through the schema `apps/web` is written against. */
function parsed<T>(schema: z.ZodType<T>, res: request.Response): T {
  return schema.parse(res.body);
}

/**
 * The id of a WOD a request just returned.
 *
 * Through the schema rather than off `res.body`, which supertest types `any`:
 * a response that stopped carrying an id would otherwise read as `undefined`
 * and fail several requests later, pointing at the wrong thing.
 */
function wodId(res: request.Response): string {
  return parsed(wodSchema, res).id;
}

function exerciseBody(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Ring row',
    pattern: 'pull',
    equipment: [],
    scalable: false,
    unit: 'reps',
    instructions: null,
    line: null,
    rung: null,
    altExerciseId: null,
    phase: null,
    ...overrides,
  };
}

function wodBody(exerciseId: string, overrides: Record<string, unknown> = {}) {
  return {
    name: 'Fran',
    type: 'for_time',
    timeCapMinutes: 12,
    rounds: null,
    workSeconds: null,
    restSeconds: null,
    intervalCount: null,
    isNamed: true,
    dominantPattern: 'push',
    description: null,
    movements: [{ exerciseId, reps: 21 }],
    ...overrides,
  };
}

/** A global exercise, the one thing every WOD in this file needs first. */
async function globalExercise(name = 'Air squat'): Promise<string> {
  const res = await http()
    .post('/admin/exercises')
    .set(...asUser(ADMIN))
    .send(exerciseBody({ name }))
    .expect(201);
  return parsed(exerciseSchema, res).id;
}

describe('an athlete writing their own WODs', () => {
  it('creates one only they can see', async () => {
    const created = parsed(
      wodSchema,
      await http()
        .post('/wods')
        .set(...asUser(ALICE))
        .send(wodBody(await globalExercise()))
        .expect(201),
    );
    expect(created.movements).toHaveLength(1);

    const mine = await http()
      .get('/wods')
      .set(...asUser(ALICE))
      .expect(200);
    expect(mine.body).toHaveLength(1);

    const bobs = await http()
      .get('/wods')
      .set(...asUser(BOB))
      .expect(200);
    expect(bobs.body).toHaveLength(0);
  });

  it('edits it, and the movement list only when the patch carries one', async () => {
    const exerciseId = await globalExercise();
    const created = await http()
      .post('/wods')
      .set(...asUser(ALICE))
      .send(wodBody(exerciseId))
      .expect(201);

    const updated = parsed(
      wodSchema,
      await http()
        .patch(`/wods/${wodId(created)}`)
        .set(...asUser(ALICE))
        .send({ timeCapMinutes: 20 })
        .expect(200),
    );
    expect(updated.timeCapMinutes).toBe(20);
    expect(updated.name).toBe('Fran');
    expect(updated.movements).toHaveLength(1);
  });

  it('retires it and brings it back', async () => {
    const created = await http()
      .post('/wods')
      .set(...asUser(ALICE))
      .send(wodBody(await globalExercise()))
      .expect(201);
    const id = wodId(created);

    await http()
      .post(`/wods/${id}/archive`)
      .set(...asUser(ALICE))
      .expect(201);
    expect(
      (
        await http()
          .get('/wods')
          .set(...asUser(ALICE))
      ).body,
    ).toHaveLength(0);

    await http()
      .post(`/wods/${id}/unarchive`)
      .set(...asUser(ALICE))
      .expect(201);
    expect(
      (
        await http()
          .get('/wods')
          .set(...asUser(ALICE))
      ).body,
    ).toHaveLength(1);
  });

  it('is refused a WOD with no movements', async () => {
    await http()
      .post('/wods')
      .set(...asUser(ALICE))
      .send(wodBody(await globalExercise(), { movements: [] }))
      .expect(400);
  });

  it('is refused a movement stating both a count and a ladder', async () => {
    const exerciseId = await globalExercise();
    await http()
      .post('/wods')
      .set(...asUser(ALICE))
      .send(
        wodBody(exerciseId, {
          movements: [{ exerciseId, reps: 45, repScheme: [21, 15, 9] }],
        }),
      )
      .expect(400);
  });

  // The tier comes from the route. A body naming `ownerId: null` is not a way
  // into the shared pool — the field is stripped before the service sees it.
  it('cannot reach the shared pool by naming it in the body', async () => {
    const exerciseId = await globalExercise();
    await http()
      .post('/wods')
      .set(...asUser(ALICE))
      .send(wodBody(exerciseId, { ownerId: null }))
      .expect(201);

    // Bob sees the global pool. If Alice's write had landed there, he would
    // see her WOD in it.
    const bobs = await http()
      .get('/wods')
      .set(...asUser(BOB))
      .expect(200);
    expect(bobs.body).toHaveLength(0);
  });
});

describe('an admin curating the shared pool', () => {
  it('creates one every athlete can see', async () => {
    await http()
      .post('/admin/wods')
      .set(...asUser(ADMIN))
      .send(wodBody(await globalExercise()))
      .expect(201);

    for (const who of [ALICE, BOB]) {
      const seen = await http()
        .get('/wods')
        .set(...asUser(who))
        .expect(200);
      expect(seen.body).toHaveLength(1);
    }
  });

  it('retires it, taking it out of everyone’s pool at once', async () => {
    const created = await http()
      .post('/admin/wods')
      .set(...asUser(ADMIN))
      .send(wodBody(await globalExercise()))
      .expect(201);

    await http()
      .post(`/admin/wods/${wodId(created)}/archive`)
      .set(...asUser(ADMIN))
      .expect(201);

    expect(
      (
        await http()
          .get('/wods')
          .set(...asUser(ALICE))
      ).body,
    ).toHaveLength(0);
  });

  it('is refused an athlete’s own WOD on the admin routes', async () => {
    const hers = await http()
      .post('/wods')
      .set(...asUser(ALICE))
      .send(wodBody(await globalExercise()))
      .expect(201);

    await http()
      .patch(`/admin/wods/${wodId(hers)}`)
      .set(...asUser(ADMIN))
      .send({ timeCapMinutes: 20 })
      .expect(403);
  });

  // The one-way reference rule, end to end. Alice's exercise is real and the
  // id is valid; what refuses it is the tier the route decided.
  it('cannot build a global WOD on an athlete’s own movement', async () => {
    const hers = parsed(
      exerciseSchema,
      await http()
        .post('/exercises')
        .set(...asUser(ALICE))
        .send(exerciseBody())
        .expect(201),
    );

    await http()
      .post('/admin/wods')
      .set(...asUser(ADMIN))
      .send(wodBody(hers.id))
      .expect(400);

    // The same movement, in her own WOD, is fine.
    await http()
      .post('/wods')
      .set(...asUser(ALICE))
      .send(wodBody(hers.id))
      .expect(201);
  });
});

describe('the boundary between them', () => {
  // The whole reason `/admin/wods` is a separate controller: without the guard
  // this is a 200, and one athlete's edit changes what everyone trains.
  it('refuses an athlete every admin route', async () => {
    const exerciseId = await globalExercise();
    const global = await http()
      .post('/admin/wods')
      .set(...asUser(ADMIN))
      .send(wodBody(exerciseId))
      .expect(201);
    const id = wodId(global);

    await http()
      .post('/admin/wods')
      .set(...asUser(ALICE))
      .send(wodBody(exerciseId, { name: 'Sneaky' }))
      .expect(403);
    await http()
      .patch(`/admin/wods/${id}`)
      .set(...asUser(ALICE))
      .send({ timeCapMinutes: 20 })
      .expect(403);
    await http()
      .post(`/admin/wods/${id}/archive`)
      .set(...asUser(ALICE))
      .expect(403);
    await http()
      .post(`/admin/wods/${id}/unarchive`)
      .set(...asUser(ALICE))
      .expect(403);
  });

  // Not a 404: the athlete can read this row through GET /wods, so hiding it
  // would only tell them their pool had lost a workout.
  it('refuses an athlete editing a global WOD through their own route', async () => {
    const global = await http()
      .post('/admin/wods')
      .set(...asUser(ADMIN))
      .send(wodBody(await globalExercise()))
      .expect(201);

    await http()
      .patch(`/wods/${wodId(global)}`)
      .set(...asUser(ALICE))
      .send({ timeCapMinutes: 20 })
      .expect(403);
  });

  // A movement has no route of its own, so this is the only way to reach one
  // — and it goes through the ownership check on the WOD that holds it.
  it('refuses an athlete rewriting another athlete’s movement list', async () => {
    const exerciseId = await globalExercise();
    const his = await http()
      .post('/wods')
      .set(...asUser(BOB))
      .send(wodBody(exerciseId))
      .expect(201);

    await http()
      .patch(`/wods/${wodId(his)}`)
      .set(...asUser(ALICE))
      .send({ movements: [{ exerciseId, reps: 1 }] })
      .expect(403);
  });

  it('lets an athlete shadow a global name without disturbing it', async () => {
    const exerciseId = await globalExercise();
    await http()
      .post('/admin/wods')
      .set(...asUser(ADMIN))
      .send(wodBody(exerciseId))
      .expect(201);

    await http()
      .post('/wods')
      .set(...asUser(ALICE))
      .send(wodBody(exerciseId))
      .expect(201);

    const seen = await http()
      .get('/wods')
      .set(...asUser(ALICE))
      .expect(200);
    expect(seen.body).toHaveLength(2);
  });
});

/**
 * `?includeArchived=true` (DN-29).
 *
 * The same flag the exercise library grew, on the model the scheduler reads
 * from. The service spec proves the filter; what only this layer decides is
 * which boolean the query string turns into.
 */
describe('listing retired workouts over HTTP', () => {
  /** A retired workout of Alice's, under the given name. */
  async function retire(name: string, exerciseId: string) {
    const made = await http()
      .post('/wods')
      .set(...asUser(ALICE))
      .send(wodBody(exerciseId, { name }))
      .expect(201);
    await http()
      .post(`/wods/${wodId(made)}/archive`)
      .set(...asUser(ALICE))
      .expect(201);
  }

  async function names(query: string): Promise<string[]> {
    const res = await http()
      .get(`/wods${query}`)
      .set(...asUser(ALICE))
      .expect(200);
    return z
      .array(wodSchema)
      .parse(res.body)
      .map((w) => w.name);
  }

  it('leaves retired workouts out of the pool a day is planned from', async () => {
    const exerciseId = await globalExercise();
    await retire('Old Fran', exerciseId);
    await http()
      .post('/wods')
      .set(...asUser(ALICE))
      .send(wodBody(exerciseId, { name: 'Cindy' }))
      .expect(201);

    expect(await names('')).toEqual(['Cindy']);
  });

  it('includes them when the editor asks for them', async () => {
    await retire('Old Fran', await globalExercise());

    expect(await names('?includeArchived=true')).toEqual(['Old Fran']);
  });

  // The exact string, not truthiness — the same three spellings the exercise
  // library refuses, for the same reason.
  it.each(['?includeArchived=false', '?includeArchived=0', '?includeArchived'])(
    'reads %s as no',
    async (query) => {
      await retire('Old Fran', await globalExercise());

      expect(await names(query)).toEqual([]);
    },
  );

  it('still hides another athlete’s retired workouts either way', async () => {
    const exerciseId = await globalExercise();
    const his = await http()
      .post('/wods')
      .set(...asUser(BOB))
      .send(wodBody(exerciseId, { name: 'His Fran' }))
      .expect(201);
    await http()
      .post(`/wods/${wodId(his)}/archive`)
      .set(...asUser(BOB))
      .expect(201);

    expect(await names('?includeArchived=true')).toEqual([]);
  });
});
