import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  settingsSchema,
  skillLevelSchema,
  todayResponseSchema,
  workoutLogListItemSchema,
  workoutLogSchema,
  workoutSessionSchema,
} from '@regimen-works/shared';
import { z } from 'zod';
import { asUser, createE2eApp } from './test-support/e2e-app';
import { testPrisma } from './test-support/database';
import {
  createAssignment,
  createLadder,
  createWod,
} from './test-support/fixtures';

jest.mock('@clerk/backend', () => ({
  verifyToken: jest.fn((token: string) =>
    token.startsWith('user_')
      ? Promise.resolve({ sub: token })
      : Promise.reject(new Error('invalid token')),
  ),
}));

/**
 * The API through HTTP, against a real database (DN-53).
 *
 * This is the layer nothing else reaches: the controllers, the global guards
 * and interceptor, status codes, and the shape that actually goes over the
 * wire. The service specs prove the queries; these prove a request reaches
 * them and comes back as the contract `apps/web` is written against.
 *
 * It replaces the scaffold stub deleted in DN-48, which asserted that `GET /`
 * returned "Hello World!" and never ran in CI. This one runs in CI.
 *
 * Clerk's JWT verification is stubbed above — that is cryptography, Clerk's to
 * get right, and it needs their signing keys. The guard itself is not stubbed:
 * it still runs on every route, parses the bearer header, 401s what it cannot
 * verify, and provisions the athlete. The token is the user id, so a request
 * speaks as someone else by naming them.
 */

let app: INestApplication<App>;

/**
 * A fresh athlete id per test, and the reason is worth knowing:
 * `UserProvisioningService` caches who it has already provisioned for the life
 * of the process, while the DN-99 reset empties the tables between tests.
 * Reusing an id would leave the cache saying "already provisioned" over a
 * database with no such row, and the next insert would fail on a foreign key.
 * Production never deletes users, so this is a constraint of the harness
 * rather than a bug in the cache — but it is a sharp edge for anyone adding a
 * test here.
 */
let seq = 0;
let ALICE: string;
let MALLORY: string;

beforeEach(() => {
  seq += 1;
  ALICE = `user_alice_${seq}`;
  MALLORY = `user_mallory_${seq}`;
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

/**
 * Reads a response body through the shared schema it is supposed to satisfy.
 *
 * Doubles as an assertion: `apps/web` is written against these types, so a
 * field renamed or dropped on the way out fails here rather than in the
 * browser. It also keeps supertest's `any` body out of the tests.
 */
function parsed<T>(schema: z.ZodType<T>, res: request.Response): T {
  return schema.parse(res.body);
}

/** Enough of a library for the scheduler to have something to assign. */
async function seedLibrary() {
  const { rungs } = await createLadder('pull', [
    'Negative chin-up',
    'Chin-up',
    'Pull-up',
  ]);
  const wod = await createWod({
    dominantPattern: 'pull',
    movements: [{ exerciseId: rungs[0].id, reps: 30, order: 0 }],
  });
  return { rungs, wod };
}

async function todaysAssignmentId(userId: string) {
  const today = parsed(
    todayResponseSchema,
    await http()
      .get('/today')
      .set(...asUser(userId))
      .expect(200),
  );
  if (!today.assignment) throw new Error('expected an assignment for today');
  return today.assignment.id;
}

describe('auth', () => {
  it('rejects a request with no token', async () => {
    await http().get('/exercises').expect(401);
  });

  it('rejects a token it cannot verify', async () => {
    await http()
      .get('/exercises')
      .set('Authorization', 'Bearer forged')
      .expect(401);
  });

  it('rejects a non-bearer authorization header', async () => {
    await http()
      .get('/exercises')
      .set('Authorization', 'Basic dXNlcjpwYXNz')
      .expect(401);
  });

  it('admits a verified token', async () => {
    await http()
      .get('/exercises')
      .set(...asUser(ALICE))
      .expect(200);
  });

  it('leaves the health check public for Render', async () => {
    await http().get('/').expect(200);
  });

  it('provisions the athlete on their first authenticated request', async () => {
    // Clerk owns identity, so a user simply exists the first time they present
    // a valid token — there is no sign-up hook to wait for.
    expect(await testPrisma().user.count()).toBe(0);

    await http()
      .get('/exercises')
      .set(...asUser(ALICE))
      .expect(200);

    expect(
      await testPrisma().user.findUnique({ where: { id: ALICE } }),
    ).not.toBeNull();
    // DN-86: a ScheduleRule, but deliberately no SkillLevel rows — the app
    // holds no opinion about someone it has never seen train.
    expect(await testPrisma().scheduleRule.count()).toBe(1);
    expect(await testPrisma().skillLevel.count()).toBe(0);
  });
});

describe('GET /today', () => {
  it('generates an assignment and returns the day', async () => {
    await seedLibrary();

    const today = parsed(
      todayResponseSchema,
      await http()
        .get('/today')
        .set(...asUser(ALICE))
        .expect(200),
    );

    expect(today).toMatchObject({
      isRestDay: false,
      warmupCooldownEnabled: false,
      assignment: { status: 'scheduled' },
    });
    expect(today.assignment?.wod.movements).toHaveLength(1);
  });

  it('fails loudly on an empty WOD library rather than reading as a rest day', async () => {
    // `pickWod` throws with nothing to choose from, which surfaces as a 500.
    // That is the right shape: an empty library is a broken deploy, and
    // answering "rest day" would hide it behind a plausible screen.
    await http()
      .get('/today')
      .set(...asUser(ALICE))
      .expect(500);
  });

  it('keeps two athletes days apart', async () => {
    await seedLibrary();

    const alice = parsed(
      todayResponseSchema,
      await http()
        .get('/today')
        .set(...asUser(ALICE))
        .expect(200),
    );
    const mallory = parsed(
      todayResponseSchema,
      await http()
        .get('/today')
        .set(...asUser(MALLORY))
        .expect(200),
    );

    expect(alice.assignment?.id).not.toBe(mallory.assignment?.id);
  });

  it('returns the same assignment on a second read rather than generating another', async () => {
    await seedLibrary();

    const first = await todaysAssignmentId(ALICE);
    const second = await todaysAssignmentId(ALICE);

    expect(second).toBe(first);
    expect(await testPrisma().dailyAssignment.count()).toBe(1);
  });
});

describe('POST /today/skip', () => {
  it('marks the day as rest', async () => {
    await seedLibrary();
    await todaysAssignmentId(ALICE);

    const res = parsed(
      todayResponseSchema,
      await http()
        .post('/today/skip')
        .set(...asUser(ALICE))
        .expect(201),
    );

    expect(res.isRestDay).toBe(true);
    expect(res.assignment).toBeNull();
  });
});

describe('the workout, end to end', () => {
  it('starts, records rounds, finishes, and logs a result', async () => {
    await seedLibrary();
    const assignmentId = await todaysAssignmentId(ALICE);

    const started = parsed(
      workoutSessionSchema,
      await http()
        .post(`/assignments/${assignmentId}/session`)
        .set(...asUser(ALICE))
        .expect(201),
    );
    expect(started).toMatchObject({ status: 'in_progress', capSeconds: 720 });

    const rounds = parsed(
      workoutSessionSchema,
      await http()
        .post(`/assignments/${assignmentId}/session/rounds`)
        .set(...asUser(ALICE))
        .send({ round: 1, atSeconds: 90 })
        .expect(201),
    );
    expect(rounds.roundSplits).toEqual([{ round: 1, atSeconds: 90 }]);

    const finished = parsed(
      workoutSessionSchema,
      await http()
        .post(`/assignments/${assignmentId}/session/finish`)
        .set(...asUser(ALICE))
        .expect(201),
    );
    expect(finished.status).toBe('completed');

    const logged = parsed(
      workoutLogSchema,
      await http()
        .post(`/assignments/${assignmentId}/log`)
        .set(...asUser(ALICE))
        .send({ resultType: 'time_seconds', resultValue: '305', rpe: 8 })
        .expect(201),
    );
    expect(logged).toMatchObject({ resultValue: '305', rpe: 8 });

    const history = parsed(
      z.array(workoutLogListItemSchema),
      await http()
        .get('/logs')
        .set(...asUser(ALICE))
        .expect(200),
    );
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ resultValue: '305' });
  });

  it('cancels a session and hands the day back', async () => {
    await seedLibrary();
    const assignmentId = await todaysAssignmentId(ALICE);
    await http()
      .post(`/assignments/${assignmentId}/session`)
      .set(...asUser(ALICE))
      .expect(201);

    // 204, not 200: cancel returns nothing, and the interceptor says so.
    await http()
      .delete(`/assignments/${assignmentId}/session`)
      .set(...asUser(ALICE))
      .expect(204);

    expect(await testPrisma().workoutSession.count()).toBe(0);
  });
});

describe('204 for an absent resource', () => {
  // NoContentInterceptor. An endpoint that models "absent" as null would
  // otherwise answer 200 with an empty body, which no client can parse as
  // JSON. The interceptor is registered in bootstrap, not in AppModule, so
  // this only holds because createE2eApp mirrors main.ts.
  it('answers 204 for a session that has not been started', async () => {
    await seedLibrary();
    const assignmentId = await todaysAssignmentId(ALICE);

    const res = await http()
      .get(`/assignments/${assignmentId}/session`)
      .set(...asUser(ALICE))
      .expect(204);

    expect(res.text).toBe('');
  });

  it('answers 204 for a result that has not been logged', async () => {
    await seedLibrary();
    const assignmentId = await todaysAssignmentId(ALICE);

    await http()
      .get(`/assignments/${assignmentId}/log`)
      .set(...asUser(ALICE))
      .expect(204);
  });
});

describe('settings and skill levels', () => {
  it('reads the defaults before anything has been set', async () => {
    const res = parsed(
      settingsSchema,
      await http()
        .get('/settings')
        .set(...asUser(ALICE))
        .expect(200),
    );

    expect(res).toEqual({
      warmupCooldownEnabled: false,
      autoStopAtCapEnabled: true,
      equipment: ['bar'],
    });
  });

  it('patches one toggle and leaves the other alone', async () => {
    await http()
      .patch('/settings')
      .set(...asUser(ALICE))
      .send({ autoStopAtCapEnabled: false })
      .expect(200);

    const res = parsed(
      settingsSchema,
      await http()
        .patch('/settings')
        .set(...asUser(ALICE))
        .send({ warmupCooldownEnabled: true })
        .expect(200),
    );

    expect(res).toEqual({
      warmupCooldownEnabled: true,
      autoStopAtCapEnabled: false,
      equipment: ['bar'],
    });
  });

  it('keeps one athlete settings out of another', async () => {
    await http()
      .patch('/settings')
      .set(...asUser(MALLORY))
      .send({ warmupCooldownEnabled: true })
      .expect(200);

    const res = parsed(
      settingsSchema,
      await http()
        .get('/settings')
        .set(...asUser(ALICE))
        .expect(200),
    );
    expect(res.warmupCooldownEnabled).toBe(false);
  });

  it('replaces the whole equipment set over HTTP', async () => {
    await http()
      .patch('/settings')
      .set(...asUser(ALICE))
      .send({ equipment: ['jump_rope', 'box'] })
      .expect(200);

    const res = parsed(
      settingsSchema,
      await http()
        .patch('/settings')
        .set(...asUser(ALICE))
        .send({ equipment: ['box'] })
        .expect(200),
    );

    expect(res.equipment).toEqual(['box']);
  });

  it('refuses a piece the catalog does not have', async () => {
    // The column is a bare String[]; validateBody is what stands between a
    // typo in a client and a tag no ownership check will ever match.
    await http()
      .patch('/settings')
      .set(...asUser(ALICE))
      .send({ equipment: ['sandbag'] })
      .expect(400);
  });

  it('starts with no skill levels, since nothing has been chosen yet', async () => {
    const res = parsed(
      z.array(skillLevelSchema),
      await http()
        .get('/skill-levels')
        .set(...asUser(ALICE))
        .expect(200),
    );

    expect(res).toEqual([]);
  });

  it('sets a line standing choice', async () => {
    await seedLibrary();

    const res = parsed(
      skillLevelSchema,
      await http()
        .patch('/skill-levels/pull')
        .set(...asUser(ALICE))
        .send({ rung: 2 })
        .expect(200),
    );

    expect(res).toMatchObject({ line: 'pull', rung: 2 });
  });

  it('refuses a rung with no exercise seeded at it', async () => {
    // Bounded to what exists, so the scheduler never has to fall back on a
    // missing rung. The seeded pull ladder tops out at 2.
    await seedLibrary();

    await http()
      .patch('/skill-levels/pull')
      .set(...asUser(ALICE))
      .send({ rung: 9 })
      .expect(400);
  });

  it('404s a line that is not one of the eight', async () => {
    // "push" is a movement pattern; the lines are finer-grained than that.
    await http()
      .patch('/skill-levels/push')
      .set(...asUser(ALICE))
      .send({ rung: 0 })
      .expect(404);
  });
});

describe('validation and not-found', () => {
  it('400s a body that does not parse, naming the field', async () => {
    await seedLibrary();
    const assignmentId = await todaysAssignmentId(ALICE);
    await http()
      .post(`/assignments/${assignmentId}/session`)
      .set(...asUser(ALICE))
      .expect(201);

    const res = await http()
      .post(`/assignments/${assignmentId}/session/rounds`)
      .set(...asUser(ALICE))
      .send({ round: 0, atSeconds: 90 })
      .expect(400);

    // validateBody names the offending path, so a client can say which field.
    expect(JSON.stringify(res.body)).toContain('round');
  });

  it('400s a log with an RPE off the scale', async () => {
    await seedLibrary();
    const assignmentId = await todaysAssignmentId(ALICE);

    await http()
      .post(`/assignments/${assignmentId}/log`)
      .set(...asUser(ALICE))
      .send({ resultType: 'time_seconds', resultValue: '305', rpe: 11 })
      .expect(400);
  });

  it('400s an empty result value', async () => {
    await seedLibrary();
    const assignmentId = await todaysAssignmentId(ALICE);

    await http()
      .post(`/assignments/${assignmentId}/log`)
      .set(...asUser(ALICE))
      .send({ resultType: 'time_seconds', resultValue: '' })
      .expect(400);
  });

  it('404s an unknown assignment id', async () => {
    await http()
      .post('/assignments/does-not-exist/session')
      .set(...asUser(ALICE))
      .expect(404);
  });

  it('404s another athlete assignment rather than acting on it', async () => {
    const { wod } = await seedLibrary();
    const mallory = await testPrisma().user.create({ data: { id: MALLORY } });
    const theirs = await createAssignment(mallory.id, { wodId: wod.id });

    await http()
      .post(`/assignments/${theirs.id}/session`)
      .set(...asUser(ALICE))
      .expect(404);

    expect(await testPrisma().workoutSession.count()).toBe(0);
  });
});
