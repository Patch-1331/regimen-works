import { testPrisma } from './database';
import { createGroup, createWod } from './fixtures';
import { localToday, seedE2eUser } from './seed-e2e-user';

/**
 * The seed the browser suite will open on (DN-58). Its one load-bearing
 * property is that it can be run again without a reset — a seed that stacks
 * rows every run gives a suite a different Stats page every time it is run.
 */

const TEST_USER = 'user_e2e_test';

async function catalogue() {
  const { members } = await createGroup('pull', [
    'Negative chin-up',
    'Chin-up',
    'Pull-up',
  ]);
  await createWod({
    name: 'Fran',
    dominantPattern: 'pull',
    movements: [{ exerciseId: members[0].id, reps: 30, order: 0 }],
  });
  await createWod({
    name: 'Cindy',
    type: 'amrap',
    dominantPattern: 'push',
    movements: [{ exerciseId: members[1].id, reps: 20, order: 0 }],
  });
}

describe('seedE2eUser', () => {
  it('refuses to run before the shared catalogue is seeded', async () => {
    // Otherwise it would silently produce an athlete with no workouts, and the
    // browser suite would fail somewhere far from the cause.
    await expect(
      seedE2eUser(testPrisma(), { userId: TEST_USER }),
    ).rejects.toThrow(/prisma:seed/);
  });

  it('creates the rows provisioning would, so history has something to hang off', async () => {
    await catalogue();

    await seedE2eUser(testPrisma(), { userId: TEST_USER });

    expect(
      await testPrisma().user.findUnique({ where: { id: TEST_USER } }),
    ).not.toBeNull();
    expect(
      await testPrisma().scheduleRule.findUnique({
        where: { userId: TEST_USER },
      }),
    ).not.toBeNull();
  });

  it('gives the athlete a standing choice on some lines but not all', async () => {
    // An athlete who has chosen on every group is not what a real one looks
    // like, and DN-86 made "no choice yet" the ordinary case.
    await catalogue();

    await seedE2eUser(testPrisma(), { userId: TEST_USER });

    const levels = await testPrisma().skillLevel.findMany({
      where: { userId: TEST_USER },
    });
    expect(levels.length).toBeGreaterThan(0);
    expect(levels.length).toBeLessThan(8);
  });

  it('writes a completed day with a session and a logged result', async () => {
    await catalogue();

    const { trainedDates } = await seedE2eUser(testPrisma(), {
      userId: TEST_USER,
    });

    const assignments = await testPrisma().dailyAssignment.findMany({
      where: { userId: TEST_USER },
      include: { session: true, log: true },
    });
    expect(assignments).toHaveLength(trainedDates.length);
    for (const assignment of assignments) {
      expect(assignment.status).toBe('completed');
      expect(assignment.session?.status).toBe('completed');
      expect(assignment.log?.resultValue).toEqual(expect.any(String));
    }
  });

  it('leaves today empty, so starting a workout is still testable', async () => {
    await catalogue();

    const { today } = await seedE2eUser(testPrisma(), { userId: TEST_USER });

    expect(
      await testPrisma().dailyAssignment.findUnique({
        where: { userId_date: { userId: TEST_USER, date: today } },
      }),
    ).toBeNull();
  });

  it('gives Stats both result shapes to chart', async () => {
    await catalogue();

    await seedE2eUser(testPrisma(), { userId: TEST_USER });

    const logs = await testPrisma().workoutLog.findMany({
      where: { userId: TEST_USER },
    });
    const shapes = new Set(logs.map((l) => l.resultType));
    expect(shapes).toContain('time_seconds');
    expect(shapes).toContain('rounds_reps');
  });

  it('converges rather than stacking when run again', async () => {
    // The property the whole script rests on: it sits in front of a suite that
    // runs repeatedly, without a reset between runs.
    await catalogue();
    await seedE2eUser(testPrisma(), { userId: TEST_USER });
    const first = await snapshot();

    await seedE2eUser(testPrisma(), { userId: TEST_USER });

    expect(await snapshot()).toEqual(first);
  });

  it('is stable against a shifting today when pinned', async () => {
    await catalogue();

    const a = await seedE2eUser(testPrisma(), {
      userId: TEST_USER,
      today: '2026-09-14',
    });
    const b = await seedE2eUser(testPrisma(), {
      userId: TEST_USER,
      today: '2026-09-14',
    });

    expect(b.trainedDates).toEqual(a.trainedDates);
    expect(a.trainedDates[0]).toBe('2026-09-13');
  });

  it('defaults to the local calendar date, the way the scheduler does', () => {
    // Not toISOString(): that is yesterday for part of the evening anywhere
    // ahead of UTC, which would put the seeded history one day off the app's.
    const noon = new Date(2026, 8, 14, 12, 0, 0);
    expect(localToday(noon)).toBe('2026-09-14');
    const lateEvening = new Date(2026, 8, 14, 23, 30, 0);
    expect(localToday(lateEvening)).toBe('2026-09-14');
  });
});

async function snapshot() {
  return {
    users: await testPrisma().user.count(),
    rules: await testPrisma().scheduleRule.count(),
    levels: await testPrisma().skillLevel.count(),
    assignments: await testPrisma().dailyAssignment.count(),
    sessions: await testPrisma().workoutSession.count(),
    logs: await testPrisma().workoutLog.count(),
  };
}
