import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  movementHistorySchema,
  settingsSchema,
  skillLevelSchema,
  todayResponseSchema,
  workoutLogListItemSchema,
  workoutLogSchema,
  workoutSessionSchema,
  movementVolumeSchema,
  workoutSetLogSchema,
  meSchema,
  setupOptionsSchema,
  completedProgramSchema,
  addIsoDays,
  DEFAULT_PLAN_ID,
} from '@regimen-works/shared';
import { z } from 'zod';
import { asUser, createE2eApp } from './test-support/e2e-app';
import { todayIsoDate } from './common/today';
import { testPrisma } from './test-support/database';
import {
  createAssignment,
  createExercise,
  createFixedPlan,
  createGroup,
  createPlan,
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

/**
 * Puts the athlete on a seven-day week before the test asks what today is.
 *
 * Without it the suite fails every Saturday and Sunday in CI (DN-122), for a
 * reason that is not a bug in the app: a freshly provisioned athlete trains
 * Monday to Friday, so on a weekend `/today` correctly answers `isRestDay:
 * true` and every assertion expecting an assignment collapses. It never
 * showed up on a developer machine west of UTC, where the runner is already
 * on Saturday while the laptop is still on Friday.
 *
 * The fix is for the test to *state* the schedule it depends on rather than
 * inherit one. It goes through `PATCH /settings` rather than writing the row,
 * so it also provisions the athlete the way a first request would, and it
 * asserts the round trip -- a settings write that silently stopped taking
 * would otherwise leave every one of these tests passing for the wrong
 * reason.
 */
async function trainsEveryDay(...userIds: string[]) {
  for (const userId of userIds) {
    const settings = parsed(
      settingsSchema,
      await http()
        .patch('/settings')
        .set(...asUser(userId))
        .send({ trainingDays: [0, 1, 2, 3, 4, 5, 6] })
        .expect(200),
    );
    expect(settings.trainingDays).toEqual([0, 1, 2, 3, 4, 5, 6]);
  }
}

/** Enough of a library for the scheduler to have something to assign. */
async function seedLibrary() {
  const { members } = await createGroup('pull', [
    'Negative chin-up',
    'Chin-up',
    'Pull-up',
  ]);
  const wod = await createWod({
    dominantPattern: 'pull',
    movements: [{ exerciseId: members[0].id, reps: 30, order: 0 }],
  });
  return { members, wod };
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

  it('leaves the front door public', async () => {
    await http().get('/').expect(200);
  });

  it('leaves the health check public for Render, and reaches the database', async () => {
    // Public because the probe cannot send an auth header; a real round-trip
    // because a check that only proves the process is listening reports a
    // service with an unreachable database as healthy (DN-76).
    const health = await http().get('/health').expect(200);

    expect(health.body).toEqual({
      status: 'ok',
      database: 'up',
      consecutiveFailures: 0,
    });
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
  beforeEach(() => trainsEveryDay(ALICE, MALLORY));

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
    expect(today.assignment?.wod!.movements).toHaveLength(1);
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

  it('serves the equipment an athlete owns, over HTTP (DN-79)', async () => {
    // The resolution layers are covered in scheduler.service.db-spec.ts; what
    // this adds is that the answer survives the controller and the response
    // schema -- a field the API resolves and the DTO drops would pass there
    // and fail here.
    const row = await createExercise({
      name: 'Row under table',
      pattern: 'pull',
      movementGroup: null,
      sortOrder: null,
    });
    const pullUp = await createExercise({
      name: 'Pull-up',
      pattern: 'pull',
      movementGroup: 'pull',
      sortOrder: 0,
      equipment: ['bar'],
      fallbackExerciseId: row.id,
    });
    await createWod({
      dominantPattern: 'pull',
      movements: [{ exerciseId: pullUp.id, reps: 30, order: 0 }],
    });
    await http()
      .patch('/settings')
      .set(...asUser(ALICE))
      .send({ equipment: [] })
      .expect(200);

    const today = parsed(
      todayResponseSchema,
      await http()
        .get('/today')
        .set(...asUser(ALICE))
        .expect(200),
    );

    const movement = today.assignment!.wod!.movements[0];
    expect(movement.exercise.name).toBe('Row under table');
    expect(movement.prescribedName).toBe('Pull-up');
    expect(movement.prescribedReason).toBe('equipment');
  });
});

describe('POST /today/skip', () => {
  beforeEach(() => trainsEveryDay(ALICE));

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

describe('POST /today/makeup', () => {
  /**
   * Whatever day CI runs on, put the athlete on the other six (DN-17). The
   * date is read the way the controller reads it rather than from the test's
   * own clock, so the rest day this sets up is the same day the API resolves.
   */
  async function restsToday(userId: string) {
    const today = new Date(`${todayIsoDate()}T00:00:00Z`).getUTCDay();
    const days = [0, 1, 2, 3, 4, 5, 6].filter((day) => day !== today);
    const settings = parsed(
      settingsSchema,
      await http()
        .patch('/settings')
        .set(...asUser(userId))
        .send({ trainingDays: days })
        .expect(200),
    );
    expect(settings.trainingDays).toEqual(days);
  }

  it('offers the makeup on a rest day and hands over the session', async () => {
    await seedLibrary();
    await restsToday(ALICE);

    const rest = parsed(
      todayResponseSchema,
      await http()
        .get('/today')
        .set(...asUser(ALICE))
        .expect(200),
    );
    expect(rest.isRestDay).toBe(true);
    expect(rest.assignment).toBeNull();
    expect(rest.makeup).toEqual({ sessionsThisWeek: 6, completedThisWeek: 0 });

    const taken = parsed(
      todayResponseSchema,
      await http()
        .post('/today/makeup')
        .set(...asUser(ALICE))
        .expect(201),
    );
    expect(taken.isRestDay).toBe(false);
    expect(taken.assignment).not.toBeNull();
    // The offer is spent: there is a session on today now.
    expect(taken.makeup).toBeNull();
  });

  it('refuses on a day the athlete is already training', async () => {
    await seedLibrary();
    await trainsEveryDay(ALICE);

    await http()
      .post('/today/makeup')
      .set(...asUser(ALICE))
      .expect(409);
  });
});

describe('the workout, end to end', () => {
  beforeEach(() => trainsEveryDay(ALICE));

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

    // And the same day, read as movements rather than as a result (DN-89).
    // It comes from the session snapshot, so it exists because the workout was
    // started and finished — not because anything was swapped.
    const movements = parsed(
      z.array(movementHistorySchema),
      await http()
        .get('/movement-history')
        .set(...asUser(ALICE))
        .expect(200),
    );
    expect(movements.length).toBeGreaterThan(0);
    expect(movements[0]).toMatchObject({ sessions: 1 });
    expect(movements[0].days[0]).toMatchObject({ isSwapped: false });
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
  beforeEach(() => trainsEveryDay(ALICE));

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
      trainingDays: [1, 2, 3, 4, 5],
      patternCooldownDays: 5,
      scheduleLock: null,
      restPace: null,
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
      trainingDays: [1, 2, 3, 4, 5],
      patternCooldownDays: 5,
      scheduleLock: null,
      restPace: null,
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

  it('replaces the training days over HTTP, in order (DN-12)', async () => {
    const res = parsed(
      settingsSchema,
      await http()
        .patch('/settings')
        .set(...asUser(ALICE))
        .send({ trainingDays: [6, 2, 0] })
        .expect(200),
    );

    // Sorted on the way in, so what comes back is comparable to any other
    // stored set and a picker's tap order never reaches the database.
    expect(res.trainingDays).toEqual([0, 2, 6]);
  });

  it('sets the pattern cooldown over HTTP, zero included (DN-27)', async () => {
    const res = parsed(
      settingsSchema,
      await http()
        .patch('/settings')
        .set(...asUser(ALICE))
        .send({ patternCooldownDays: 0 })
        .expect(200),
    );

    // Zero is the rule turned off, not a field left out.
    expect(res.patternCooldownDays).toBe(0);
  });

  it('refuses a cooldown wider than the history the scheduler reads', async () => {
    // SchedulerService reads that history with `take: 30`, so 31 is a number
    // it could store and then fail to honour.
    await http()
      .patch('/settings')
      .set(...asUser(ALICE))
      .send({ patternCooldownDays: 31 })
      .expect(400);

    await http()
      .patch('/settings')
      .set(...asUser(ALICE))
      .send({ patternCooldownDays: -1 })
      .expect(400);
  });

  it('refuses a weekday outside 0-6, and an empty week', async () => {
    await http()
      .patch('/settings')
      .set(...asUser(ALICE))
      .send({ trainingDays: [7] })
      .expect(400);

    // An athlete who trains on no days has no app to open; "I'm taking a
    // break" is answered by not opening it, not by emptying this.
    await http()
      .patch('/settings')
      .set(...asUser(ALICE))
      .send({ trainingDays: [] })
      .expect(400);
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

  it('sets a movementGroup standing choice', async () => {
    const { members } = await seedLibrary();

    const res = parsed(
      skillLevelSchema,
      await http()
        .patch('/skill-levels/pull')
        .set(...asUser(ALICE))
        .send({ exerciseId: members[2].id })
        .expect(200),
    );

    expect(res).toMatchObject({
      movementGroup: 'pull',
      exerciseId: members[2].id,
      exerciseName: members[2].name,
    });
  });

  it('404s a movement that is not in the library', async () => {
    // Bounded to what exists, so the scheduler is never handed a choice that
    // resolves to nothing on every later read (DN-139).
    await seedLibrary();

    await http()
      .patch('/skill-levels/pull')
      .set(...asUser(ALICE))
      .send({ exerciseId: 'no-such-exercise' })
      .expect(404);
  });

  it('400s a movement from another movement group', async () => {
    const squat = await createExercise({ movementGroup: 'squat' });

    await http()
      .patch('/skill-levels/pull')
      .set(...asUser(ALICE))
      .send({ exerciseId: squat.id })
      .expect(400);
  });

  it('404s a movementGroup that is not one of the eight', async () => {
    // "push" is a movement pattern; the groups are finer-grained than that.
    const { members } = await seedLibrary();

    await http()
      .patch('/skill-levels/push')
      .set(...asUser(ALICE))
      .send({ exerciseId: members[0].id })
      .expect(404);
  });
});

describe('validation and not-found', () => {
  beforeEach(() => trainsEveryDay(ALICE));

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

/** A slot prescribing `pull, 5x3`, and today's assignment pointing at it. */
async function prescribedDay(userId: string) {
  const { members } = await createGroup('pull', [
    'Negative chin-up',
    'Chin-up',
    'Pull-up',
  ]);
  const plan = await createPlan({
    weeks: {
      create: [
        {
          order: 0,
          phase: 'core',
          slots: {
            create: [
              {
                dayOfWeek: 3,
                kind: 'movements',
                movements: {
                  create: [
                    {
                      order: 0,
                      movementGroup: 'pull',
                      sets: 5,
                      reps: 3,
                      restSeconds: 90,
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
    },
  });
  const slot = await testPrisma().planSlot.findFirstOrThrow({
    where: { planWeek: { planId: plan.id } },
    include: { movements: true },
  });
  const assignment = await testPrisma().dailyAssignment.create({
    data: {
      userId,
      date: todayIsoDate(),
      status: 'scheduled',
      planSlotId: slot.id,
    },
  });
  return { members, assignment, movement: slot.movements[0] };
}

/**
 * Swapping a movement on a program's straight-sets day (DN-125).
 *
 * Here rather than in the service spec because what is at risk is routing: the
 * two DELETE paths differ only by a prefix, and a `prescribed/:id` declared
 * below `:wodMovementId` would be swallowed whole by it — with the swap left
 * in place and a 204 saying otherwise.
 */
describe('POST/DELETE /assignments/:id/substitutions, on a prescribed day', () => {
  it('takes the swap by the prescribed movement, and gives it back', async () => {
    await http()
      .get('/exercises')
      .set(...asUser(ALICE))
      .expect(200);
    const alice = await testPrisma().user.findFirstOrThrow();
    const { members, assignment, movement } = await prescribedDay(alice.id);

    await http()
      .post(`/assignments/${assignment.id}/substitutions`)
      .set(...asUser(ALICE))
      .send({ planSlotMovementId: movement.id, exerciseId: members[2].id })
      .expect(201);
    expect(
      await testPrisma().assignmentSubstitution.count({
        where: { planSlotMovementId: movement.id },
      }),
    ).toBe(1);

    await http()
      .delete(
        `/assignments/${assignment.id}/substitutions/prescribed/${movement.id}`,
      )
      .set(...asUser(ALICE))
      .expect(204);

    expect(await testPrisma().assignmentSubstitution.count()).toBe(0);
  });

  it('refuses a body naming neither kind of movement', async () => {
    await http()
      .get('/exercises')
      .set(...asUser(ALICE))
      .expect(200);
    const alice = await testPrisma().user.findFirstOrThrow();
    const { members, assignment } = await prescribedDay(alice.id);

    await http()
      .post(`/assignments/${assignment.id}/substitutions`)
      .set(...asUser(ALICE))
      .send({ exerciseId: members[2].id })
      .expect(400);
  });
});

/**
 * A prescribed day, run end to end (DN-20).
 *
 * The other half of `the workout, end to end`, and here for the same reason:
 * every layer this crosses is exercised elsewhere, but nothing else proves the
 * untimed path holds together from `start` to a logged result. It is also the
 * one route where the session has no WOD at all, so a `capSeconds` or a
 * `wodId` assumed non-null anywhere between the controller and the log would
 * surface here and nowhere else.
 */
describe('the straight-sets session, end to end', () => {
  it('starts, counts sets, finishes, and logs a result', async () => {
    await http()
      .get('/exercises')
      .set(...asUser(ALICE))
      .expect(200);
    const alice = await testPrisma().user.findFirstOrThrow();
    const { assignment, movement } = await prescribedDay(alice.id);

    const started = parsed(
      workoutSessionSchema,
      await http()
        .post(`/assignments/${assignment.id}/session`)
        .set(...asUser(ALICE))
        .expect(201),
    );
    // Untimed, and counting from zero rather than from nothing: null would be
    // a WOD day, which is what the runner forks on.
    expect(started).toMatchObject({
      status: 'in_progress',
      capSeconds: null,
      autoStopAtCap: false,
      setsCompleted: 0,
    });
    expect(started.movements).toHaveLength(1);
    expect(started.movements[0]).toMatchObject({
      wodMovementId: null,
      planSlotMovementId: movement.id,
      sets: 5,
      restSeconds: 90,
      // One set's count, not the day's fifteen reps.
      reps: 3,
    });

    const afterFirst = parsed(
      workoutSessionSchema,
      await http()
        .post(`/assignments/${assignment.id}/session/sets`)
        .set(...asUser(ALICE))
        .send({ setsCompleted: 1, restStartedAtSeconds: 42 })
        .expect(201),
    );
    expect(afterFirst).toMatchObject({
      setsCompleted: 1,
      restStartedAtSeconds: 42,
    });

    // The tap that did not reach the API the first time. An absolute count, so
    // replaying it is where the athlete already was rather than a sixth set.
    const replayed = parsed(
      workoutSessionSchema,
      await http()
        .post(`/assignments/${assignment.id}/session/sets`)
        .set(...asUser(ALICE))
        .send({ setsCompleted: 1, restStartedAtSeconds: 42 })
        .expect(201),
    );
    expect(replayed.setsCompleted).toBe(1);

    // Past the last set is not a set the day has.
    await http()
      .post(`/assignments/${assignment.id}/session/sets`)
      .set(...asUser(ALICE))
      .send({ setsCompleted: 6, restStartedAtSeconds: null })
      .expect(400);

    const done = parsed(
      workoutSessionSchema,
      await http()
        .post(`/assignments/${assignment.id}/session/sets`)
        .set(...asUser(ALICE))
        .send({ setsCompleted: 5, restStartedAtSeconds: null })
        .expect(201),
    );
    expect(done).toMatchObject({
      setsCompleted: 5,
      restStartedAtSeconds: null,
    });

    const finished = parsed(
      workoutSessionSchema,
      await http()
        .post(`/assignments/${assignment.id}/session/finish`)
        .set(...asUser(ALICE))
        .expect(201),
    );
    expect(finished.status).toBe('completed');
    // No cap to have been stopped by, however long the session ran.
    expect(finished.capSeconds).toBeNull();

    // The sets themselves, which the counter alone cannot say anything about
    // (DN-21). Read after the finish because this is when the log screen
    // asks: the session is over and the athlete is writing the day down.
    const sets = parsed(
      z.array(workoutSetLogSchema),
      await http()
        .get(`/assignments/${assignment.id}/session/sets`)
        .set(...asUser(ALICE))
        .expect(200),
    );
    // Two rows and not three: the replayed tap finished no set. Both read as
    // prescribed, which is what the runner records.
    expect(sets).toMatchObject([
      { movementOrder: 0, setNumber: 1, prescribedReps: 3, actualReps: 3 },
      { movementOrder: 0, setNumber: 5, prescribedReps: 3, actualReps: 3 },
    ]);

    // And the correction the log screen makes: "I said three, it was two".
    const corrected = parsed(
      z.array(workoutSetLogSchema),
      await http()
        .patch(`/assignments/${assignment.id}/session/sets`)
        .set(...asUser(ALICE))
        .send({ sets: [{ movementOrder: 0, setNumber: 1, actualReps: 2 }] })
        .expect(200),
    );
    expect(corrected.map((row) => row.actualReps)).toEqual([2, 3]);

    // A set no session recorded cannot be conjured from this screen.
    await http()
      .patch(`/assignments/${assignment.id}/session/sets`)
      .set(...asUser(ALICE))
      .send({ sets: [] })
      .expect(400);

    // The line DN-126 moved. This was a 400 — `POST /log` read the
    // assignment's WOD to know what kind of number it was being handed, and a
    // strength day has none — so the screens routed around it and the day
    // ended with nothing written down.
    const log = parsed(
      workoutLogSchema,
      await http()
        .post(`/assignments/${assignment.id}/log`)
        .set(...asUser(ALICE))
        .send({ resultType: 'sets_completed', resultValue: '5/5', rpe: 7 })
        .expect(201),
    );
    expect(log).toMatchObject({
      resultType: 'sets_completed',
      resultValue: '5/5',
      rpe: 7,
    });

    // A clock score on a day that has no clock. Both guards matter because
    // the two kinds of result are stored in the same two columns: without
    // this one a strength day could file a time, and Stats would chart it
    // against metcons.
    await http()
      .post(`/assignments/${assignment.id}/log`)
      .set(...asUser(ALICE))
      .send({ resultType: 'rounds_reps', resultValue: '5', rpe: 7 })
      .expect(400);

    // And it reaches History, which used to drop it. The round trip is the
    // point: saved, then read back by the screen that claims to show it.
    const history = parsed(
      z.array(workoutLogListItemSchema),
      await http()
        .get('/logs')
        .set(...asUser(ALICE))
        .expect(200),
    );
    expect(history).toContainEqual(
      expect.objectContaining({
        assignmentId: assignment.id,
        name: 'Strength',
        wod: null,
        resultValue: '5/5',
      }),
    );

    // And Stats reads the same day as volume per movement (DN-22): the sets
    // as they ended up, correction included, which is what makes a strength
    // day chartable at all.
    const volume = parsed(
      z.array(movementVolumeSchema),
      await http()
        .get('/movement-volume')
        .set(...asUser(ALICE))
        .expect(200),
    );
    expect(volume).toHaveLength(1);
    expect(volume[0].sessions).toEqual([
      expect.objectContaining({ assignmentId: assignment.id, sets: [2, 3] }),
    ]);
  });
});

/**
 * The first-run wizard, end to end (DN-15).
 *
 * The whole point of this issue is that a brand-new athlete answers three
 * questions and is training, so the journey is worth having at this layer:
 * the gate the client reads, the questions the API offers, and the commit
 * that has to leave every one of those answers in place at once.
 */
describe('first-run setup, end to end', () => {
  it('walks a new athlete from un-onboarded to training their own program', async () => {
    const plan = await createPlan({
      name: 'Pull-Up Builder',
      minDaysPerWeek: 3,
      maxDaysPerWeek: 5,
      minWeeks: 4,
      maxWeeks: 8,
    });

    // The gate. A fresh athlete has answered nothing, and this is the only
    // field the client's own route guard reads.
    const before = parsed(
      meSchema,
      await http()
        .get('/me')
        .set(...asUser(ALICE))
        .expect(200),
    );
    expect(before.onboardedAt).toBeNull();

    const options = parsed(
      setupOptionsSchema,
      await http()
        .get('/setup')
        .set(...asUser(ALICE))
        .expect(200),
    );
    // Just WODs is what provisioning already put them on, so it leads the
    // picker rather than appearing as an alternative to itself.
    expect(options.programs[0].id).toBe(DEFAULT_PLAN_ID);
    expect(options.programs.map((p) => p.id)).toContain(plan.id);
    // Nothing trained yet, so this morning is still available to start on.
    expect(options.earliestStartDate).toBe(todayIsoDate());

    // An answer the program will not take, refused in its own words. This is
    // the sentence the cadence screen shows, so it is worth pinning here
    // rather than only in the unit spec.
    const refused = parsed(
      z.object({ message: z.string() }),
      await http()
        .post('/setup')
        .set(...asUser(ALICE))
        .send({
          planId: plan.id,
          trainingDays: [1, 3],
          weeks: 6,
          startDate: todayIsoDate(),
        })
        .expect(400),
    );
    expect(refused.message).toBe(
      'Pull-Up Builder needs at least 3 days a week.',
    );

    // And the refusal left them exactly where they were: still un-onboarded,
    // so they come back to the wizard rather than to a half-chosen program.
    expect(
      parsed(
        meSchema,
        await http()
          .get('/me')
          .set(...asUser(ALICE))
          .expect(200),
      ).onboardedAt,
    ).toBeNull();

    await http()
      .post('/setup')
      .set(...asUser(ALICE))
      .send({
        planId: plan.id,
        trainingDays: [1, 3, 5],
        weeks: 6,
        startDate: todayIsoDate(),
      })
      .expect(201);

    // Stamped last, and stamped: the gate now lets them through.
    expect(
      parsed(
        meSchema,
        await http()
          .get('/me')
          .set(...asUser(ALICE))
          .expect(200),
      ).onboardedAt,
    ).not.toBeNull();

    // And the days they picked are the days the app now runs on, read back
    // through the screen that owns them rather than out of the database.
    const settings = parsed(
      settingsSchema,
      await http()
        .get('/settings')
        .set(...asUser(ALICE))
        .expect(200),
    );
    expect(settings.trainingDays).toEqual([1, 3, 5]);
    // Flexible, so the athlete's own days are in effect rather than locked.
    expect(settings.scheduleLock).toBeNull();
  });

  it('locks the week to a fixed program the athlete chose', async () => {
    // The other half of the cadence screen: no day picker at all, and the
    // program's days reported back as the reason (DN-118's lock, reached
    // through the wizard).
    const fixed = await createFixedPlan([1, 2, 4, 5], {
      name: 'Bar Muscle-Up',
      minWeeks: 6,
      maxWeeks: 6,
    });

    const options = parsed(
      setupOptionsSchema,
      await http()
        .get('/setup')
        .set(...asUser(ALICE))
        .expect(200),
    );
    const program = options.programs.find((p) => p.id === fixed.id)!;
    expect(program.scheduleMode).toBe('fixed');
    expect(program.fixedDays).toEqual([1, 2, 4, 5]);

    await http()
      .post('/setup')
      .set(...asUser(ALICE))
      .send({
        planId: fixed.id,
        trainingDays: null,
        weeks: 6,
        startDate: todayIsoDate(),
      })
      .expect(201);

    const settings = parsed(
      settingsSchema,
      await http()
        .get('/settings')
        .set(...asUser(ALICE))
        .expect(200),
    );
    expect(settings.scheduleLock).toEqual({
      planId: fixed.id,
      planName: 'Bar Muscle-Up',
      days: [1, 2, 4, 5],
    });
    // Asleep, not overwritten -- this is what comes back when the run ends.
    expect(settings.trainingDays).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('a program ending, end to end', () => {
  // Alice only: Mallory never trains here, she only tries the doors, and the
  // throttle counts every request this suite makes.
  beforeEach(() => trainsEveryDay(ALICE));

  /**
   * A program that trains every day, so "is today a program day?" is decided
   * by the run's dates alone. A plan with no authored weeks resolves as
   * finished whatever the date, which would make every assertion below pass
   * for the wrong reason.
   */
  async function everyDayPlan(overrides: Record<string, unknown> = {}) {
    // Something for the Just WODs fallback to hand back once the program is
    // over -- the library is empty unless a test puts a WOD in it.
    await seedLibrary();
    return createPlan({
      weeks: {
        create: [
          {
            order: 0,
            phase: 'core',
            slots: {
              create: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
                dayOfWeek,
                kind: 'wod_generated',
              })),
            },
          },
        ],
      },
      ...overrides,
    });
  }

  /**
   * Puts the athlete on a program that ran out last week.
   *
   * Provisioning has already given them an active Just WODs enrollment, and
   * the partial unique index allows only one active run, so the way to be
   * mid-program in a test is to repoint the run they already have rather than
   * to add a second.
   */
  async function ranOutLastWeek(userId: string, planId: string) {
    const startDate = addIsoDays(todayIsoDate(), -14);
    await testPrisma().planEnrollment.updateMany({
      where: { userId, status: 'active' },
      data: { planId, startDate, weeks: 1, startingMovements: {} },
    });
    const enrollment = await testPrisma().planEnrollment.findFirstOrThrow({
      where: { userId, status: 'active' },
      select: { id: true },
    });
    await createAssignment(userId, {
      enrollmentId: enrollment.id,
      status: 'completed',
      date: startDate,
    });
    return enrollment.id;
  }

  it('hands back the card, a workout, and the finished run', async () => {
    // seedLibrary's pull group is the one the movement change is read off.
    const plan = await everyDayPlan({ name: 'Pull-Up Builder' });
    const enrollmentId = await ranOutLastWeek(ALICE, plan.id);
    const pullChoice = await testPrisma().exercise.findFirstOrThrow({
      where: { movementGroup: 'pull', isGroupDefault: false },
    });
    await testPrisma().skillLevel.create({
      data: {
        userId: ALICE,
        movementGroup: 'pull',
        exerciseId: pullChoice.id,
      },
    });

    const today = parsed(
      todayResponseSchema,
      await http()
        .get('/today')
        .set(...asUser(ALICE))
        .expect(200),
    );

    // The whole point of DN-18: a prompt never blocks a workout. The program
    // is over, the card is owed, and there is still something to train.
    expect(today.assignment).not.toBeNull();
    expect(today.plan).toBeNull();
    expect(today.completedProgram).toMatchObject({
      enrollmentId,
      planId: plan.id,
      planName: 'Pull-Up Builder',
      summary: {
        weeks: 1,
        sessions: 1,
        movementChanges: [
          expect.objectContaining({
            movementGroup: 'pull',
            toExerciseId: pullChoice.id,
            toName: pullChoice.name,
          }),
        ],
      },
    });

    // And reading today is what retired the run, so it is now on the list.
    const completed = parsed(
      z.array(completedProgramSchema),
      await http()
        .get('/programs/completed')
        .set(...asUser(ALICE))
        .expect(200),
    );
    expect(completed.map((p) => p.enrollmentId)).toEqual([enrollmentId]);

    await http()
      .post(`/programs/${enrollmentId}/dismiss`)
      .set(...asUser(ALICE))
      .expect(201);

    // Dismissed puts the prompt away, not the record.
    const after = parsed(
      todayResponseSchema,
      await http()
        .get('/today')
        .set(...asUser(ALICE))
        .expect(200),
    );
    expect(after.completedProgram).toBeNull();
    expect(after.assignment).not.toBeNull();
    expect(
      parsed(
        z.array(completedProgramSchema),
        await http()
          .get('/programs/completed')
          .set(...asUser(ALICE))
          .expect(200),
      ),
    ).toHaveLength(1);
  });

  it('runs the same program again from today', async () => {
    const plan = await everyDayPlan({ name: 'Pull-Up Builder' });
    const enrollmentId = await ranOutLastWeek(ALICE, plan.id);
    await http()
      .get('/today')
      .set(...asUser(ALICE))
      .expect(200);

    const { enrollmentId: again } = parsed(
      z.object({ enrollmentId: z.string() }),
      await http()
        .post(`/programs/${enrollmentId}/run-again`)
        .set(...asUser(ALICE))
        .expect(201),
    );

    expect(again).not.toBe(enrollmentId);
    const started = await testPrisma().planEnrollment.findUniqueOrThrow({
      where: { id: again },
    });
    expect(started).toMatchObject({
      planId: plan.id,
      weeks: 1,
      status: 'active',
      startDate: todayIsoDate(),
    });

    // Answering the prompt by doing what it asked also puts it away.
    expect(
      parsed(
        todayResponseSchema,
        await http()
          .get('/today')
          .set(...asUser(ALICE))
          .expect(200),
      ).completedProgram,
    ).toBeNull();
  });

  it('will not dismiss or re-run a program that is not yours', async () => {
    const plan = await everyDayPlan();
    const enrollmentId = await ranOutLastWeek(ALICE, plan.id);
    await http()
      .get('/today')
      .set(...asUser(ALICE))
      .expect(200);

    await http()
      .post(`/programs/${enrollmentId}/dismiss`)
      .set(...asUser(MALLORY))
      .expect(404);
    await http()
      .post(`/programs/${enrollmentId}/run-again`)
      .set(...asUser(MALLORY))
      .expect(404);
    expect(
      parsed(
        z.array(completedProgramSchema),
        await http()
          .get('/programs/completed')
          .set(...asUser(MALLORY))
          .expect(200),
      ),
    ).toEqual([]);
  });
});
