import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DEFAULT_PLAN_ID } from '@regimen-works/shared';
import type { CommitSetup } from '@regimen-works/shared';
import type { PrismaClient } from '@prisma/client';
import { testPrisma } from '../test-support/database';
import {
  createAssignment,
  createEnrollment,
  createFixedPlan,
  createLog,
  createPlan,
  createSession,
  createSkillLevel,
  createUser,
} from '../test-support/fixtures';
import { upsertJustWods } from '../plans/just-wods';
import type { PrismaService } from '../prisma/prisma.service';
import { SetupService } from './setup.service';

/**
 * The first-run wizard against a real database (DN-15).
 *
 * The rules themselves are unit-tested in `setup.logic.spec.ts`. What needs
 * Postgres is the commit: one active enrollment pointed at a different
 * program rather than replaced, today's assignment discarded only when
 * discarding it is safe, and `onboardedAt` stamped last inside the same
 * transaction as all of it.
 */

// A Wednesday, so a week either side of it stays inside the same month.
const TODAY = '2026-09-16';

function service(client: PrismaClient = testPrisma()): SetupService {
  return new SetupService(client as unknown as PrismaService);
}

function answers(overrides: Partial<CommitSetup> = {}): CommitSetup {
  return {
    planId: 'plan-1',
    trainingDays: [1, 3, 5],
    weeks: 6,
    startDate: TODAY,
    ...overrides,
  };
}

/**
 * An athlete as provisioning leaves them: a schedule rule, and an active
 * enrollment in Just WODs they never chose (DN-13). Every commit case starts
 * here, because that is the only state the wizard is ever entered from.
 */
async function provisionedAthlete(trainingDays = [1, 2, 3, 4, 5]) {
  const user = await createUser();
  await upsertJustWods(testPrisma());
  await testPrisma().scheduleRule.create({
    data: { userId: user.id, trainingDays },
  });
  const enrollment = await createEnrollment(user.id, {
    planId: DEFAULT_PLAN_ID,
    startDate: TODAY,
    weeks: null,
  });
  return { userId: user.id, enrollmentId: enrollment.id };
}

function activeEnrollment(userId: string) {
  return testPrisma().planEnrollment.findFirstOrThrow({
    where: { userId, status: 'active' },
  });
}

describe('SetupService.options', () => {
  it('offers the curated programs, with Just WODs first', async () => {
    const { userId } = await provisionedAthlete();
    await createPlan({ name: 'Zebra Program' });
    await createPlan({ name: 'Ankle Program' });

    const options = await service().options(userId, TODAY);

    // First because it is what every athlete is already on and what the
    // picker recommends to anyone unsure -- not a consolation prize sorted
    // to the bottom under Z.
    expect(options.programs[0].id).toBe(DEFAULT_PLAN_ID);
    const rest = options.programs.slice(1).map((p) => p.name);
    expect(rest).toEqual(['Ankle Program', 'Zebra Program']);
  });

  it('offers the athlete their own program', async () => {
    const { userId } = await provisionedAthlete();
    const mine = await createPlan({ name: 'My Own Thing', ownerId: userId });

    const options = await service().options(userId, TODAY);

    expect(options.programs.map((p) => p.id)).toContain(mine.id);
  });

  it('does not offer somebody else programs', async () => {
    // The tier rule from DN-93, as it applies to plans. A picker that listed
    // every athlete's private program would be a directory of them.
    const { userId } = await provisionedAthlete();
    const stranger = await createUser();
    const theirs = await createPlan({ name: 'Theirs', ownerId: stranger.id });

    const options = await service().options(userId, TODAY);

    expect(options.programs.map((p) => p.id)).not.toContain(theirs.id);
  });

  it('reports which days a fixed program trains', async () => {
    // Without this the cadence screen could say "Fixed schedule" and not
    // what it fixed them to, which is the half the athlete wants to know.
    const { userId } = await provisionedAthlete();
    const fixed = await createFixedPlan([1, 2, 4, 5]);

    const options = await service().options(userId, TODAY);

    const program = options.programs.find((p) => p.id === fixed.id)!;
    expect(program.fixedDays).toEqual([1, 2, 4, 5]);
    expect(program.scheduleMode).toBe('fixed');
  });

  it('reports no fixed days for a flexible program', async () => {
    const { userId } = await provisionedAthlete();

    const options = await service().options(userId, TODAY);

    const justWods = options.programs.find((p) => p.id === DEFAULT_PLAN_ID)!;
    expect(justWods.fixedDays).toEqual([]);
  });

  it('starts the day picker from the days the athlete already has', async () => {
    // The wizard is reachable by someone who abandoned it halfway, and
    // asking them to re-pick days they picked is what stamping `onboardedAt`
    // last is supposed to avoid.
    const { userId } = await provisionedAthlete([2, 4, 6]);

    expect((await service().options(userId, TODAY)).trainingDays).toEqual([
      2, 4, 6,
    ]);
  });

  it('falls back to the default week where the athlete has no schedule rule', async () => {
    // Provisioning writes one on first sign-in, so this is for a row that is
    // somehow absent rather than for the ordinary case -- and the wizard is
    // the worst screen in the app to 500 on.
    const user = await createUser();
    await upsertJustWods(testPrisma());

    expect((await service().options(user.id, TODAY)).trainingDays).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });

  it('lets the athlete start today when today has not been trained', async () => {
    const { userId } = await provisionedAthlete();
    // An assignment alone is not training: `getToday` creates one on the
    // first read of the day, so an athlete who merely opened the app this
    // morning must still be able to start this morning.
    await createAssignment(userId, { date: TODAY });

    const options = await service().options(userId, TODAY);

    expect(options.earliestStartDate).toBe(TODAY);
  });

  it('will not let the athlete start today once a session exists', async () => {
    const { userId } = await provisionedAthlete();
    const assignment = await createAssignment(userId, { date: TODAY });
    await createSession(userId, assignment.id);

    const options = await service().options(userId, TODAY);

    expect(options.earliestStartDate).toBe('2026-09-17');
  });

  it('will not let the athlete start today once a result is logged', async () => {
    // A day logged from memory, never run through the timer. It is still a
    // day of training, and a start date must never destroy one.
    const { userId } = await provisionedAthlete();
    const assignment = await createAssignment(userId, { date: TODAY });
    await createLog(userId, assignment.id);

    const options = await service().options(userId, TODAY);

    expect(options.earliestStartDate).toBe('2026-09-17');
  });

  it('is not moved by somebody else training today', async () => {
    const { userId } = await provisionedAthlete();
    const stranger = await createUser();
    const theirs = await createAssignment(stranger.id, { date: TODAY });
    await createSession(stranger.id, theirs.id);

    expect((await service().options(userId, TODAY)).earliestStartDate).toBe(
      TODAY,
    );
  });
});

describe('SetupService.commit', () => {
  it('points the athlete existing enrollment at the chosen program', async () => {
    // Updated in place, not replaced: deleting the auto enrollment raises an
    // FK error as soon as a training day points at it, and completing it
    // would write a never-trained program into the finished list.
    const { userId, enrollmentId } = await provisionedAthlete();
    const plan = await createPlan();

    await service().commit(
      userId,
      answers({ planId: plan.id, weeks: 6, startDate: '2026-09-21' }),
      TODAY,
    );

    const enrollment = await activeEnrollment(userId);
    expect(enrollment.id).toBe(enrollmentId);
    expect(enrollment.planId).toBe(plan.id);
    expect(enrollment.startDate).toBe('2026-09-21');
    expect(enrollment.weeks).toBe(6);
    expect(await testPrisma().planEnrollment.count({ where: { userId } })).toBe(
      1,
    );
  });

  it('snapshots where every ladder stands as the run begins', async () => {
    // The completion card diffs against this (DN-18). Without it a finished
    // program can count sessions but cannot say what changed, which is the
    // half of the card worth reading.
    const { userId } = await provisionedAthlete();
    await createSkillLevel(userId, 'pull', 2);
    await createSkillLevel(userId, 'squat', 1);
    const plan = await createPlan();

    await service().commit(userId, answers({ planId: plan.id }), TODAY);

    expect((await activeEnrollment(userId)).startingRungs).toEqual({
      pull: 2,
      squat: 1,
    });
  });

  it('snapshots nothing for an athlete who has trained nothing', async () => {
    // The ordinary first run: DN-86 provisions no SkillLevel rows, so every
    // line starts absent and reads as rung 0 wherever it is diffed.
    const { userId } = await provisionedAthlete();
    const plan = await createPlan();

    await service().commit(userId, answers({ planId: plan.id }), TODAY);

    expect((await activeEnrollment(userId)).startingRungs).toEqual({});
  });

  it('puts away a completion card the athlete has just answered', async () => {
    // Choosing a program in the wizard answers "what next?". A card still
    // offering that choice afterwards would be asking a question the athlete
    // has already settled.
    const { userId } = await provisionedAthlete();
    const finished = await createEnrollment(userId, {
      status: 'completed',
      completedAt: new Date('2026-09-15T09:00:00.000Z'),
      summary: { weeks: 6, sessions: 24, rungChanges: [] },
    });
    const plan = await createPlan();

    await service().commit(userId, answers({ planId: plan.id }), TODAY);

    const after = await testPrisma().planEnrollment.findUniqueOrThrow({
      where: { id: finished.id },
    });
    expect(after.summaryDismissedAt).not.toBeNull();
    // The record stays a record -- only the prompt was answered.
    expect(after.status).toBe('completed');
  });

  it('enrolls an athlete who has no active program', async () => {
    // Where a finished program leaves them, until something re-enrolls them.
    const { userId, enrollmentId } = await provisionedAthlete();
    await testPrisma().planEnrollment.update({
      where: { id: enrollmentId },
      data: { status: 'completed', completedAt: new Date() },
    });
    const plan = await createPlan();

    await service().commit(userId, answers({ planId: plan.id }), TODAY);

    expect((await activeEnrollment(userId)).planId).toBe(plan.id);
  });

  it('writes the days the athlete picked', async () => {
    const { userId } = await provisionedAthlete();
    const plan = await createPlan();

    await service().commit(
      userId,
      answers({ planId: plan.id, trainingDays: [2, 4, 6], weeks: 4 }),
      TODAY,
    );

    const rule = await testPrisma().scheduleRule.findUniqueOrThrow({
      where: { userId },
    });
    expect(rule.trainingDays).toEqual([2, 4, 6]);
  });

  it('leaves the stored days alone for a fixed program', async () => {
    // DN-118: the athlete's own days stay true and merely asleep for the run,
    // so overwriting them here would destroy the value the lock hands back.
    const { userId } = await provisionedAthlete([2, 4, 6]);
    const fixed = await createFixedPlan([1, 2, 4, 5]);

    await service().commit(
      userId,
      answers({ planId: fixed.id, trainingDays: null, weeks: 6 }),
      TODAY,
    );

    const rule = await testPrisma().scheduleRule.findUniqueOrThrow({
      where: { userId },
    });
    expect(rule.trainingDays).toEqual([2, 4, 6]);
  });

  it('stamps the athlete as onboarded', async () => {
    const { userId } = await provisionedAthlete();
    const plan = await createPlan();

    const result = await service().commit(
      userId,
      answers({ planId: plan.id }),
      TODAY,
    );

    const user = await testPrisma().user.findUniqueOrThrow({
      where: { id: userId },
    });
    expect(user.onboardedAt).not.toBeNull();
    expect(result.onboardedAt).toBe(user.onboardedAt!.toISOString());
  });

  it('discards today untouched assignment when the program starts today', async () => {
    // `getToday` hands back the assignment it already made, so without this
    // the app would offer "start today" and then train the old program on it.
    const { userId } = await provisionedAthlete();
    const plan = await createPlan();
    const stale = await createAssignment(userId, { date: TODAY });

    await service().commit(
      userId,
      answers({ planId: plan.id, startDate: TODAY }),
      TODAY,
    );

    expect(
      await testPrisma().dailyAssignment.findUnique({
        where: { id: stale.id },
      }),
    ).toBeNull();
  });

  it('leaves today assignment alone when the program starts later', async () => {
    // The days before a future start fall back to Just WODs, and today is one
    // of them -- deleting it would throw away a day the athlete may train.
    const { userId } = await provisionedAthlete();
    const plan = await createPlan();
    const today = await createAssignment(userId, { date: TODAY });

    await service().commit(
      userId,
      answers({ planId: plan.id, startDate: '2026-09-21' }),
      TODAY,
    );

    expect(
      await testPrisma().dailyAssignment.findUnique({
        where: { id: today.id },
      }),
    ).not.toBeNull();
  });

  it('does not discard anybody else day', async () => {
    const { userId } = await provisionedAthlete();
    const plan = await createPlan();
    const stranger = await createUser();
    const theirs = await createAssignment(stranger.id, { date: TODAY });

    await service().commit(
      userId,
      answers({ planId: plan.id, startDate: TODAY }),
      TODAY,
    );

    expect(
      await testPrisma().dailyAssignment.findUnique({
        where: { id: theirs.id },
      }),
    ).not.toBeNull();
  });

  it('refuses a program belonging to somebody else', async () => {
    // 404 rather than 403: whether another athlete private program exists is
    // not this athlete business.
    const { userId } = await provisionedAthlete();
    const stranger = await createUser();
    const theirs = await createPlan({ ownerId: stranger.id });

    await expect(
      service().commit(userId, answers({ planId: theirs.id }), TODAY),
    ).rejects.toThrow(NotFoundException);
  });

  it('refuses a program that does not exist', async () => {
    const { userId } = await provisionedAthlete();

    await expect(
      service().commit(userId, answers({ planId: 'plan_nope' }), TODAY),
    ).rejects.toThrow(NotFoundException);
  });

  it('writes nothing at all when an answer is refused', async () => {
    // The transaction is the point: a rejected commit must leave the athlete
    // un-onboarded, so they come back to the wizard rather than to a program
    // they half-chose.
    const { userId, enrollmentId } = await provisionedAthlete();
    const plan = await createPlan();

    await expect(
      service().commit(
        userId,
        answers({ planId: plan.id, trainingDays: [2] }),
        TODAY,
      ),
    ).rejects.toThrow(BadRequestException);

    const enrollment = await activeEnrollment(userId);
    expect(enrollment.id).toBe(enrollmentId);
    expect(enrollment.planId).toBe(DEFAULT_PLAN_ID);
    const user = await testPrisma().user.findUniqueOrThrow({
      where: { id: userId },
    });
    expect(user.onboardedAt).toBeNull();
  });

  it('refuses a start date the athlete was never offered', async () => {
    const { userId } = await provisionedAthlete();
    const plan = await createPlan();
    const assignment = await createAssignment(userId, { date: TODAY });
    await createSession(userId, assignment.id);

    // Today is spoken for, and the service computes that from the database
    // rather than trusting whatever the client last read.
    await expect(
      service().commit(
        userId,
        answers({ planId: plan.id, startDate: TODAY }),
        TODAY,
      ),
    ).rejects.toThrow(BadRequestException);
  });
});
