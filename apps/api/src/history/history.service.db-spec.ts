import type { SessionMovement } from '@regimen-works/shared';
import type { PrismaService } from '../prisma/prisma.service';
import { testPrisma } from '../test-support/database';
import {
  createAssignment,
  createPrescribedDay,
  createExercise,
  createSession,
  createSetLog,
  createUser,
  createWod,
} from '../test-support/fixtures';
import { HistoryService } from './history.service';

/**
 * Which days count as training, and what happens to the ones that cannot be
 * read (DN-89).
 *
 * `history.logic.spec.ts` pins the shape of the answer. This is the half that
 * needs a real database: the session snapshot is a jsonb column holding rows
 * written by older versions of this app, and the rule about what to do with
 * one that no longer parses is not testable against a mock that hands back
 * whatever the test put in.
 */

function service(): HistoryService {
  return new HistoryService(testPrisma() as unknown as PrismaService);
}

function snapshot(overrides: Partial<SessionMovement> = {}): SessionMovement {
  return {
    wodMovementId: 'wm-1',
    planSlotMovementId: null,
    sets: null,
    restSeconds: null,
    order: 0,
    reps: 30,
    repsMax: null,
    toFailure: false,
    repScheme: [],
    isSwapped: false,
    prescribedName: null,
    prescribedReason: null,
    exercise: {
      id: 'chin-up',
      name: 'Chin-up',
      unit: 'reps',
      movementGroup: 'pull',
      sortOrder: 1,
    },
    ...overrides,
  };
}

/** A finished workout on a given date, snapshotted as `movements`. */
async function trainedDay(
  userId: string,
  date: string,
  options: { movements?: unknown; status?: string; wodName?: string } = {},
) {
  const wod = await createWod(options.wodName ? { name: options.wodName } : {});
  const assignment = await createAssignment(userId, {
    date,
    wodId: wod.id,
    status: 'completed',
  });
  return createSession(userId, assignment.id, {
    status: options.status ?? 'completed',
    movements: options.movements ?? [snapshot()],
  });
}

describe('HistoryService.movements', () => {
  it('reads the days the athlete actually trained', async () => {
    const user = await createUser();
    await trainedDay(user.id, '2026-09-10', { wodName: 'Cindy' });
    await trainedDay(user.id, '2026-09-14');

    const history = await service().movements(user.id);

    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      exerciseId: 'chin-up',
      sessions: 2,
      total: 60,
      firstTrained: '2026-09-10',
      lastTrained: '2026-09-14',
    });
    // Each day names the workout it came from, so the history reads as
    // training rather than as a column of numbers.
    expect(history[0].days.at(-1)!.name).toBe('Cindy');
  });

  it('leaves out a session that was never finished', async () => {
    // It records what was prescribed that day and nothing about how much of it
    // was done. Counting it would report training that may not have happened,
    // which is the one thing this screen must not do.
    const user = await createUser();
    await trainedDay(user.id, '2026-09-14', { status: 'in_progress' });
    await trainedDay(user.id, '2026-09-15', { status: 'abandoned' });

    expect(await service().movements(user.id)).toEqual([]);
  });

  it('reads one athlete history without reaching for another', async () => {
    const user = await createUser();
    const mallory = await createUser();
    await trainedDay(mallory.id, '2026-09-14');

    expect(await service().movements(user.id)).toEqual([]);
    expect(await service().movements(mallory.id)).toHaveLength(1);
  });

  it('says nothing about a session snapshotted before the column existed', async () => {
    // Empty reads as "not recorded", never as "trained no movements" — a WOD
    // always has movements, so there is no honest history to show for it.
    const user = await createUser();
    await trainedDay(user.id, '2026-09-14', { movements: [] });

    expect(await service().movements(user.id)).toEqual([]);
  });

  it('drops a snapshot it cannot read rather than failing the whole history', async () => {
    // The column is jsonb written by this app, but by older versions of it.
    // A history that throws tells the athlete nothing about the days that are
    // fine — the same quiet degrading every resolution layer does.
    const user = await createUser();
    await trainedDay(user.id, '2026-09-10', {
      movements: [{ wodMovementId: 'wm-1', order: 0 }],
    });
    await trainedDay(user.id, '2026-09-14');

    const history = await service().movements(user.id);

    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      sessions: 1,
      lastTrained: '2026-09-14',
    });
  });

  it('carries what the equipment layer replaced, and what the athlete swapped', async () => {
    const user = await createUser();
    await trainedDay(user.id, '2026-09-14', {
      movements: [
        snapshot({
          exercise: {
            id: 'row',
            name: 'Row under table',
            unit: 'reps',
            movementGroup: null,
            sortOrder: null,
          },
          prescribedName: 'Pull-up',
          prescribedReason: 'equipment',
        }),
        snapshot({ wodMovementId: 'wm-2', isSwapped: true }),
      ],
    });

    const byId = new Map(
      (await service().movements(user.id)).map((h) => [h.exerciseId, h]),
    );
    expect(byId.get('row')!.days[0]).toMatchObject({
      prescribedName: 'Pull-up',
      prescribedReason: 'equipment',
    });
    expect(byId.get('chin-up')!.days[0]).toMatchObject({
      isSwapped: true,
      prescribedName: null,
    });
  });

  it('keeps a prescribed day, and names it (DN-126)', async () => {
    // This used to be dropped for want of a WOD name, so every strength day an
    // athlete trained was absent from the one screen that claims to report
    // what they have trained.
    const user = await createUser();
    const { assignment } = await createPrescribedDay(user.id, {
      date: '2026-09-16',
    });
    await createSession(user.id, assignment.id, {
      status: 'completed',
      movements: [
        snapshot({
          wodMovementId: null,
          planSlotMovementId: 'psm-1',
          sets: 5,
          restSeconds: 90,
          reps: 3,
        }),
      ],
    });

    const history = await service().movements(user.id);

    expect(history).toHaveLength(1);
    expect(history[0].days[0]).toMatchObject({
      date: '2026-09-16',
      name: 'Strength',
      reps: 3,
    });
  });
});

/**
 * A session on `date` with `reps` recorded set by set (DN-22).
 *
 * No wod and no snapshot: what `movementVolume` reads is the set rows, and a
 * day that has them is a day it counts, whatever else is stored about it.
 */
async function recordedDay(
  userId: string,
  date: string,
  exerciseId: string,
  reps: number[],
  options: {
    status?: string;
    movementOrder?: number;
    assignmentId?: string;
  } = {},
) {
  const assignmentId =
    options.assignmentId ??
    (
      await testPrisma().dailyAssignment.create({
        data: { userId, date, status: 'completed' },
      })
    ).id;
  const session =
    (await testPrisma().workoutSession.findUnique({
      where: { assignmentId },
    })) ??
    (await createSession(userId, assignmentId, {
      status: options.status ?? 'completed',
    }));
  for (const [i, actualReps] of reps.entries()) {
    await createSetLog(userId, session.id, exerciseId, {
      movementOrder: options.movementOrder ?? 0,
      setNumber: i + 1,
      actualReps,
    });
  }
  return { assignmentId, session };
}

describe('HistoryService.movementVolume', () => {
  it('answers with the sets that were actually recorded', async () => {
    const user = await createUser();
    const exercise = await createExercise({ name: 'Chin-up' });
    const { assignmentId } = await recordedDay(
      user.id,
      '2026-09-14',
      exercise.id,
      [3, 3, 2],
    );

    const volume = await service().movementVolume(user.id);

    expect(volume).toEqual([
      {
        exerciseId: exercise.id,
        name: 'Chin-up',
        unit: 'reps',
        sessions: [
          {
            date: '2026-09-14',
            assignmentId,
            sets: [3, 3, 2],
          },
        ],
      },
    ]);
  });

  it('reads what was done, not what was prescribed', async () => {
    // The whole reason this does not come from the session snapshot: the
    // snapshot says 3 reps five times, and the athlete made 3, 3, 2.
    const user = await createUser();
    const exercise = await createExercise();
    await recordedDay(user.id, '2026-09-14', exercise.id, [3, 3, 2]);

    const [volume] = await service().movementVolume(user.id);

    expect(volume.sessions[0].sets).toEqual([3, 3, 2]);
  });

  it('reads a movement across the sessions it was trained in, newest first', async () => {
    const user = await createUser();
    const exercise = await createExercise();
    await recordedDay(user.id, '2026-09-07', exercise.id, [3, 3, 2]);
    await recordedDay(user.id, '2026-09-14', exercise.id, [3, 3, 3]);

    const [volume] = await service().movementVolume(user.id);

    expect(volume.sessions.map((s) => [s.date, s.sets])).toEqual([
      ['2026-09-14', [3, 3, 3]],
      ['2026-09-07', [3, 3, 2]],
    ]);
  });

  it('counts a movement prescribed twice in a day as one session', async () => {
    const user = await createUser();
    const exercise = await createExercise();
    const { assignmentId } = await recordedDay(
      user.id,
      '2026-09-14',
      exercise.id,
      [3, 3],
    );
    await recordedDay(user.id, '2026-09-14', exercise.id, [2, 2], {
      assignmentId,
      movementOrder: 1,
    });

    const [volume] = await service().movementVolume(user.id);

    expect(volume.sessions).toHaveLength(1);
    expect(volume.sessions[0].sets).toEqual([3, 3, 2, 2]);
  });

  it('counts a session that is still running', async () => {
    // The rows are sets that were done. Waiting for the finish tap would leave
    // the athlete looking at a chart that is missing the session they are in.
    const user = await createUser();
    const exercise = await createExercise();
    await recordedDay(user.id, '2026-09-14', exercise.id, [3, 3], {
      status: 'active',
    });

    const [volume] = await service().movementVolume(user.id);

    expect(volume.sessions[0].sets).toEqual([3, 3]);
  });

  it("does not read another athlete's sets", async () => {
    const user = await createUser();
    const other = await createUser();
    const exercise = await createExercise();
    await recordedDay(other.id, '2026-09-14', exercise.id, [3, 3]);

    expect(await service().movementVolume(user.id)).toEqual([]);
  });

  it('answers nothing for an athlete who has recorded no sets', async () => {
    const user = await createUser();
    await trainedDay(user.id, '2026-09-14');

    expect(await service().movementVolume(user.id)).toEqual([]);
  });

  it('does not let sessions that recorded nothing crowd out the ones that did', async () => {
    // The bound counts sessions, so a run of WOD days -- which record no sets
    // -- would fill it and push the strength days the athlete is asking about
    // out of the answer entirely.
    const user = await createUser();
    const exercise = await createExercise();
    await recordedDay(user.id, '2026-01-01', exercise.id, [3, 3, 2]);
    const dates = Array.from({ length: 200 }, (_, i) =>
      new Date(Date.UTC(2026, 1, 1) + i * 86_400_000)
        .toISOString()
        .slice(0, 10),
    );
    await testPrisma().dailyAssignment.createMany({
      data: dates.map((date) => ({
        userId: user.id,
        date,
        status: 'completed',
      })),
    });
    const empty = await testPrisma().dailyAssignment.findMany({
      where: { userId: user.id, date: { in: dates } },
    });
    await testPrisma().workoutSession.createMany({
      data: empty.map((a) => ({
        userId: user.id,
        assignmentId: a.id,
        capSeconds: 720,
        status: 'completed',
      })),
    });

    const [volume] = await service().movementVolume(user.id);

    expect(volume.sessions.map((s) => s.date)).toEqual(['2026-01-01']);
  });

  it('bounds the answer by session, so the oldest one it reads is whole', async () => {
    // Bounded by sessions rather than by rows: a limit on set rows would cut
    // the oldest session off mid-way and report a day that stopped early.
    const user = await createUser();
    const exercise = await createExercise();
    const dates = Array.from({ length: 201 }, (_, i) =>
      new Date(Date.UTC(2026, 0, 1) + i * 86_400_000)
        .toISOString()
        .slice(0, 10),
    );
    await testPrisma().dailyAssignment.createMany({
      data: dates.map((date) => ({
        userId: user.id,
        date,
        status: 'completed',
      })),
    });
    const assignments = await testPrisma().dailyAssignment.findMany({
      where: { userId: user.id },
      orderBy: { date: 'asc' },
    });
    await testPrisma().workoutSession.createMany({
      data: assignments.map((a) => ({
        userId: user.id,
        assignmentId: a.id,
        capSeconds: 720,
        status: 'completed',
      })),
    });
    const sessions = await testPrisma().workoutSession.findMany({
      where: { userId: user.id },
    });
    await testPrisma().workoutSetLog.createMany({
      data: sessions.flatMap((session) =>
        [3, 3, 2].map((actualReps, i) => ({
          userId: user.id,
          sessionId: session.id,
          exerciseId: exercise.id,
          movementOrder: 0,
          setNumber: i + 1,
          prescribedReps: 3,
          actualReps,
        })),
      ),
    });

    const [volume] = await service().movementVolume(user.id);

    expect(volume.sessions).toHaveLength(200);
    expect(volume.sessions[0].date).toEqual(dates[dates.length - 1]);
    // Whole, not truncated: the last session in range keeps all three sets.
    expect(volume.sessions[199].sets).toEqual([3, 3, 2]);
  });
});
