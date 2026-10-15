import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DEFAULT_PROGRAM_ID } from '@regimen-works/shared';
import type { CommitSetup } from '@regimen-works/shared';
import type { PrismaClient } from '@prisma/client';
import { testPrisma } from '../test-support/database';
import {
  createAssignment,
  createEnrollment,
  createExercise,
  createFixedProgram,
  createLog,
  createProgram,
  createSession,
  createSkillLevel,
  createUser,
} from '../test-support/fixtures';
import { upsertJustWods } from '../programs/just-wods';
import type { PrismaService } from '../prisma/prisma.service';
import { SetupService } from './setup.service';

/**
 * The first-run wizard against a real database (DN-15).
 *
 * The rules themselves are unit-tested in `setup.logic.spec.ts`. What needs
 * Postgres is the commit: the run being left ended and a new one begun (or,
 * for a run nobody trained, replaced in place), today's assignment discarded
 * only when discarding it is safe, and `onboardedAt` stamped last inside the
 * same transaction as all of it.
 */

// A Wednesday, so a week either side of it stays inside the same month.
const TODAY = '2026-09-16';

function service(client: PrismaClient = testPrisma()): SetupService {
  return new SetupService(client as unknown as PrismaService);
}

function answers(overrides: Partial<CommitSetup> = {}): CommitSetup {
  return {
    programId: 'program-1',
    trainingDays: [1, 3, 5],
    weeks: 6,
    startDate: TODAY,
    defaultRestSeconds: null,
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
    programId: DEFAULT_PROGRAM_ID,
    startDate: TODAY,
    weeks: null,
  });
  return { userId: user.id, enrollmentId: enrollment.id };
}

function activeEnrollment(userId: string) {
  return testPrisma().programEnrollment.findFirstOrThrow({
    where: { userId, status: 'active' },
  });
}

describe('SetupService.options', () => {
  it('offers the curated programs, with Just WODs first', async () => {
    const { userId } = await provisionedAthlete();
    await createProgram({ name: 'Zebra Program' });
    await createProgram({ name: 'Ankle Program' });

    const options = await service().options(userId, TODAY);

    // First because it is what every athlete is already on and what the
    // picker recommends to anyone unsure -- not a consolation prize sorted
    // to the bottom under Z.
    expect(options.programs[0].id).toBe(DEFAULT_PROGRAM_ID);
    const rest = options.programs.slice(1).map((p) => p.name);
    expect(rest).toEqual(['Ankle Program', 'Zebra Program']);
  });

  it('offers the athlete their own program', async () => {
    const { userId } = await provisionedAthlete();
    const mine = await createProgram({ name: 'My Own Thing', ownerId: userId });

    const options = await service().options(userId, TODAY);

    expect(options.programs.map((p) => p.id)).toContain(mine.id);
  });

  it('does not offer an archived program, global or owned', async () => {
    const { userId } = await provisionedAthlete();
    const global = await createProgram({ archivedAt: new Date() });
    const mine = await createProgram({
      ownerId: userId,
      archivedAt: new Date(),
    });

    const options = await service().options(userId, TODAY);

    const ids = options.programs.map((p) => p.id);
    expect(ids).not.toContain(global.id);
    expect(ids).not.toContain(mine.id);
  });

  it('does not offer somebody else programs', async () => {
    // The tier rule from DN-93, as it applies to programs. A picker that listed
    // every athlete's private program would be a directory of them.
    const { userId } = await provisionedAthlete();
    const stranger = await createUser();
    const theirs = await createProgram({
      name: 'Theirs',
      ownerId: stranger.id,
    });

    const options = await service().options(userId, TODAY);

    expect(options.programs.map((p) => p.id)).not.toContain(theirs.id);
  });

  it('reports which days a fixed program trains', async () => {
    // Without this the cadence screen could say "Fixed schedule" and not
    // what it fixed them to, which is the half the athlete wants to know.
    const { userId } = await provisionedAthlete();
    const fixed = await createFixedProgram([1, 2, 4, 5]);

    const options = await service().options(userId, TODAY);

    const program = options.programs.find((p) => p.id === fixed.id)!;
    expect(program.fixedDays).toEqual([1, 2, 4, 5]);
    expect(program.scheduleMode).toBe('fixed');
  });

  it("carries the author's reason for a fixed week to the picker", async () => {
    // A fixed program takes the day picker away and suppresses the rest-day
    // makeup, and DN-124 says both at enrollment. Neither reads as design
    // rather than restriction without the author's own sentence beside it,
    // so the column has to survive the trip to the wizard.
    const { userId } = await provisionedAthlete();
    const fixed = await createFixedProgram([1, 2, 4, 5], {
      scheduleNote: 'Two heavy pull days, 48 hours apart.',
    });

    const options = await service().options(userId, TODAY);

    expect(options.programs.find((p) => p.id === fixed.id)!.scheduleNote).toBe(
      'Two heavy pull days, 48 hours apart.',
    );
  });

  it('leaves the note null for a program with nothing to explain', async () => {
    // Most programs. The wizard shows nothing rather than an empty panel.
    const { userId } = await provisionedAthlete();

    const options = await service().options(userId, TODAY);

    expect(
      options.programs.find((p) => p.id === DEFAULT_PROGRAM_ID)!.scheduleNote,
    ).toBeNull();
  });

  it('reports no fixed days for a flexible program', async () => {
    const { userId } = await provisionedAthlete();

    const options = await service().options(userId, TODAY);

    const justWods = options.programs.find((p) => p.id === DEFAULT_PROGRAM_ID)!;
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
  it('points an untrained enrollment at the chosen program', async () => {
    // The first-run wizard's case: provisioning's Just WODs run has no days
    // on it, so there is nothing to relabel, and ending it would leave an
    // empty run in the past-runs list beside the one the athlete chose.
    const { userId, enrollmentId } = await provisionedAthlete();
    const program = await createProgram();

    await service().commit(
      userId,
      answers({ programId: program.id, weeks: 6, startDate: '2026-09-21' }),
      TODAY,
    );

    const enrollment = await activeEnrollment(userId);
    expect(enrollment.id).toBe(enrollmentId);
    expect(enrollment.programId).toBe(program.id);
    expect(enrollment.startDate).toBe('2026-09-21');
    expect(enrollment.weeks).toBe(6);
    expect(
      await testPrisma().programEnrollment.count({ where: { userId } }),
    ).toBe(1);
  });

  it('snapshots what every group stands at as the run begins', async () => {
    // The completion card diffs against this (DN-18). Without it a finished
    // program can count sessions but cannot say what changed, which is the
    // half of the card worth reading.
    const { userId } = await provisionedAthlete();
    const chinUp = await createExercise({ movementGroup: 'pull' });
    const goblet = await createExercise({ movementGroup: 'squat' });
    await createSkillLevel(userId, 'pull', chinUp.id);
    await createSkillLevel(userId, 'squat', goblet.id);
    const program = await createProgram();

    await service().commit(userId, answers({ programId: program.id }), TODAY);

    expect((await activeEnrollment(userId)).startingMovements).toEqual({
      pull: chinUp.id,
      squat: goblet.id,
    });
  });

  it('snapshots nothing for an athlete who has trained nothing', async () => {
    // The ordinary first run: DN-86 provisions no SkillLevel rows, so every
    // group starts absent and diffs from null (DN-139).
    const { userId } = await provisionedAthlete();
    const program = await createProgram();

    await service().commit(userId, answers({ programId: program.id }), TODAY);

    expect((await activeEnrollment(userId)).startingMovements).toEqual({});
  });

  it('puts away a completion card the athlete has just answered', async () => {
    // Choosing a program in the wizard answers "what next?". A card still
    // offering that choice afterwards would be asking a question the athlete
    // has already settled.
    const { userId } = await provisionedAthlete();
    const finished = await createEnrollment(userId, {
      status: 'completed',
      completedAt: new Date('2026-09-15T09:00:00.000Z'),
      summary: { weeks: 6, sessions: 24, movementChanges: [] },
    });
    const program = await createProgram();

    await service().commit(userId, answers({ programId: program.id }), TODAY);

    const after = await testPrisma().programEnrollment.findUniqueOrThrow({
      where: { id: finished.id },
    });
    expect(after.summaryDismissedAt).not.toBeNull();
    // The record stays a record -- only the prompt was answered.
    expect(after.status).toBe('completed');
  });

  it('enrolls an athlete who has no active program', async () => {
    // Where a finished program leaves them, until something re-enrolls them.
    const { userId, enrollmentId } = await provisionedAthlete();
    await testPrisma().programEnrollment.update({
      where: { id: enrollmentId },
      data: { status: 'completed', completedAt: new Date() },
    });
    const program = await createProgram();

    await service().commit(userId, answers({ programId: program.id }), TODAY);

    expect((await activeEnrollment(userId)).programId).toBe(program.id);
  });

  it('writes the days the athlete picked', async () => {
    const { userId } = await provisionedAthlete();
    const program = await createProgram();

    await service().commit(
      userId,
      answers({ programId: program.id, trainingDays: [2, 4, 6], weeks: 4 }),
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
    const fixed = await createFixedProgram([1, 2, 4, 5]);

    await service().commit(
      userId,
      answers({ programId: fixed.id, trainingDays: null, weeks: 6 }),
      TODAY,
    );

    const rule = await testPrisma().scheduleRule.findUniqueOrThrow({
      where: { userId },
    });
    expect(rule.trainingDays).toEqual([2, 4, 6]);
  });

  it('stamps the athlete as onboarded', async () => {
    const { userId } = await provisionedAthlete();
    const program = await createProgram();

    const result = await service().commit(
      userId,
      answers({ programId: program.id }),
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
    const program = await createProgram();
    const stale = await createAssignment(userId, { date: TODAY });

    await service().commit(
      userId,
      answers({ programId: program.id, startDate: TODAY }),
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
    const program = await createProgram();
    const today = await createAssignment(userId, { date: TODAY });

    await service().commit(
      userId,
      answers({ programId: program.id, startDate: '2026-09-21' }),
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
    const program = await createProgram();
    const stranger = await createUser();
    const theirs = await createAssignment(stranger.id, { date: TODAY });

    await service().commit(
      userId,
      answers({ programId: program.id, startDate: TODAY }),
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
    const theirs = await createProgram({ ownerId: stranger.id });

    await expect(
      service().commit(userId, answers({ programId: theirs.id }), TODAY),
    ).rejects.toThrow(NotFoundException);
  });

  it('refuses an archived program, even the athlete own', async () => {
    // ADR 0006, decision 5: an archived program leaves the picker so nobody
    // new can start it. Hiding it from `options` alone would leave the door
    // open to anyone who kept the id.
    const { userId } = await provisionedAthlete();
    const archived = await createProgram({
      ownerId: userId,
      archivedAt: new Date(),
    });

    await expect(
      service().commit(userId, answers({ programId: archived.id }), TODAY),
    ).rejects.toThrow(NotFoundException);
  });

  it('refuses a program that does not exist', async () => {
    const { userId } = await provisionedAthlete();

    await expect(
      service().commit(userId, answers({ programId: 'program_nope' }), TODAY),
    ).rejects.toThrow(NotFoundException);
  });

  it('writes nothing at all when an answer is refused', async () => {
    // The transaction is the point: a rejected commit must leave the athlete
    // un-onboarded, so they come back to the wizard rather than to a program
    // they half-chose.
    const { userId, enrollmentId } = await provisionedAthlete();
    const program = await createProgram();

    await expect(
      service().commit(
        userId,
        answers({ programId: program.id, trainingDays: [2] }),
        TODAY,
      ),
    ).rejects.toThrow(BadRequestException);

    const enrollment = await activeEnrollment(userId);
    expect(enrollment.id).toBe(enrollmentId);
    expect(enrollment.programId).toBe(DEFAULT_PROGRAM_ID);
    const user = await testPrisma().user.findUniqueOrThrow({
      where: { id: userId },
    });
    expect(user.onboardedAt).toBeNull();
  });

  it('refuses a start date the athlete was never offered', async () => {
    const { userId } = await provisionedAthlete();
    const program = await createProgram();
    const assignment = await createAssignment(userId, { date: TODAY });
    await createSession(userId, assignment.id);

    // Today is spoken for, and the service computes that from the database
    // rather than trusting whatever the client last read.
    await expect(
      service().commit(
        userId,
        answers({ programId: program.id, startDate: TODAY }),
        TODAY,
      ),
    ).rejects.toThrow(BadRequestException);
  });
});

/**
 * Starting a program while a run is under way (ADR 0009, decisions 1, 6 and
 * 7; DN-178). The run being left ends with its days still on it, and the new
 * program is a new run.
 */
describe('SetupService.commit, leaving a run part-way', () => {
  /** A day trained on `enrollmentId`, with a result logged against it. */
  async function trainedDay(
    userId: string,
    enrollmentId: string,
    date: string,
  ) {
    const assignment = await createAssignment(userId, { date, enrollmentId });
    await createLog(userId, assignment.id);
    return assignment;
  }

  function enrollmentsOf(userId: string) {
    return testPrisma().programEnrollment.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
  }

  it('ends the run being left and starts the chosen program as a new one', async () => {
    const { userId, enrollmentId } = await provisionedAthlete();
    const program = await createProgram();
    const monday = await trainedDay(userId, enrollmentId, '2026-09-14');
    const tuesday = await trainedDay(userId, enrollmentId, '2026-09-15');

    await service().commit(
      userId,
      answers({ programId: program.id, startDate: '2026-09-21' }),
      TODAY,
    );

    const [left, started] = await enrollmentsOf(userId);
    expect(left).toMatchObject({
      id: enrollmentId,
      programId: DEFAULT_PROGRAM_ID,
      status: 'ended',
      startDate: TODAY,
    });
    expect(left.endedAt).not.toBeNull();
    // Ended, not finished: no card is owed for it.
    expect(left.completedAt).toBeNull();
    expect(left.summary).toBeNull();
    expect(started).toMatchObject({
      programId: program.id,
      status: 'active',
      startDate: '2026-09-21',
      endedAt: null,
    });

    // The days trained stay with the run they were trained on.
    const days = await testPrisma().dailyAssignment.findMany({
      where: { id: { in: [monday.id, tuesday.id] } },
      select: { enrollmentId: true },
    });
    expect(days).toEqual([{ enrollmentId }, { enrollmentId }]);
  });

  it('leaves Just WODs by the same rule, ending a program part-way', async () => {
    // Decision 6: Just WODs is a program like any other, in both directions.
    const { userId } = await provisionedAthlete();
    const program = await createProgram();
    await service().commit(userId, answers({ programId: program.id }), TODAY);
    const onProgram = await activeEnrollment(userId);
    await trainedDay(userId, onProgram.id, TODAY);

    await service().commit(
      userId,
      answers({
        programId: DEFAULT_PROGRAM_ID,
        weeks: null,
        startDate: '2026-09-17',
      }),
      TODAY,
    );

    const left = await testPrisma().programEnrollment.findUniqueOrThrow({
      where: { id: onProgram.id },
    });
    expect(left).toMatchObject({ programId: program.id, status: 'ended' });
    expect((await activeEnrollment(userId)).programId).toBe(DEFAULT_PROGRAM_ID);
  });

  it('keeps a logged today on the run being left, and starts the new one tomorrow', async () => {
    // Decision 7. Today was trained, so it is a day of the old run; the new
    // run cannot claim it, and the only start the wizard offers is tomorrow.
    const { userId, enrollmentId } = await provisionedAthlete();
    const program = await createProgram();
    const today = await trainedDay(userId, enrollmentId, TODAY);

    await expect(
      service().commit(
        userId,
        answers({ programId: program.id, startDate: TODAY }),
        TODAY,
      ),
    ).rejects.toThrow(
      "Today's workout is already under way, so the earliest you can start is tomorrow.",
    );
    expect((await service().options(userId, TODAY)).earliestStartDate).toBe(
      '2026-09-17',
    );

    await service().commit(
      userId,
      answers({ programId: program.id, startDate: '2026-09-17' }),
      TODAY,
    );

    const kept = await testPrisma().dailyAssignment.findUniqueOrThrow({
      where: { id: today.id },
      include: { log: true },
    });
    expect(kept.enrollmentId).toBe(enrollmentId);
    expect(kept.log).not.toBeNull();
    expect(
      (
        await testPrisma().programEnrollment.findUniqueOrThrow({
          where: { id: enrollmentId },
        })
      ).status,
    ).toBe('ended');
    expect(await activeEnrollment(userId)).toMatchObject({
      programId: program.id,
      startDate: '2026-09-17',
    });
  });

  it('replaces in place a run whose only day was an untouched today', async () => {
    // Starting today discards that day (it belongs to the new run), and
    // what is left is a run nobody trained -- nothing to end.
    const { userId, enrollmentId } = await provisionedAthlete();
    const program = await createProgram();
    await createAssignment(userId, { date: TODAY, enrollmentId });

    await service().commit(
      userId,
      answers({ programId: program.id, startDate: TODAY }),
      TODAY,
    );

    const all = await enrollmentsOf(userId);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      id: enrollmentId,
      programId: program.id,
      status: 'active',
    });
  });

  it('writes nothing when the switch is refused', async () => {
    // One transaction: a refused answer must not have ended the run first.
    const { userId, enrollmentId } = await provisionedAthlete();
    const program = await createProgram();
    await trainedDay(userId, enrollmentId, '2026-09-14');

    await expect(
      service().commit(
        userId,
        answers({ programId: program.id, weeks: 999 }),
        TODAY,
      ),
    ).rejects.toThrow(BadRequestException);

    const all = await enrollmentsOf(userId);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ id: enrollmentId, status: 'active' });
  });

  it('leaves somebody else run alone', async () => {
    const { userId, enrollmentId } = await provisionedAthlete();
    const program = await createProgram();
    await trainedDay(userId, enrollmentId, '2026-09-14');
    const stranger = await provisionedAthlete();
    await trainedDay(stranger.userId, stranger.enrollmentId, '2026-09-14');

    await service().commit(userId, answers({ programId: program.id }), TODAY);

    expect(await enrollmentsOf(stranger.userId)).toEqual([
      expect.objectContaining({ id: stranger.enrollmentId, status: 'active' }),
    ]);
  });
});

/**
 * The rest pace, asked at the one moment the athlete commits (ADR 0005,
 * DN-143): required only of a program that leaves some rest unstated, and
 * prefilled so that it is rarely a question at all.
 */
describe('SetupService, the rest pace', () => {
  /**
   * A flexible program whose one straight-sets day rests as given, with the
   * unstated rests in the last of `weeks` -- every week is read, not only
   * the first the picker looks at.
   */
  async function restingProgram(
    rests: (number | null)[],
    { weeks = 1 }: { weeks?: number } = {},
  ) {
    return createProgram({
      weeks: {
        create: Array.from({ length: weeks }, (_, order) => ({
          order,
          phase: 'core',
          slots: {
            create: [
              {
                dayOfWeek: 3,
                kind: 'movements',
                movements: {
                  // Every week states its rest except the last, which is the
                  // one the program is silent in.
                  create: rests.map((restSeconds, i) => ({
                    order: i,
                    movementGroup: 'pull',
                    sets: 3,
                    reps: 5,
                    restSeconds: order === weeks - 1 ? restSeconds : 90,
                  })),
                },
              },
            ],
          },
        })),
      },
    });
  }

  it('asks nothing of a program that states rest everywhere', async () => {
    const { userId } = await provisionedAthlete();
    const program = await restingProgram([90, 0]);

    const options = await service().options(userId, TODAY);

    expect(options.programs.find((p) => p.id === program.id)).toMatchObject({
      hasStraightSets: true,
      restPaceRequired: false,
    });
    // Just WODs has no straight sets at all: no pace to offer, and nothing to
    // leave unstated.
    expect(
      options.programs.find((p) => p.id === DEFAULT_PROGRAM_ID),
    ).toMatchObject({ hasStraightSets: false, restPaceRequired: false });
  });

  it('requires a pace of a program with a hole in any week, not just the first', async () => {
    const { userId } = await provisionedAthlete();
    const program = await restingProgram([90, null], { weeks: 3 });

    const options = await service().options(userId, TODAY);

    expect(
      options.programs.find((p) => p.id === program.id)!.restPaceRequired,
    ).toBe(true);
  });

  it('prefills with the last pace the athlete set, skipping runs that set none', async () => {
    const { userId } = await provisionedAthlete();
    const program = await createProgram();
    await createEnrollment(userId, {
      programId: program.id,
      status: 'completed',
      defaultRestSeconds: 75,
    });
    // A later run on a program with its own rest set no pace, and says
    // nothing about how this athlete likes to rest.
    await createEnrollment(userId, {
      programId: program.id,
      status: 'completed',
      defaultRestSeconds: null,
    });

    expect((await service().options(userId, TODAY)).lastRestSeconds).toBe(75);
  });

  it('prefills nothing for an athlete who has never set a pace', async () => {
    const { userId } = await provisionedAthlete();

    expect((await service().options(userId, TODAY)).lastRestSeconds).toBeNull();
  });

  it('writes the pace onto the run', async () => {
    const { userId } = await provisionedAthlete();
    const program = await restingProgram([90]);

    await service().commit(
      userId,
      answers({ programId: program.id, defaultRestSeconds: 120 }),
      TODAY,
    );

    expect((await activeEnrollment(userId)).defaultRestSeconds).toBe(120);
  });

  it('refuses a blank pace for a program that leaves rest unstated, writing nothing', async () => {
    const { userId, enrollmentId } = await provisionedAthlete();
    const program = await restingProgram([90, null]);

    await expect(
      service().commit(
        userId,
        answers({ programId: program.id, defaultRestSeconds: null }),
        TODAY,
      ),
    ).rejects.toThrow(BadRequestException);
    const enrollment = await activeEnrollment(userId);
    expect(enrollment.id).toBe(enrollmentId);
    expect(enrollment.programId).toBe(DEFAULT_PROGRAM_ID);
  });

  it('takes a pace for a program that leaves rest unstated', async () => {
    const { userId } = await provisionedAthlete();
    const program = await restingProgram([null]);

    await service().commit(
      userId,
      answers({ programId: program.id, defaultRestSeconds: 60 }),
      TODAY,
    );

    expect(await activeEnrollment(userId)).toMatchObject({
      programId: program.id,
      defaultRestSeconds: 60,
    });
  });
});
