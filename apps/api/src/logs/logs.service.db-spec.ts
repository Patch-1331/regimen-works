import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { testPrisma } from '../test-support/database';
import {
  createAssignment,
  createLog,
  createPrescribedDay,
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

  it('stores a straight-sets result on a prescribed day (DN-126)', async () => {
    const user = await createUser();
    const { assignment } = await createPrescribedDay(user.id);

    const log = await service().upsert(user.id, assignment.id, {
      resultType: 'sets_completed',
      resultValue: '5/5',
      rpe: 8,
    });

    expect(log).toMatchObject({
      resultType: 'sets_completed',
      resultValue: '5/5',
      rpe: 8,
    });
    expect((await storedAssignment(assignment.id))?.status).toBe('completed');
  });

  it('stores a session the athlete cut short', async () => {
    // The whole point of carrying both halves: three of five is a real day
    // and a record worth keeping, not a failure to be refused.
    const user = await createUser();
    const { assignment } = await createPrescribedDay(user.id);

    const log = await service().upsert(user.id, assignment.id, {
      resultType: 'sets_completed',
      resultValue: '3/5',
    });

    expect(log.resultValue).toBe('3/5');
  });

  it('counts the sets across every prescribed movement', async () => {
    const user = await createUser();
    const { assignment } = await createPrescribedDay(user.id, { sets: [5, 3] });

    const log = await service().upsert(user.id, assignment.id, {
      resultType: 'sets_completed',
      resultValue: '8/8',
    });

    expect(log.resultValue).toBe('8/8');
  });

  it('refuses a total that is not what the day prescribed', async () => {
    // Both halves come from the client, so the denominator is checked rather
    // than believed -- otherwise a log can claim eight sets of a five-set day
    // and every later reading measures against a number nobody asked for.
    const user = await createUser();
    const { assignment } = await createPrescribedDay(user.id, { sets: [5] });

    await expect(
      service().upsert(user.id, assignment.id, {
        resultType: 'sets_completed',
        resultValue: '5/8',
      }),
    ).rejects.toThrow('This day prescribes 5 sets, not 8');
    expect((await storedAssignment(assignment.id))?.status).toBe('scheduled');
  });

  it('refuses a result value that is not a sets result at all', async () => {
    const user = await createUser();
    const { assignment } = await createPrescribedDay(user.id);

    await expect(
      service().upsert(user.id, assignment.id, {
        resultType: 'sets_completed',
        resultValue: '12+4',
      }),
    ).rejects.toThrow('A sets result reads "done/total"');
  });

  it('refuses a clock result on a prescribed day', async () => {
    const user = await createUser();
    const { assignment } = await createPrescribedDay(user.id);

    await expect(
      service().upsert(user.id, assignment.id, RESULT),
    ).rejects.toThrow('A prescribed day is scored in sets');
  });

  it('refuses a sets result on a WOD day', async () => {
    // The guard in the other direction. Without it a metcon files as a
    // strength session everywhere downstream.
    const user = await createUser();
    const assignment = await createAssignment(user.id);

    await expect(
      service().upsert(user.id, assignment.id, {
        resultType: 'sets_completed',
        resultValue: '5/5',
      }),
    ).rejects.toThrow('A WOD is scored against the clock');
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
        name: 'Cindy',
        wod: { type: 'amrap', dominantPattern: 'pull' },
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

  it('keeps a prescribed day, which has a name and no WOD (DN-126)', async () => {
    // This used to be dropped, and dropping it was the worse half of a
    // half-built feature: the athlete saved a result and History showed them
    // nothing, which reads as the app having lost it.
    const user = await createUser();
    const { assignment } = await createPrescribedDay(user.id, {
      date: '2026-09-11',
    });
    await service().upsert(user.id, assignment.id, {
      resultType: 'sets_completed',
      resultValue: '4/5',
      rpe: 8,
    });

    expect(await service().list(user.id)).toMatchObject([
      {
        assignmentId: assignment.id,
        name: 'Strength',
        wod: null,
        resultType: 'sets_completed',
        resultValue: '4/5',
        rpe: 8,
      },
    ]);
  });

  it('lists both kinds of day together, newest first', async () => {
    // The two shapes share one list, so a client reading it gets them
    // interleaved by date rather than in two blocks.
    const user = await createUser();
    const wodDay = await createAssignment(user.id, { date: '2026-09-10' });
    await createLog(user.id, wodDay.id);
    const { assignment: strengthDay } = await createPrescribedDay(user.id, {
      date: '2026-09-11',
    });
    await service().upsert(user.id, strengthDay.id, {
      resultType: 'sets_completed',
      resultValue: '5/5',
    });

    expect(
      (await service().list(user.id)).map((row) => row.wod !== null),
    ).toEqual([false, true]);
  });

  it('is empty for an athlete who has not trained', async () => {
    const user = await createUser();

    expect(await service().list(user.id)).toEqual([]);
  });
});
