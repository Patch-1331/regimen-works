import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { MovementResolutionService } from '../scheduler/movement-resolution.service';
import { testPrisma, withSeparateConnections } from '../test-support/database';
import {
  createAssignment,
  createExercise,
  createGroup,
  createPlan,
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

function service(client: PrismaClient = testPrisma()): SessionsService {
  const prisma = client as unknown as PrismaService;
  return new SessionsService(prisma, new MovementResolutionService(prisma));
}

/** A flat For Time WOD on the pull group, assigned to a fresh athlete. */
async function pullDay(
  options: {
    status?: string;
    timeCapMinutes?: number;
    wod?: Record<string, unknown>;
  } = {},
) {
  const user = await createUser();
  const { members } = await createGroup('pull', [
    'Negative chin-up',
    'Chin-up',
    'Pull-up',
  ]);
  const wod = await createWod({
    dominantPattern: 'pull',
    timeCapMinutes: options.timeCapMinutes ?? 12,
    movements: [{ exerciseId: members[0].id, reps: 30, order: 0 }],
    ...options.wod,
  });
  const assignment = await createAssignment(user.id, {
    wodId: wod.id,
    ...(options.status ? { status: options.status } : {}),
  });
  return { user, members, wod, assignment, movement: wod.movements[0] };
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

  it('survives starts arriving together on separate connections', async () => {
    // The test above cannot catch this: both its calls go through the one
    // shared client, so they serialise on its connection. Two HTTP requests
    // do not (DN-105) -- two tabs, a retry, a reconnect -- and the upsert this
    // replaced compiled to SELECT-then-INSERT, so all four found nothing and
    // all four inserted.
    const { user, assignment } = await pullDay();

    const outcomes = await withSeparateConnections(4, (clients) =>
      Promise.allSettled(
        clients.map((client) => service(client).start(user.id, assignment.id)),
      ),
    );

    const rejected = outcomes.filter((o) => o.status === 'rejected');
    expect(rejected.map((o) => String(o.reason))).toEqual([]);
    // Every caller gets the one session, not four rows and three 500s.
    const ids = outcomes.flatMap((o) =>
      o.status === 'fulfilled' ? [o.value.id] : [],
    );
    expect(new Set(ids).size).toBe(1);
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
    const { user, members, assignment } = await pullDay();
    // Their standing choice is the third member; the WOD prescribes the first.
    await createSkillLevel(user.id, 'pull', members[2].id);

    const session = await service().start(user.id, assignment.id);

    expect(session.movements).toHaveLength(1);
    expect(session.movements[0]).toMatchObject({
      exercise: { id: members[2].id, name: members[2].name, sortOrder: 2 },
      prescribedName: members[0].name,
      isSwapped: false,
      reps: 30,
    });
  });

  it('marks a movement the athlete swapped today as their own choice', async () => {
    const { user, members, assignment, movement } = await pullDay();
    await testPrisma().assignmentSubstitution.create({
      data: {
        userId: user.id,
        assignmentId: assignment.id,
        wodMovementId: movement.id,
        exerciseId: members[1].id,
      },
    });

    const session = await service().start(user.id, assignment.id);

    expect(session.movements[0]).toMatchObject({
      exercise: { id: members[1].id },
      isSwapped: true,
      // Null because nothing replaced it before they swapped -- no standing
      // choice, no equipment fallback. A swap on its own does not erase the
      // prescription any more; see the case below (DN-116).
      prescribedName: null,
    });
  });

  /**
   * The day both layers moved the same row (DN-116).
   *
   * Equipment resolution runs before the swap, so until this was recorded the
   * fallback underneath left no trace anywhere: the plate stayed quiet by
   * design, and the snapshot -- the only thing that outlives the day -- copied
   * that silence. A session is written once, so what it fails to record is
   * gone for good.
   */
  async function barlessDaySwappedAway() {
    const user = await createUser();
    const floor = await createExercise({
      name: 'Supermans',
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
      fallbackExerciseId: floor.id,
    });
    const ringRow = await createExercise({
      name: 'Ring row',
      pattern: 'pull',
      movementGroup: 'pull',
      sortOrder: 1,
    });
    const wod = await createWod({
      dominantPattern: 'pull',
      movements: [{ exerciseId: pullUp.id, reps: 30, order: 0 }],
    });
    const assignment = await createAssignment(user.id, { wodId: wod.id });
    // Owns nothing, so the pull-up falls to the floor movement...
    await testPrisma().scheduleRule.create({
      data: { userId: user.id, equipment: [] },
    });
    // ...and then they swap into the ring row themselves.
    await testPrisma().assignmentSubstitution.create({
      data: {
        userId: user.id,
        assignmentId: assignment.id,
        wodMovementId: wod.movements[0].id,
        exerciseId: ringRow.id,
      },
    });
    return { user, assignment, ringRow, pullUp };
  }

  it('records the equipment fallback a same-day swap used to hide', async () => {
    const { user, assignment, ringRow, pullUp } = await barlessDaySwappedAway();

    const session = await service().start(user.id, assignment.id);

    expect(session.movements[0]).toMatchObject({
      exercise: { id: ringRow.id },
      // Both facts, which are not the same fact: the app stood down from a
      // movement they own no bar for, and then they chose this instead.
      isSwapped: true,
      prescribedName: pullUp.name,
      prescribedReason: 'equipment',
    });
  });

  it('leaves a running session snapshot alone when a later swap lands', async () => {
    const { user, members, assignment, movement } = await pullDay();
    const first = await service().start(user.id, assignment.id);

    await testPrisma().assignmentSubstitution.create({
      data: {
        userId: user.id,
        assignmentId: assignment.id,
        wodMovementId: movement.id,
        exerciseId: members[2].id,
      },
    });
    const second = await service().start(user.id, assignment.id);

    // The snapshot says what the workout began with, not what a later swap
    // would have made it.
    expect(second.movements).toEqual(first.movements);
    expect(second.movements[0].exercise.id).toBe(members[0].id);
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
  async function groupDay() {
    const user = await createUser();
    const { members } = await createGroup('pull', ['Chin-up']);
    const wod = await createWod({
      movements: [
        {
          exerciseId: members[0].id,
          reps: 45,
          order: 0,
          repScheme: [21, 15, 9],
        },
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
    const { user, assignment } = await groupDay();
    await service().start(user.id, assignment.id);

    await expect(
      service().setRoundSplit(user.id, assignment.id, 3),
    ).rejects.toThrow(BadRequestException);
  });

  it('still allows clearing a split on a scheme-driven WOD', async () => {
    const { user, assignment } = await groupDay();
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

/**
 * A prescribed day (DN-20): a program slot authoring two movements, and an
 * assignment pointing at it with no WOD anywhere.
 *
 * Two movements rather than one, because the interesting arithmetic is what
 * happens when a movement's sets run out — a single movement would let a
 * broken roll-over pass.
 */
async function prescribedDay(options: { kind?: string } = {}) {
  const user = await createUser();
  const { members } = await createGroup('pull', [
    'Negative chin-up',
    'Chin-up',
    'Pull-up',
  ]);
  const push = await createExercise({ name: 'Push-up', pattern: 'push' });
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
                kind: options.kind ?? 'movements',
                movements: {
                  create: [
                    {
                      order: 0,
                      movementGroup: 'pull',
                      sets: 5,
                      reps: 3,
                      restSeconds: 90,
                    },
                    {
                      order: 1,
                      exerciseId: push.id,
                      sets: 3,
                      reps: 8,
                      restSeconds: 60,
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
    include: { movements: { orderBy: { order: 'asc' } } },
  });
  const assignment = await testPrisma().dailyAssignment.create({
    data: {
      userId: user.id,
      date: '2026-09-16',
      status: 'scheduled',
      planSlotId: slot.id,
    },
  });
  return { user, members, assignment, slot, movements: slot.movements };
}

/**
 * Starting and running a straight-sets session (DN-20).
 *
 * The other two runners are clock-shaped and this one is not, so what these
 * say is that the session still records the same kind of thing: what was
 * trained, pinned down when it started, and where the athlete has got to,
 * written on every set so a locked phone resumes rather than restarts.
 */
describe('SessionsService, on a prescribed day', () => {
  it('starts a session with no cap, because the day is untimed', async () => {
    const { user, assignment } = await prescribedDay();

    const session = await service().start(user.id, assignment.id);

    // Null rather than 0: a zero cap is one that has already been reached,
    // and every finish would then report itself as stopped by the clock.
    expect(session.capSeconds).toBeNull();
    expect(session.status).toBe('in_progress');
  });

  it('leaves the auto-stop off, having no clock for it to stop', async () => {
    const { user, assignment } = await prescribedDay();
    await testPrisma().scheduleRule.create({
      data: { userId: user.id, autoStopAtCapEnabled: true },
    });

    expect((await service().start(user.id, assignment.id)).autoStopAtCap).toBe(
      false,
    );
  });

  it('opens on set one rather than on no set at all', async () => {
    const { user, assignment } = await prescribedDay();

    // 0 and null are different facts: the first says the athlete is on set
    // one of a straight-sets session, the second that this is not one.
    expect((await service().start(user.id, assignment.id)).setsCompleted).toBe(
      0,
    );
  });

  it('snapshots the prescription the athlete is about to train', async () => {
    const { user, assignment, movements } = await prescribedDay();

    const session = await service().start(user.id, assignment.id);

    expect(session.movements).toHaveLength(2);
    expect(session.movements[0]).toMatchObject({
      planSlotMovementId: movements[0].id,
      wodMovementId: null,
      sets: 5,
      reps: 3,
      restSeconds: 90,
    });
  });

  it("resolves the group to the athlete's own choice, as the plate did", async () => {
    const { user, members, assignment } = await prescribedDay();
    await createSkillLevel(user.id, 'pull', members[2].id);

    const session = await service().start(user.id, assignment.id);

    // The whole reason the snapshot exists: the choice keeps moving afterwards,
    // so a day re-read through today's level would describe today.
    expect(session.movements[0].exercise.id).toBe(members[2].id);
  });

  it('moves the day from scheduled to in progress, as a WOD day does', async () => {
    const { user, assignment } = await prescribedDay();

    await service().start(user.id, assignment.id);

    expect((await storedAssignment(assignment.id))?.status).toBe('in_progress');
  });

  it('refuses a slot that prescribes nothing, which is a rest day', async () => {
    // A slot the athlete's own schedule turned into a rest day still carries
    // its authored movements, so the kind is what decides -- the same two
    // checks `resolveProgramDay` makes before calling a day prescribed.
    const { user, assignment } = await prescribedDay({ kind: 'rest' });

    await expect(service().start(user.id, assignment.id)).rejects.toThrow(
      BadRequestException,
    );
  });
});

describe('SessionsService.logSet', () => {
  /** A started straight-sets session, ready to record sets against. */
  async function running() {
    const day = await prescribedDay();
    const session = await service().start(day.user.id, day.assignment.id);
    return { ...day, session };
  }

  it('records the set and when the rest after it began', async () => {
    const { user, assignment } = await running();

    const updated = await service().logSet(user.id, assignment.id, {
      setsCompleted: 1,
      restStartedAtSeconds: 42,
    });

    expect(updated.setsCompleted).toBe(1);
    expect(updated.restStartedAtSeconds).toBe(42);
  });

  it('rewrites rather than counts twice when a tap is replayed', async () => {
    const { user, assignment } = await running();

    await service().logSet(user.id, assignment.id, {
      setsCompleted: 3,
      restStartedAtSeconds: 100,
    });
    // The same tap arriving again after a flaky connection. An increment
    // would put the athlete on set five having done three.
    const replayed = await service().logSet(user.id, assignment.id, {
      setsCompleted: 3,
      restStartedAtSeconds: 100,
    });

    expect(replayed.setsCompleted).toBe(3);
  });

  it('never moves the athlete back onto a set they have done', async () => {
    const { user, assignment } = await running();

    await service().logSet(user.id, assignment.id, {
      setsCompleted: 4,
      restStartedAtSeconds: 200,
    });
    // Two taps racing on a reconnect can land out of order.
    const late = await service().logSet(user.id, assignment.id, {
      setsCompleted: 2,
      restStartedAtSeconds: 90,
    });

    expect(late.setsCompleted).toBe(4);
  });

  it('clears the rest when the next set starts', async () => {
    const { user, assignment } = await running();

    await service().logSet(user.id, assignment.id, {
      setsCompleted: 1,
      restStartedAtSeconds: 42,
    });
    const working = await service().logSet(user.id, assignment.id, {
      setsCompleted: 2,
      restStartedAtSeconds: null,
    });

    expect(working.restStartedAtSeconds).toBeNull();
  });

  it('takes the last set of the session', async () => {
    // 5 + 3 sets, so 8 is the end of the day rather than past it.
    const { user, assignment } = await running();

    expect(
      (
        await service().logSet(user.id, assignment.id, {
          setsCompleted: 8,
          restStartedAtSeconds: null,
        })
      ).setsCompleted,
    ).toBe(8);
  });

  it('refuses a set past the end of the session', async () => {
    const { user, assignment } = await running();

    // Counted against the session's own snapshot, which is what the number
    // indexes into -- the same refusal advanceInterval makes past a sequence.
    await expect(
      service().logSet(user.id, assignment.id, {
        setsCompleted: 9,
        restStartedAtSeconds: null,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuses a WOD session, which has rounds rather than sets', async () => {
    const { user, assignment } = await pullDay();
    await service().start(user.id, assignment.id);

    // Zero, and the message asserted, because both guards would refuse a 1: a
    // WOD's snapshot prescribes no sets, so `Set 1 is past the end` fires
    // first and the test would pass without the guard it is named after.
    await expect(
      service().logSet(user.id, assignment.id, {
        setsCompleted: 0,
        restStartedAtSeconds: null,
      }),
    ).rejects.toThrow('This session has no sets to log');
  });

  it('refuses a session that is no longer running', async () => {
    const { user, assignment } = await running();
    await service().finish(user.id, assignment.id);

    await expect(
      service().logSet(user.id, assignment.id, {
        setsCompleted: 1,
        restStartedAtSeconds: null,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it("reads another athlete's session as not found", async () => {
    const { assignment } = await running();
    const stranger = await createUser();

    await expect(
      service().logSet(stranger.id, assignment.id, {
        setsCompleted: 1,
        restStartedAtSeconds: null,
      }),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('SessionsService.logSet, the rows it writes (DN-21)', () => {
  /** A started straight-sets session: 5 x 3 on the pull group, then 3 x 8 push-ups. */
  async function running() {
    const day = await prescribedDay();
    const session = await service().start(day.user.id, day.assignment.id);
    return { ...day, session };
  }

  function storedSetLogs(sessionId: string) {
    return testPrisma().workoutSetLog.findMany({
      where: { sessionId },
      orderBy: [{ movementOrder: 'asc' }, { setNumber: 'asc' }],
    });
  }

  it('writes the set it finished, against what the snapshot prescribed', async () => {
    const { user, assignment, session } = await running();

    await service().logSet(user.id, assignment.id, {
      setsCompleted: 1,
      restStartedAtSeconds: 90,
    });

    expect(await storedSetLogs(session.id)).toMatchObject([
      {
        movementOrder: 0,
        setNumber: 1,
        // Read off the session's own snapshot rather than sent: a client that
        // reported its own reading of the prescription could disagree with
        // the server about what the day asked for.
        exerciseId: session.movements[0].exercise.id,
        prescribedReps: 3,
        actualReps: 3,
      },
    ]);
  });

  it('crosses into the next movement, carrying its own prescription', async () => {
    const { user, assignment, session } = await running();
    for (let n = 1; n <= 6; n++) {
      await service().logSet(user.id, assignment.id, {
        setsCompleted: n,
        restStartedAtSeconds: null,
      });
    }

    // Six sets in: the five pull sets are behind, so this is the first set of
    // the second movement rather than a sixth of the first.
    expect((await storedSetLogs(session.id))[5]).toMatchObject({
      movementOrder: 1,
      setNumber: 1,
      exerciseId: session.movements[1].exercise.id,
      prescribedReps: 8,
      actualReps: 8,
    });
  });

  it('does not record the set twice when a tap is replayed', async () => {
    const { user, assignment, session } = await running();
    await service().logSet(user.id, assignment.id, {
      setsCompleted: 1,
      restStartedAtSeconds: 90,
    });

    // The same tap arriving again after a flaky connection. Two rows for one
    // set would make every later count of the work double it.
    await service().logSet(user.id, assignment.id, {
      setsCompleted: 1,
      restStartedAtSeconds: 90,
    });

    expect(await storedSetLogs(session.id)).toHaveLength(1);
  });

  it('writes nothing when the call is the screen skipping a rest', async () => {
    const { user, assignment, session } = await running();
    await service().logSet(user.id, assignment.id, {
      setsCompleted: 1,
      restStartedAtSeconds: 90,
    });
    const [written] = await storedSetLogs(session.id);

    // The rest screen posts the *current* count to clear the rest. It
    // finished no set, so there is no second row to write.
    await service().logSet(user.id, assignment.id, {
      setsCompleted: 1,
      restStartedAtSeconds: null,
    });

    const after = await storedSetLogs(session.id);
    expect(after).toHaveLength(1);
    // Not touched, rather than rewritten with the same values: the upsert
    // would hide a redundant write behind an unchanged row, and a set
    // rewritten by a rest-skip is a set whose correction a rest-skip undoes.
    expect(after[0].updatedAt).toEqual(written.updatedAt);
  });

  it('writes nothing for a call that arrives late with an earlier count', async () => {
    const { user, assignment, session } = await running();
    for (const n of [1, 2]) {
      await service().logSet(user.id, assignment.id, {
        setsCompleted: n,
        restStartedAtSeconds: null,
      });
    }

    await service().logSet(user.id, assignment.id, {
      setsCompleted: 1,
      restStartedAtSeconds: 90,
    });

    // Both rows stand as they were recorded -- the late call is a replay of a
    // tap already written, not a set of its own.
    expect(await storedSetLogs(session.id)).toMatchObject([
      { setNumber: 1, actualReps: 3 },
      { setNumber: 2, actualReps: 3 },
    ]);
  });

  it('writes no row for a set past the end of the session', async () => {
    const { user, assignment, session } = await running();

    await expect(
      service().logSet(user.id, assignment.id, {
        setsCompleted: 9,
        restStartedAtSeconds: null,
      }),
    ).rejects.toThrow(BadRequestException);

    expect(await storedSetLogs(session.id)).toEqual([]);
  });

  it('keeps the counter and the rows as one reading of the same tap', async () => {
    // Written in one transaction, so there is no state where the session says
    // it is on set two and the row for set one was never recorded.
    const { user, assignment, session } = await running();
    for (const n of [1, 2, 3]) {
      await service().logSet(user.id, assignment.id, {
        setsCompleted: n,
        restStartedAtSeconds: null,
      });
    }

    expect((await storedSession(assignment.id))?.setsCompleted).toBe(3);
    expect(await storedSetLogs(session.id)).toHaveLength(3);
  });
});

describe('SessionsService.setLogs', () => {
  async function trained(sets: number) {
    const day = await prescribedDay();
    const session = await service().start(day.user.id, day.assignment.id);
    for (let n = 1; n <= sets; n++) {
      await service().logSet(day.user.id, day.assignment.id, {
        setsCompleted: n,
        restStartedAtSeconds: null,
      });
    }
    return { ...day, session };
  }

  it('reads the sets back in the order they were done', async () => {
    // Five sets of the first movement, then one of the second -- so this is
    // also where an ordering by `completedAt`, or by id, would still look
    // right and a movement-major layout would not.
    const { user, assignment } = await trained(6);

    expect(
      (await service().setLogs(user.id, assignment.id)).map((row) => [
        row.movementOrder,
        row.setNumber,
        row.prescribedReps,
      ]),
    ).toEqual([
      [0, 1, 3],
      [0, 2, 3],
      [0, 3, 3],
      [0, 4, 3],
      [0, 5, 3],
      [1, 1, 8],
    ]);
  });

  it('is empty for a session that has recorded nothing yet', async () => {
    const { user, assignment } = await trained(0);

    expect(await service().setLogs(user.id, assignment.id)).toEqual([]);
  });

  it('still reads after the session is finished, which is when the log screen asks', async () => {
    const { user, assignment } = await trained(2);
    await service().finish(user.id, assignment.id);

    expect(await service().setLogs(user.id, assignment.id)).toHaveLength(2);
  });

  it("reads another athlete's session as not found", async () => {
    const { assignment } = await trained(2);
    const stranger = await createUser();

    await expect(service().setLogs(stranger.id, assignment.id)).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('SessionsService.editSetLogs', () => {
  async function trained(sets = 3) {
    const day = await prescribedDay();
    const session = await service().start(day.user.id, day.assignment.id);
    for (let n = 1; n <= sets; n++) {
      await service().logSet(day.user.id, day.assignment.id, {
        setsCompleted: n,
        restStartedAtSeconds: null,
      });
    }
    return { ...day, session };
  }

  it('corrects a set the runner recorded, and leaves the rest alone', async () => {
    const { user, assignment } = await trained();

    const rows = await service().editSetLogs(user.id, assignment.id, {
      sets: [{ movementOrder: 0, setNumber: 2, actualReps: 1 }],
    });

    expect(rows.map((row) => row.actualReps)).toEqual([3, 1, 3]);
  });

  it('corrects several sets at once', async () => {
    const { user, assignment } = await trained();

    const rows = await service().editSetLogs(user.id, assignment.id, {
      sets: [
        { movementOrder: 0, setNumber: 1, actualReps: 2 },
        { movementOrder: 0, setNumber: 3, actualReps: 0 },
      ],
    });

    expect(rows.map((row) => row.actualReps)).toEqual([2, 3, 0]);
  });

  it('will not conjure a set no session recorded', async () => {
    // The runner is what creates these rows. An edit that could create one
    // would let the log screen claim work on a day the athlete walked out --
    // "I did five" on a session that recorded three.
    const { user, assignment } = await trained();

    const rows = await service().editSetLogs(user.id, assignment.id, {
      sets: [{ movementOrder: 0, setNumber: 5, actualReps: 3 }],
    });

    expect(rows).toHaveLength(3);
  });

  it("leaves another athlete's sets untouched", async () => {
    const { user, assignment } = await trained();
    const stranger = await createUser();

    await expect(
      service().editSetLogs(stranger.id, assignment.id, {
        sets: [{ movementOrder: 0, setNumber: 1, actualReps: 0 }],
      }),
    ).rejects.toThrow(NotFoundException);

    expect(
      (await service().setLogs(user.id, assignment.id))[0].actualReps,
    ).toBe(3);
  });
});

describe('SessionsService.finish, on an untimed session', () => {
  it('records how long it took rather than clamping to a cap it has not got', async () => {
    const { user, assignment } = await prescribedDay();
    await startedSecondsAgo(user.id, assignment.id, 2400);

    const finished = await service().finish(user.id, assignment.id);

    // 40 minutes. Not a score on a straight-sets day, but it is what
    // happened, and a null cap must not clamp it to zero.
    expect(finished.finishedAtSeconds).toBeGreaterThanOrEqual(2399);
  });
});
