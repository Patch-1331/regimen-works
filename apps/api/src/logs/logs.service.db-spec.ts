import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { testPrisma } from '../test-support/database';
import {
  createAssignment,
  createLog,
  createUser,
  createWod,
} from '../test-support/fixtures';
import { LogsService } from './logs.service';

/**
 * What the athlete's result is stored as, and what the history reads back.
 *
 * Against a real database (DN-99, DN-106). The three methods here were reached
 * only incidentally before, through `app.e2e-spec.ts`, and everything worth
 * getting wrong in them is a property of the query rather than of the code
 * around it: which rows another athlete can see, what order history comes back
 * in, and which rows are dropped on the way out.
 */

function service(): LogsService {
  return new LogsService(testPrisma() as unknown as PrismaService);
}

const RESULT = { resultType: 'time_seconds' as const, resultValue: '305' };

function storedLog(assignmentId: string) {
  return testPrisma().workoutLog.findUnique({ where: { assignmentId } });
}

function storedAssignment(id: string) {
  return testPrisma().dailyAssignment.findUnique({ where: { id } });
}

/** A rest day: an assignment with no WOD on it, which `createAssignment` cannot make. */
async function createRestDay(userId: string, date = '2026-09-16') {
  return testPrisma().dailyAssignment.create({
    data: { userId, date, wodId: null, status: 'scheduled' },
  });
}

describe('LogsService.upsert', () => {
  it('stores the result and completes the day', async () => {
    const user = await createUser();
    const assignment = await createAssignment(user.id);

    const log = await service().upsert(user.id, assignment.id, RESULT);

    expect(log).toMatchObject({
      assignmentId: assignment.id,
      resultType: 'time_seconds',
      resultValue: '305',
      rpe: null,
      notes: null,
    });
    // The write to the other table, which is the half a returned DTO cannot show.
    expect((await storedAssignment(assignment.id))?.status).toBe('completed');
  });

  it('keeps rpe and notes when they are given', async () => {
    const user = await createUser();
    const assignment = await createAssignment(user.id);

    const log = await service().upsert(user.id, assignment.id, {
      ...RESULT,
      rpe: 8,
      notes: 'Broke the last set.',
    });

    expect(log).toMatchObject({ rpe: 8, notes: 'Broke the last set.' });
  });

  it('replaces an earlier result rather than stacking a second row', async () => {
    const user = await createUser();
    const assignment = await createAssignment(user.id);
    await service().upsert(user.id, assignment.id, {
      ...RESULT,
      rpe: 8,
      notes: 'Broke the last set.',
    });

    const corrected = await service().upsert(user.id, assignment.id, {
      resultType: 'rounds_reps',
      resultValue: '12+4',
    });

    expect(corrected).toMatchObject({
      resultType: 'rounds_reps',
      resultValue: '12+4',
      // Omitted fields are cleared, not left behind: the correction is the
      // whole result, so a stale RPE from the first save would be a reading
      // the athlete never gave.
      rpe: null,
      notes: null,
    });
    expect(await testPrisma().workoutLog.count()).toBe(1);
  });

  it('logs a day that is already completed without complaint', async () => {
    const user = await createUser();
    const assignment = await createAssignment(user.id, { status: 'completed' });

    await service().upsert(user.id, assignment.id, RESULT);

    expect((await storedAssignment(assignment.id))?.status).toBe('completed');
  });

  it("reads another athlete's assignment as not found", async () => {
    // Scoping, not authorisation: an unscoped findUnique here would let one
    // athlete overwrite another's result through a guessed id.
    const owner = await createUser();
    const stranger = await createUser();
    const assignment = await createAssignment(owner.id);

    await expect(
      service().upsert(stranger.id, assignment.id, RESULT),
    ).rejects.toThrow(NotFoundException);
    expect(await storedLog(assignment.id)).toBeNull();
  });

  it('refuses an assignment id that does not exist', async () => {
    const user = await createUser();

    await expect(
      service().upsert(user.id, 'no-such-assignment', RESULT),
    ).rejects.toThrow(NotFoundException);
  });

  it('refuses to log a rest day', async () => {
    const user = await createUser();
    const restDay = await createRestDay(user.id);

    await expect(service().upsert(user.id, restDay.id, RESULT)).rejects.toThrow(
      BadRequestException,
    );
    expect((await storedAssignment(restDay.id))?.status).toBe('scheduled');
  });
});

describe('LogsService.getForAssignment', () => {
  it('reads back the stored result', async () => {
    const user = await createUser();
    const assignment = await createAssignment(user.id);
    const stored = await createLog(user.id, assignment.id, {
      rpe: 7,
      notes: 'Steady.',
    });

    expect(await service().getForAssignment(user.id, assignment.id)).toEqual({
      id: stored.id,
      assignmentId: assignment.id,
      resultType: 'time_seconds',
      resultValue: '305',
      rpe: 7,
      notes: 'Steady.',
    });
  });

  it('answers null for a day with no result yet', async () => {
    const user = await createUser();
    const assignment = await createAssignment(user.id);

    expect(await service().getForAssignment(user.id, assignment.id)).toBeNull();
  });

  it("answers null rather than another athlete's result", async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const assignment = await createAssignment(owner.id);
    await createLog(owner.id, assignment.id);

    expect(
      await service().getForAssignment(stranger.id, assignment.id),
    ).toBeNull();
  });
});

describe('LogsService.list', () => {
  it('returns history newest first', async () => {
    const user = await createUser();
    for (const date of ['2026-09-10', '2026-09-12', '2026-09-11']) {
      const assignment = await createAssignment(user.id, { date });
      await createLog(user.id, assignment.id, { resultValue: date });
    }

    expect((await service().list(user.id)).map((row) => row.date)).toEqual([
      '2026-09-12',
      '2026-09-11',
      '2026-09-10',
    ]);
  });

  it('carries the WOD across, so history reads as workouts rather than ids', async () => {
    const user = await createUser();
    const wod = await createWod({
      name: 'Cindy',
      type: 'amrap',
      dominantPattern: 'pull',
    });
    const assignment = await createAssignment(user.id, { wodId: wod.id });
    const stored = await createLog(user.id, assignment.id, {
      resultType: 'rounds_reps',
      resultValue: '12+4',
      rpe: 9,
      notes: 'Grip went.',
    });

    expect(await service().list(user.id)).toEqual([
      {
        id: stored.id,
        assignmentId: assignment.id,
        date: assignment.date,
        wodName: 'Cindy',
        wodType: 'amrap',
        dominantPattern: 'pull',
        resultType: 'rounds_reps',
        resultValue: '12+4',
        rpe: 9,
        notes: 'Grip went.',
      },
    ]);
  });

  it('shows the athlete only their own history', async () => {
    const user = await createUser();
    const stranger = await createUser();
    const mine = await createAssignment(user.id, { date: '2026-09-10' });
    const theirs = await createAssignment(stranger.id, { date: '2026-09-11' });
    await createLog(user.id, mine.id);
    await createLog(stranger.id, theirs.id);

    expect(
      (await service().list(user.id)).map((row) => row.assignmentId),
    ).toEqual([mine.id]);
  });

  it('drops a log whose day has no WOD', async () => {
    // The one piece of real logic in the file. Nothing creates this pair
    // today -- `upsert` refuses a rest day -- but the list types the WOD as
    // present, so the row has to be filtered rather than read as undefined
    // and rendered as a nameless workout.
    const user = await createUser();
    const restDay = await createRestDay(user.id, '2026-09-11');
    await createLog(user.id, restDay.id);
    const real = await createAssignment(user.id, { date: '2026-09-10' });
    await createLog(user.id, real.id);

    expect(
      (await service().list(user.id)).map((row) => row.assignmentId),
    ).toEqual([real.id]);
  });

  it('is empty for an athlete who has not trained', async () => {
    const user = await createUser();

    expect(await service().list(user.id)).toEqual([]);
  });
});
