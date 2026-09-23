import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { exerciseSchema } from '@regimen-works/shared';
import { z } from 'zod';
import { asUser, createE2eApp } from '../test-support/e2e-app';

/**
 * The library write routes through HTTP (DN-25).
 *
 * The service specs prove the rules. What only this layer can prove is the
 * claim the two controllers actually make: that *which tier a write lands in*
 * is a property of the route, never of the body. `POST /exercises` writes the
 * caller's own; `POST /admin/exercises` writes the shared library, and is the
 * same service call with a different writer.
 *
 * Its own file rather than a section of `app.e2e-spec.ts` because it needs a
 * different Clerk stub: these routes are the first in the app that care
 * whether the caller is an admin, so the token has to be able to say so.
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
 * The id of an exercise a request just returned.
 *
 * Through the schema rather than off `res.body`, which supertest types `any`:
 * a response that stopped carrying an id would otherwise read as `undefined`
 * and fail several requests later, pointing at the wrong thing.
 */
function idOf(res: request.Response): string {
  return parsed(exerciseSchema, res).id;
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Ring row',
    pattern: 'pull',
    equipment: [],
    scalable: false,
    unit: 'reps',
    instructions: null,
    movementGroup: null,
    sortOrder: null,
    fallbackExerciseId: null,
    phase: null,
    ...overrides,
  };
}

describe('an athlete writing their own library', () => {
  it('creates a movement only they can see', async () => {
    const created = parsed(
      exerciseSchema,
      await http()
        .post('/exercises')
        .set(...asUser(ALICE))
        .send(body())
        .expect(201),
    );
    expect(created.ownerId).toBe(ALICE);

    const mine = await http()
      .get('/exercises')
      .set(...asUser(ALICE))
      .expect(200);
    expect(mine.body).toHaveLength(1);

    const bobs = await http()
      .get('/exercises')
      .set(...asUser(BOB))
      .expect(200);
    expect(bobs.body).toHaveLength(0);
  });

  it('edits it', async () => {
    const created = await http()
      .post('/exercises')
      .set(...asUser(ALICE))
      .send(body())
      .expect(201);

    const updated = parsed(
      exerciseSchema,
      await http()
        .patch(`/exercises/${idOf(created)}`)
        .set(...asUser(ALICE))
        .send({ scalable: true })
        .expect(200),
    );
    expect(updated.scalable).toBe(true);
    // Untouched fields survive a partial patch.
    expect(updated.name).toBe('Ring row');
  });

  it('retires it and brings it back', async () => {
    const created = await http()
      .post('/exercises')
      .set(...asUser(ALICE))
      .send(body())
      .expect(201);
    const id = idOf(created);

    await http()
      .post(`/exercises/${id}/archive`)
      .set(...asUser(ALICE))
      .expect(201);
    expect(
      (
        await http()
          .get('/exercises')
          .set(...asUser(ALICE))
      ).body,
    ).toHaveLength(0);

    await http()
      .post(`/exercises/${id}/unarchive`)
      .set(...asUser(ALICE))
      .expect(201);
    expect(
      (
        await http()
          .get('/exercises')
          .set(...asUser(ALICE))
      ).body,
    ).toHaveLength(1);
  });

  it('is refused a body that is not an exercise', async () => {
    await http()
      .post('/exercises')
      .set(...asUser(ALICE))
      .send(body({ unit: 'metres' }))
      .expect(400);
  });

  // The tier comes from the route. A body naming `ownerId: null` is not a way
  // into the shared library — the field is stripped before the service sees it.
  it('cannot reach the shared library by naming it in the body', async () => {
    const created = parsed(
      exerciseSchema,
      await http()
        .post('/exercises')
        .set(...asUser(ALICE))
        .send(body({ ownerId: null }))
        .expect(201),
    );
    expect(created.ownerId).toBe(ALICE);
  });
});

describe('an admin curating the shared library', () => {
  it('creates a movement every athlete can see', async () => {
    const created = parsed(
      exerciseSchema,
      await http()
        .post('/admin/exercises')
        .set(...asUser(ADMIN))
        .send(body({ name: 'Air squat' }))
        .expect(201),
    );
    expect(created.ownerId).toBeNull();

    for (const who of [ALICE, BOB]) {
      const seen = await http()
        .get('/exercises')
        .set(...asUser(who))
        .expect(200);
      expect(seen.body).toHaveLength(1);
    }
  });

  it('edits and retires it, taking it out of everyone’s pool at once', async () => {
    const created = await http()
      .post('/admin/exercises')
      .set(...asUser(ADMIN))
      .send(body({ name: 'Air squat' }))
      .expect(201);
    const id = idOf(created);

    await http()
      .patch(`/admin/exercises/${id}`)
      .set(...asUser(ADMIN))
      .send({ name: 'Bodyweight squat' })
      .expect(200);

    await http()
      .post(`/admin/exercises/${id}/archive`)
      .set(...asUser(ADMIN))
      .expect(201);
    expect(
      (
        await http()
          .get('/exercises')
          .set(...asUser(ALICE))
      ).body,
    ).toHaveLength(0);

    await http()
      .post(`/admin/exercises/${id}/unarchive`)
      .set(...asUser(ADMIN))
      .expect(201);
    expect(
      (
        await http()
          .get('/exercises')
          .set(...asUser(ALICE))
      ).body,
    ).toHaveLength(1);
  });

  it('is refused an athlete’s own row on the admin routes', async () => {
    const hers = await http()
      .post('/exercises')
      .set(...asUser(ALICE))
      .send(body())
      .expect(201);

    await http()
      .patch(`/admin/exercises/${idOf(hers)}`)
      .set(...asUser(ADMIN))
      .send({ scalable: true })
      .expect(403);
  });
});

describe('the boundary between them', () => {
  // The whole reason `/admin` is a separate controller: without the guard this
  // is a 200, and one athlete's edit changes what every other athlete trains.
  it('refuses an athlete every admin route', async () => {
    const global = await http()
      .post('/admin/exercises')
      .set(...asUser(ADMIN))
      .send(body({ name: 'Air squat' }))
      .expect(201);
    const id = idOf(global);

    await http()
      .post('/admin/exercises')
      .set(...asUser(ALICE))
      .send(body({ name: 'Sneaky' }))
      .expect(403);
    await http()
      .patch(`/admin/exercises/${id}`)
      .set(...asUser(ALICE))
      .send({ scalable: true })
      .expect(403);
    await http()
      .post(`/admin/exercises/${id}/archive`)
      .set(...asUser(ALICE))
      .expect(403);
    await http()
      .post(`/admin/exercises/${id}/unarchive`)
      .set(...asUser(ALICE))
      .expect(403);
  });

  // Not a 404: the athlete can read this row through GET /exercises, so
  // hiding it would only tell them their library had lost a movement.
  it('refuses an athlete editing global content through their own route', async () => {
    const global = await http()
      .post('/admin/exercises')
      .set(...asUser(ADMIN))
      .send(body({ name: 'Air squat' }))
      .expect(201);

    await http()
      .patch(`/exercises/${idOf(global)}`)
      .set(...asUser(ALICE))
      .send({ scalable: true })
      .expect(403);
    await http()
      .post(`/exercises/${idOf(global)}/archive`)
      .set(...asUser(ALICE))
      .expect(403);
  });

  it('refuses an athlete editing another athlete’s movement', async () => {
    const his = await http()
      .post('/exercises')
      .set(...asUser(BOB))
      .send(body())
      .expect(201);

    await http()
      .patch(`/exercises/${idOf(his)}`)
      .set(...asUser(ALICE))
      .send({ scalable: true })
      .expect(403);
  });

  it('lets an athlete shadow a global name without disturbing it', async () => {
    await http()
      .post('/admin/exercises')
      .set(...asUser(ADMIN))
      .send(body({ name: 'Air squat' }))
      .expect(201);

    const hers = parsed(
      exerciseSchema,
      await http()
        .post('/exercises')
        .set(...asUser(ALICE))
        .send(body({ name: 'Air squat' }))
        .expect(201),
    );
    expect(hers.ownerId).toBe(ALICE);

    const seen = await http()
      .get('/exercises')
      .set(...asUser(ALICE))
      .expect(200);
    expect(seen.body).toHaveLength(2);
  });
});

/**
 * `?includeArchived=true` (DN-28).
 *
 * The one place the management screen and the planner disagree about what the
 * library is: a retired movement has to be listable in order to be brought
 * back, and must never reach the pool a workout is planned from. Both halves
 * of that live in the query string, which is why they are asserted here rather
 * than against the service — the service is handed a boolean, and what this
 * layer decides is which boolean.
 */
describe('listing retired movements over HTTP', () => {
  /** A retired movement of Alice's, and the name it was retired under. */
  async function retire(name: string) {
    const made = await http()
      .post('/exercises')
      .set(...asUser(ALICE))
      .send(body({ name }))
      .expect(201);
    await http()
      .post(`/exercises/${idOf(made)}/archive`)
      .set(...asUser(ALICE))
      .expect(201);
    return idOf(made);
  }

  async function names(query: string): Promise<string[]> {
    const res = await http()
      .get(`/exercises${query}`)
      .set(...asUser(ALICE))
      .expect(200);
    return z
      .array(exerciseSchema)
      .parse(res.body)
      .map((e) => e.name);
  }

  it('leaves retired movements out of the list a workout is planned from', async () => {
    await retire('Burpee');
    await http()
      .post('/exercises')
      .set(...asUser(ALICE))
      .send(body({ name: 'Ring row' }))
      .expect(201);

    expect(await names('')).toEqual(['Ring row']);
  });

  it('includes them when the management screen asks for them', async () => {
    await retire('Burpee');

    expect(await names('?includeArchived=true')).toEqual(['Burpee']);
  });

  // The exact string, not truthiness: "false" and "0" are what someone writes
  // when they mean no, and a bare `?includeArchived` is a flag that got lost
  // on its way into a URL rather than a request for retired content.
  it.each(['?includeArchived=false', '?includeArchived=0', '?includeArchived'])(
    'reads %s as no',
    async (query) => {
      await retire('Burpee');

      expect(await names(query)).toEqual([]);
    },
  );

  it('still hides another athlete’s retired movements either way', async () => {
    const his = await http()
      .post('/exercises')
      .set(...asUser(BOB))
      .send(body({ name: 'Burpee' }))
      .expect(201);
    await http()
      .post(`/exercises/${idOf(his)}/archive`)
      .set(...asUser(BOB))
      .expect(201);

    expect(await names('?includeArchived=true')).toEqual([]);
  });
});
