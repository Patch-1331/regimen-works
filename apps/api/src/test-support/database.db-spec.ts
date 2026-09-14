import { PrismaService } from '../prisma/prisma.service';
import { testPrisma } from './database';
import {
  createAssignment,
  createExercise,
  createLog,
  createSession,
  createUser,
  createWod,
} from './fixtures';

/**
 * Proves the plumbing, and nothing about the app (DN-99).
 *
 * If these pass, a service test can be written: there is a real Postgres with
 * the migrations applied, writes land, the fixtures compose, and each test
 * starts from an empty database.
 */

describe('the test database', () => {
  it('writes a row and reads it back', async () => {
    await testPrisma().user.create({ data: { id: 'user_round_trip' } });
    const found = await testPrisma().user.findUnique({
      where: { id: 'user_round_trip' },
    });
    expect(found?.id).toBe('user_round_trip');
  });

  it('has the migrations applied, not just an empty database', async () => {
    // A column added by a late migration — reading it proves `migrate deploy`
    // ran rather than the schema being whatever was there before.
    const user = await createUser();
    const assignment = await createAssignment(user.id);
    const session = await createSession(user.id, assignment.id);
    expect(session.autoStopAtCap).toBe(true);
    expect(session.movements).toEqual([]);
  });

  describe('isolation between tests', () => {
    // These two run in order and would both pass if the reset were broken and
    // each only counted its own row — so the second asserts the exact count.
    it('writes a user', async () => {
      await createUser('user_isolation');
      expect(await testPrisma().user.count()).toBe(1);
    });

    it('does not see the user the previous test wrote', async () => {
      expect(await testPrisma().user.count()).toBe(0);
      expect(
        await testPrisma().user.findUnique({ where: { id: 'user_isolation' } }),
      ).toBeNull();
    });
  });

  it('truncates every table, not only the ones a test touched directly', async () => {
    // Cascading deletes would hide a table missed by the truncate list, so
    // count the tables that have no foreign key pulling them down.
    const counts = await Promise.all([
      testPrisma().user.count(),
      testPrisma().exercise.count(),
      testPrisma().wod.count(),
      testPrisma().wodMovement.count(),
      testPrisma().dailyAssignment.count(),
      testPrisma().workoutSession.count(),
      testPrisma().workoutLog.count(),
      testPrisma().skillLevel.count(),
      testPrisma().scheduleRule.count(),
      testPrisma().assignmentSubstitution.count(),
    ]);
    expect(counts).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

describe('the fixtures', () => {
  it('builds a WOD with its movements and their exercises in one call', async () => {
    const wod = await createWod();
    expect(wod.movements).toHaveLength(1);
    expect(wod.movements[0].exercise.name).toMatch(/^Push-up-/);
  });

  it('takes overrides without restating the rest of the row', async () => {
    const wod = await createWod({
      type: 'amrap',
      timeCapMinutes: 20,
      rounds: null,
    });
    expect(wod.type).toBe('amrap');
    expect(wod.timeCapMinutes).toBe(20);
    // Untouched defaults survive.
    expect(wod.dominantPattern).toBe('push');
  });

  it('composes a full day: user, WOD, assignment, session, log', async () => {
    const user = await createUser();
    const assignment = await createAssignment(user.id);
    await createSession(user.id, assignment.id);
    await createLog(user.id, assignment.id, { resultValue: '420' });

    const loaded = await testPrisma().dailyAssignment.findUnique({
      where: { id: assignment.id },
      include: {
        session: true,
        log: true,
        wod: { include: { movements: true } },
      },
    });
    expect(loaded?.session?.capSeconds).toBe(720);
    expect(loaded?.log?.resultValue).toBe('420');
    expect(loaded?.wod?.movements).toHaveLength(1);
  });

  it('keeps unique columns unique across calls, so one test can build two', async () => {
    // Exercise.name is @unique; a fixed fixture name makes the second call in
    // any test a constraint violation.
    const first = await createExercise();
    const second = await createExercise();
    expect(first.name).not.toBe(second.name);
  });
});

describe('PrismaService', () => {
  it('connects to the throwaway database rather than the local development one', async () => {
    // The setup files point DATABASE_URL at the throwaway database; this is
    // the service the real Nest modules will be given.
    const service = new PrismaService();
    await service.onModuleInit();
    try {
      await service.user.create({ data: { id: 'user_via_service' } });
      expect(await testPrisma().user.count()).toBe(1);
    } finally {
      await service.onModuleDestroy();
    }
  });
});
