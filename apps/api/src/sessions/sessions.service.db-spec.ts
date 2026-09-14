import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { MovementResolutionService } from '../scheduler/movement-resolution.service';
import { testPrisma } from '../test-support/database';
import {
  createAssignment,
  createLadder,
  createSkillLevel,
  createUser,
  createWod,
} from '../test-support/fixtures';
import { SessionsService } from './sessions.service';

/**
 * The live workout: what the session records while it runs, and what it
 * refuses to record.
 *
 * Against a real database (DN-99), replacing the mocked-Prisma spec. The
 * mock covered four of the nine methods and asserted call shapes; this
 * covers all nine and asserts stored rows — including `start`'s side effect
 * on the assignment, which the mock never saw, and the DN-90 snapshot
 * through the real `MovementResolutionService` rather than a stub standing
 * in for the resolution the snapshot exists to pin down.
 */

function service(): SessionsService {
  const prisma = testPrisma() as unknown as PrismaService;
  return new SessionsService(prisma, new MovementResolutionService(prisma));
}

/** A flat For Time WOD on a pull ladder, assigned to a fresh athlete. */
async function pullDay(
  options: {
    status?: string;
    timeCapMinutes?: number;
    wod?: Record<string, unknown>;
  } = {},
) {
  const user = await createUser();
  const { rungs } = await createLadder('pull', [
    'Negative chin-up',
    'Chin-up',
    'Pull-up',
  ]);
  const wod = await createWod({
    dominantPattern: 'pull',
    timeCapMinutes: options.timeCapMinutes ?? 12,
    movements: [{ exerciseId: rungs[0].id, reps: 30, order: 0 }],
    ...options.wod,
  });
  const assignment = await createAssignment(user.id, {
    wodId: wod.id,
    ...(options.status ? { status: options.status } : {}),
  });
  return { user, rungs, wod, assignment, movement: wod.movements[0] };
}

function storedSession(assignmentId: string) {
  return testPrisma().workoutSession.findUnique({ where: { assignmentId } });
}

function storedAssignment(id: string) {
  return testPrisma().dailyAssignment.findUnique({ where: { id } });
}

/** Starts a session and backdates it, so the finish clock has a known elapsed time. */
async function startedSecondsAgo(
  userId: string,
  assignmentId: string,
  seconds: number,
) {
  const session = await service().start(userId, assignmentId);
  await testPrisma().workoutSession.update({
    where: { assignmentId },
    data: { startedAt: new Date(Date.now() - seconds * 1000) },
  });
  return session;
}

describe('SessionsService.start', () => {
  it('opens a session with the cap the WOD prescribes', async () => {
    const { user, assignment } = await pullDay({ timeCapMinutes: 20 });

    const session = await service().start(user.id, assignment.id);

    expect(session.capSeconds).toBe(1200);
    expect(session.status).toBe('in_progress');
    expect(await storedSession(assignment.id)).not.toBeNull();
  });

  it('moves the day from scheduled to in progress', async () => {
    const { user, assignment } = await pullDay();

    await service().start(user.id, assignment.id);

    // The mock never saw this: it is a write to a different table.
    expect((await storedAssignment(assignment.id))?.status).toBe('in_progress');
  });

  it('leaves a day that is already in progress where it is', async () => {
    const { user, assignment } = await pullDay({ status: 'in_progress' });

    await service().start(user.id, assignment.id);

    expect((await storedAssignment(assignment.id))?.status).toBe('in_progress');
  });

  it('is idempotent, so a double effect or a reload resumes rather than races', async () => {
    const { user, assignment } = await pullDay();

    const first = await service().start(user.id, assignment.id);
    const second = await service().start(user.id, assignment.id);

    expect(second.id).toBe(first.id);
    expect(await testPrisma().workoutSession.count()).toBe(1);
  });

  it('carries the athlete opt-out onto the session', async () => {
    const { user, assignment } = await pullDay();
    await testPrisma().scheduleRule.create({
      data: { userId: user.id, autoStopAtCapEnabled: false },
    });

    // Copied at start, like capSeconds: toggling the setting mid-workout
    // must not move where this session's clock stops.
    expect((await service().start(user.id, assignment.id)).autoStopAtCap).toBe(
      false,
    );
  });

  it('stops at the cap for an athlete with no settings row yet', async () => {
    const { user, assignment } = await pullDay();

    expect((await service().start(user.id, assignment.id)).autoStopAtCap).toBe(
      true,
    );
  });

  it('snapshots the movement the athlete actually trains, not the template (DN-90)', async () => {
    const { user, rungs, assignment } = await pullDay();
    // Their standing choice is rung 2; the WOD prescribes rung 0.
    await createSkillLevel(user.id, 'pull', 2);

    const session = await service().start(user.id, assignment.id);

    expect(session.movements).toHaveLength(1);
    expect(session.movements[0]).toMatchObject({
      exercise: { id: rungs[2].id, name: rungs[2].name, rung: 2 },
      prescribedName: rungs[0].name,
      isSwapped: false,
      reps: 30,
    });
  });

  it('marks a movement the athlete swapped today as their own choice', async () => {
    const { user, rungs, assignment, movement } = await pullDay();
    await testPrisma().assignmentSubstitution.create({
      data: {
        userId: user.id,
        assignmentId: assignment.id,
        wodMovementId: movement.id,
        exerciseId: rungs[1].id,
      },
    });

    const session = await service().start(user.id, assignment.id);

    expect(session.movements[0]).toMatchObject({
      exercise: { id: rungs[1].id },
      isSwapped: true,
      // Null on a row swapped today: they chose what they see.
      prescribedName: null,
    });
  });

  it('leaves a running session snapshot alone when a later swap lands', async () => {
    const { user, rungs, assignment, movement } = await pullDay();
    const first = await service().start(user.id, assignment.id);

    await testPrisma().assignmentSubstitution.create({
      data: {
        userId: user.id,
        assignmentId: assignment.id,
        wodMovementId: movement.id,
        exerciseId: rungs[2].id,
      },
    });
    const second = await service().start(user.id, assignment.id);

    // The snapshot says what the workout began with, not what a later swap
    // would have made it.
    expect(second.movements).toEqual(first.movements);
    expect(second.movements[0].exercise.id).toBe(rungs[0].id);
  });

  it('refuses a rest day, which has no workout to start', async () => {
    const user = await createUser();
    const assignment = await testPrisma().dailyAssignment.create({
      data: { userId: user.id, date: '2026-09-16', wodId: null },
    });

    await expect(service().start(user.id, assignment.id)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('404s on an assignment belonging to another athlete', async () => {
    const { assignment } = await pullDay();
    const mallory = await createUser();

    await expect(service().start(mallory.id, assignment.id)).rejects.toThrow(
      NotFoundException,
    );
    expect(await testPrisma().workoutSession.count()).toBe(0);
  });
});

describe('SessionsService.get', () => {
  it('is null before the workout is started', async () => {
    const { user, assignment } = await pullDay();

    expect(await service().get(user.id, assignment.id)).toBeNull();
  });

  it('returns the running session', async () => {
    const { user, assignment } = await pullDay();
    const started = await service().start(user.id, assignment.id);

    expect((await service().get(user.id, assignment.id))?.id).toBe(started.id);
  });

  it('is null for another athlete session, rather than handing it over', async () => {
    const { user, assignment } = await pullDay();
    await service().start(user.id, assignment.id);
    const mallory = await createUser();

    expect(await service().get(mallory.id, assignment.id)).toBeNull();
  });
});

describe('SessionsService.logRound', () => {
  it('records a round split', async () => {
    const { user, assignment } = await pullDay();
    await service().start(user.id, assignment.id);

    const updated = await service().logRound(user.id, assignment.id, {
      round: 1,
      atSeconds: 90,
    });

    expect(updated.roundSplits).toEqual([{ round: 1, atSeconds: 90 }]);
  });

  it('keeps the splits in round order however they arrive', async () => {
    // A locked screen can deliver taps out of sequence once it reconnects.
    const { user, assignment } = await pullDay();
    await service().start(user.id, assignment.id);

    await service().logRound(user.id, assignment.id, {
      round: 2,
      atSeconds: 200,
    });
    const updated = await service().logRound(user.id, assignment.id, {
      round: 1,
      atSeconds: 90,
    });

    expect(updated.roundSplits).toEqual([
      { round: 1, atSeconds: 90 },
      { round: 2, atSeconds: 200 },
    ]);
  });

  it('rewrites a resubmitted round rather than duplicating it', async () => {
    const { user, assignment } = await pullDay();
    await service().start(user.id, assignment.id);

    await service().logRound(user.id, assignment.id, {
      round: 1,
      atSeconds: 90,
    });
    const updated = await service().logRound(user.id, assignment.id, {
      round: 1,
      atSeconds: 95,
    });

    expect(updated.roundSplits).toEqual([{ round: 1, atSeconds: 95 }]);
  });

  it('accepts a round tapped on the cap second itself', async () => {
    const { user, assignment } = await pullDay({ timeCapMinutes: 12 });
    await service().start(user.id, assignment.id);

    const updated = await service().logRound(user.id, assignment.id, {
      round: 1,
      atSeconds: 720,
    });

    expect(updated.roundSplits).toHaveLength(1);
  });

  it('refuses a round tapped past the cap, where the clock had stopped', async () => {
    const { user, assignment } = await pullDay({ timeCapMinutes: 12 });
    await service().start(user.id, assignment.id);

    await expect(
      service().logRound(user.id, assignment.id, { round: 1, atSeconds: 721 }),
    ).rejects.toThrow(BadRequestException);
  });

  it('accepts a round past the cap when the athlete opted out of stopping', async () => {
    const { user, assignment } = await pullDay({ timeCapMinutes: 12 });
    await testPrisma().scheduleRule.create({
      data: { userId: user.id, autoStopAtCapEnabled: false },
    });
    await service().start(user.id, assignment.id);

    const updated = await service().logRound(user.id, assignment.id, {
      round: 1,
      atSeconds: 900,
    });

    expect(updated.roundSplits).toEqual([{ round: 1, atSeconds: 900 }]);
  });

  it('refuses a round on a session that is no longer running', async () => {
    const { user, assignment } = await pullDay();
    await service().start(user.id, assignment.id);
    await service().finish(user.id, assignment.id);

    await expect(
      service().logRound(user.id, assignment.id, { round: 1, atSeconds: 90 }),
    ).rejects.toThrow(BadRequestException);
  });

  it('404s when there is no session', async () => {
    const { user, assignment } = await pullDay();

    await expect(
      service().logRound(user.id, assignment.id, { round: 1, atSeconds: 90 }),
    ).rejects.toThrow(NotFoundException);
  });

  it('404s for another athlete, rather than writing to their session', async () => {
    const { user, assignment } = await pullDay();
    await service().start(user.id, assignment.id);
    const mallory = await createUser();

    await expect(
      service().logRound(mallory.id, assignment.id, {
        round: 1,
        atSeconds: 90,
      }),
    ).rejects.toThrow(NotFoundException);
    expect((await storedSession(assignment.id))?.roundSplits).toEqual([]);
  });
});

describe('SessionsService.advanceInterval', () => {
  /** A 10-minute EMOM: ten one-minute intervals, no rest. */
  async function emomDay() {
    return pullDay({
      timeCapMinutes: 10,
      wod: {
        type: 'emom',
        rounds: null,
        workSeconds: 60,
        restSeconds: 0,
        intervalCount: 10,
      },
    });
  }

  it('records where the sequence has got to', async () => {
    const { user, assignment } = await emomDay();
    await service().start(user.id, assignment.id);

    const updated = await service().advanceInterval(user.id, assignment.id, {
      intervalIndex: 1,
      atSeconds: 60,
    });

    expect(updated.intervalIndex).toBe(1);
    expect(updated.intervalStartedAtSeconds).toBe(60);
  });

  it('closes out the interval before it as a round split', async () => {
    // Which is what lets the result prefill and history read an EMOM
    // without knowing it was one.
    const { user, assignment } = await emomDay();
    await service().start(user.id, assignment.id);

    const updated = await service().advanceInterval(user.id, assignment.id, {
      intervalIndex: 2,
      atSeconds: 120,
    });

    expect(updated.roundSplits).toEqual([{ round: 2, atSeconds: 120 }]);
  });

  it('closes nothing when the first interval starts', async () => {
    const { user, assignment } = await emomDay();
    await service().start(user.id, assignment.id);

    const updated = await service().advanceInterval(user.id, assignment.id, {
      intervalIndex: 0,
      atSeconds: 0,
    });

    expect(updated.roundSplits).toEqual([]);
    expect(updated.intervalIndex).toBe(0);
  });

  it('accepts one past the last interval, the sequence-finished marker', async () => {
    const { user, assignment } = await emomDay();
    await service().start(user.id, assignment.id);

    const updated = await service().advanceInterval(user.id, assignment.id, {
      intervalIndex: 10,
      atSeconds: 600,
    });

    expect(updated.intervalIndex).toBe(10);
  });

  it('refuses an interval beyond that, which is a client bug not a state', async () => {
    const { user, assignment } = await emomDay();
    await service().start(user.id, assignment.id);

    await expect(
      service().advanceInterval(user.id, assignment.id, {
        intervalIndex: 11,
        atSeconds: 660,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuses a WOD with no interval structure', async () => {
    const { user, assignment } = await pullDay();
    await service().start(user.id, assignment.id);

    await expect(
      service().advanceInterval(user.id, assignment.id, {
        intervalIndex: 1,
        atSeconds: 60,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuses a session that is no longer running', async () => {
    const { user, assignment } = await emomDay();
    await service().start(user.id, assignment.id);
    await service().finish(user.id, assignment.id);

    await expect(
      service().advanceInterval(user.id, assignment.id, {
        intervalIndex: 1,
        atSeconds: 60,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('404s for another athlete', async () => {
    const { user, assignment } = await emomDay();
    await service().start(user.id, assignment.id);
    const mallory = await createUser();

    await expect(
      service().advanceInterval(mallory.id, assignment.id, {
        intervalIndex: 1,
        atSeconds: 60,
      }),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('SessionsService.setRoundSplit', () => {
  async function ladderDay() {
    const user = await createUser();
    const { rungs } = await createLadder('pull', ['Chin-up']);
    const wod = await createWod({
      movements: [
        { exerciseId: rungs[0].id, reps: 45, order: 0, repScheme: [21, 15, 9] },
      ],
    });
    const assignment = await createAssignment(user.id, { wodId: wod.id });
    return { user, assignment };
  }

  it('sets a split on a flat WOD', async () => {
    const { user, assignment } = await pullDay();
    await service().start(user.id, assignment.id);

    expect(
      (await service().setRoundSplit(user.id, assignment.id, 5))
        .roundSplitCount,
    ).toBe(5);
  });

  it('refuses a split on a WOD whose rep scheme already sets its rounds', async () => {
    // An even split over the ladder's total would walk the athlete through
    // 15-15-15 where the workout says 21-15-9.
    const { user, assignment } = await ladderDay();
    await service().start(user.id, assignment.id);

    await expect(
      service().setRoundSplit(user.id, assignment.id, 3),
    ).rejects.toThrow(BadRequestException);
  });

  it('still allows clearing a split on a scheme-driven WOD', async () => {
    const { user, assignment } = await ladderDay();
    await service().start(user.id, assignment.id);

    expect(
      (await service().setRoundSplit(user.id, assignment.id, null))
        .roundSplitCount,
    ).toBeNull();
  });

  it('404s for another athlete', async () => {
    const { user, assignment } = await pullDay();
    await service().start(user.id, assignment.id);
    const mallory = await createUser();

    await expect(
      service().setRoundSplit(mallory.id, assignment.id, 5),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('SessionsService.finish', () => {
  it('records the elapsed time for a finish inside the cap', async () => {
    const { user, assignment } = await pullDay({ timeCapMinutes: 12 });
    await startedSecondsAgo(user.id, assignment.id, 305);

    const finished = await service().finish(user.id, assignment.id);

    expect(finished.status).toBe('completed');
    expect(finished.finishedAtSeconds).toBeGreaterThanOrEqual(305);
    expect(finished.finishedAtSeconds).toBeLessThan(310);
  });

  it('records the cap for a finish that lands after it', async () => {
    // A locked phone or a tab woken up late scores the cap, which is where
    // the athlete's clock stopped.
    const { user, assignment } = await pullDay({ timeCapMinutes: 12 });
    await startedSecondsAgo(user.id, assignment.id, 900);

    expect(
      (await service().finish(user.id, assignment.id)).finishedAtSeconds,
    ).toBe(720);
  });

  it('records the wall clock past the cap when the athlete opted out', async () => {
    const { user, assignment } = await pullDay({ timeCapMinutes: 12 });
    await testPrisma().scheduleRule.create({
      data: { userId: user.id, autoStopAtCapEnabled: false },
    });
    await startedSecondsAgo(user.id, assignment.id, 900);

    // There was no stop to score, so the wall clock is the honest answer.
    const finished = await service().finish(user.id, assignment.id);
    expect(finished.finishedAtSeconds).toBeGreaterThanOrEqual(900);
  });

  it('leaves an already-finished session alone', async () => {
    const { user, assignment } = await pullDay({ timeCapMinutes: 12 });
    await startedSecondsAgo(user.id, assignment.id, 305);
    const first = await service().finish(user.id, assignment.id);

    const second = await service().finish(user.id, assignment.id);

    // The first stop is the real one; a second finish must not overwrite the
    // recorded time with a later one.
    expect(second.finishedAtSeconds).toBe(first.finishedAtSeconds);
  });

  it('404s for another athlete', async () => {
    const { user, assignment } = await pullDay();
    await service().start(user.id, assignment.id);
    const mallory = await createUser();

    await expect(service().finish(mallory.id, assignment.id)).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('SessionsService checklists', () => {
  it('stamps the warm-up as actually done', async () => {
    const { user, assignment } = await pullDay();
    await service().start(user.id, assignment.id);

    const updated = await service().completeWarmup(user.id, assignment.id);

    expect(updated.warmupCompletedAt).not.toBeNull();
    // The timestamp means "the warm-up was done", not "the screen was passed
    // through" — a skip leaves it null, which is what start produced.
    expect(updated.cooldownCompletedAt).toBeNull();
  });

  it('stamps the cool-down', async () => {
    const { user, assignment } = await pullDay();
    await service().start(user.id, assignment.id);

    expect(
      (await service().completeCooldown(user.id, assignment.id))
        .cooldownCompletedAt,
    ).not.toBeNull();
  });

  it('leaves both null on a session that skipped the checklists', async () => {
    const { user, assignment } = await pullDay();

    const session = await service().start(user.id, assignment.id);

    expect(session.warmupCompletedAt).toBeNull();
    expect(session.cooldownCompletedAt).toBeNull();
  });

  it('404s for another athlete', async () => {
    const { user, assignment } = await pullDay();
    await service().start(user.id, assignment.id);
    const mallory = await createUser();

    await expect(
      service().completeWarmup(mallory.id, assignment.id),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('SessionsService.cancel', () => {
  it('deletes the session and hands the day back as scheduled', async () => {
    const { user, assignment } = await pullDay();
    await service().start(user.id, assignment.id);

    await service().cancel(user.id, assignment.id);

    // Deleted rather than kept as "abandoned", so a later Start Workout tap
    // creates a clean session instead of resuming a dead one.
    expect(await storedSession(assignment.id)).toBeNull();
    expect((await storedAssignment(assignment.id))?.status).toBe('scheduled');
  });

  it('lets the athlete start again afterwards', async () => {
    const { user, assignment } = await pullDay();
    const first = await service().start(user.id, assignment.id);
    await service().cancel(user.id, assignment.id);

    const second = await service().start(user.id, assignment.id);

    expect(second.id).not.toBe(first.id);
    expect(second.status).toBe('in_progress');
  });

  it('refuses to cancel a workout that is already finished', async () => {
    const { user, assignment } = await pullDay();
    await service().start(user.id, assignment.id);
    await service().finish(user.id, assignment.id);

    await expect(service().cancel(user.id, assignment.id)).rejects.toThrow(
      BadRequestException,
    );
    expect(await storedSession(assignment.id)).not.toBeNull();
  });

  it('404s for another athlete, leaving the session intact', async () => {
    const { user, assignment } = await pullDay();
    await service().start(user.id, assignment.id);
    const mallory = await createUser();

    await expect(service().cancel(mallory.id, assignment.id)).rejects.toThrow(
      NotFoundException,
    );
    expect(await storedSession(assignment.id)).not.toBeNull();
  });
});
