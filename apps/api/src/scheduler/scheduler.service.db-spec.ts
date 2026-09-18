import type { PrismaService } from '../prisma/prisma.service';
import { testPrisma } from '../test-support/database';
import {
  createEnrollment,
  createPlan,
  createUser,
  createWod,
} from '../test-support/fixtures';
import { MovementResolutionService } from './movement-resolution.service';
import { SchedulerService } from './scheduler.service';
import { WodsService } from '../wods/wods.service';

/**
 * `getToday` resolving the day through the active enrollment (DN-16).
 *
 * Against a real database rather than a mocked client, because almost
 * everything this change decides is a fact about rows: which enrollment is
 * active, what the authored week says about this weekday, which columns the
 * new assignment carries, and whether a finished run is still active
 * afterwards. A mock would assert that Prisma was called and leave every one
 * of those unanswered.
 *
 * `scheduler.service.ts` had no coverage of its own before this. It was a
 * Test Coverage item, moved onto this issue on purpose: tests written to the
 * shape the scheduler had yesterday would have been rewritten today.
 */

// 2026-09-14 is a Monday, so 09-19 is the Saturday of that same week and
// 09-21 the Monday after. Every date below is a weekday somebody checked.
const MONDAY = '2026-09-14';
const SATURDAY = '2026-09-19';
const NEXT_MONDAY = '2026-09-21';

function service(): SchedulerService {
  const prisma = testPrisma() as unknown as PrismaService;
  return new SchedulerService(
    prisma,
    new WodsService(prisma),
    new MovementResolutionService(prisma),
    // Pinned, so a failure is about the day the program chose rather than
    // about which of two equally valid WODs the draw landed on (DN-119).
    () => 0,
  );
}

/** An athlete who trains Mon–Fri, stated rather than defaulted. */
async function athlete(trainingDays = [1, 2, 3, 4, 5]) {
  const user = await createUser();
  await testPrisma().scheduleRule.create({
    data: { userId: user.id, trainingDays },
  });
  return user;
}

/** A plan whose single core week authors `kind` on every weekday. */
async function everyDayPlan(
  kind: string,
  slotOverrides: Record<string, unknown> = {},
  planOverrides: Record<string, unknown> = {},
) {
  return createPlan({
    ...planOverrides,
    weeks: {
      create: [
        {
          order: 0,
          phase: 'core',
          slots: {
            create: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
              dayOfWeek,
              kind,
              ...slotOverrides,
            })),
          },
        },
      ],
    },
  });
}

describe('SchedulerService.getToday, under a program', () => {
  it('keeps the pre-programs behaviour for an athlete with no enrollment', async () => {
    // The floor this whole change has to stand on: nothing about an athlete
    // who has never touched a program may move.
    const user = await athlete();
    await createWod();

    const today = await service().getToday(user.id, MONDAY);

    expect(today.plan).toBeNull();
    expect(today.isRestDay).toBe(false);
    expect(today.assignment).not.toBeNull();
  });

  it('still rests on a day the athlete does not train, with no enrollment', async () => {
    const user = await athlete();

    const today = await service().getToday(user.id, SATURDAY);

    expect(today).toMatchObject({
      isRestDay: true,
      assignment: null,
      plan: null,
    });
  });

  it('defers to the athlete’s training days on a flexible program', async () => {
    // Just WODs is exactly this shape: seven authored days, flexible, so the
    // athlete's own schedule still decides. If this failed, enrolling
    // everyone in DN-13 would have silently turned every day into a training
    // day for every athlete in the app.
    const user = await athlete();
    const plan = await everyDayPlan('wod_generated', { allowNamed: true });
    await createEnrollment(user.id, {
      planId: plan.id,
      startDate: MONDAY,
      weeks: null,
    });
    await createWod();

    const saturday = await service().getToday(user.id, SATURDAY);

    expect(saturday.isRestDay).toBe(true);
    // The program is still context even on a day it is not running: the
    // athlete is in week 1 of it whether or not they train on Saturday.
    expect(saturday.plan).toMatchObject({ name: plan.name, week: 1 });
    // Null rather than the slot's own kind -- the day is off because the
    // athlete said so, not because the program planned a rest.
    expect(saturday.plan?.slotKind).toBeNull();
  });

  it('overrides them on a fixed program, whose slots are the schedule', async () => {
    const user = await athlete();
    const plan = await everyDayPlan(
      'wod_generated',
      { allowNamed: true },
      { scheduleMode: 'fixed', minDaysPerWeek: null, maxDaysPerWeek: null },
    );
    await createEnrollment(user.id, {
      planId: plan.id,
      startDate: MONDAY,
      weeks: null,
    });
    await createWod();

    const saturday = await service().getToday(user.id, SATURDAY);

    expect(saturday.isRestDay).toBe(false);
    expect(saturday.assignment).not.toBeNull();
  });

  it('rests on an authored rest day, and says the program planned it', async () => {
    const user = await athlete();
    const plan = await everyDayPlan('rest');
    await createEnrollment(user.id, {
      planId: plan.id,
      startDate: MONDAY,
      weeks: null,
    });

    const today = await service().getToday(user.id, MONDAY);

    expect(today.isRestDay).toBe(true);
    expect(today.plan?.slotKind).toBe('rest');
  });

  it('trains the WOD the program pinned', async () => {
    const user = await athlete();
    const pinned = await createWod({ name: 'Fran', isNamed: true });
    // A second WOD in the library, so passing cannot be an accident of there
    // being only one thing to pick.
    await createWod({ name: 'Cindy' });
    const plan = await everyDayPlan('wod_pinned', { wodId: pinned.id });
    await createEnrollment(user.id, {
      planId: plan.id,
      startDate: MONDAY,
      weeks: null,
    });

    const today = await service().getToday(user.id, MONDAY);

    expect(today.assignment?.wod.id).toBe(pinned.id);
    expect(today.plan?.slotKind).toBe('wod_pinned');
  });

  it('honours a generated slot’s pattern', async () => {
    const user = await athlete();
    await createWod({ name: 'Push day', dominantPattern: 'push' });
    const pull = await createWod({ name: 'Pull day', dominantPattern: 'pull' });
    const plan = await everyDayPlan('wod_generated', {
      pattern: 'pull',
      allowNamed: true,
    });
    await createEnrollment(user.id, {
      planId: plan.id,
      startDate: MONDAY,
      weeks: null,
    });

    const today = await service().getToday(user.id, MONDAY);

    expect(today.assignment?.wod.id).toBe(pull.id);
  });

  it('keeps a named WOD off a slot that did not ask for one', async () => {
    // `allowNamed` defaults false for a reason: a benchmark landing in the
    // middle of a progression block is the surprise that default prevents.
    const user = await athlete();
    await createWod({ name: 'Fran', isNamed: true, dominantPattern: 'pull' });
    const plain = await createWod({ name: 'Plain', dominantPattern: 'pull' });
    const plan = await everyDayPlan('wod_generated', { pattern: 'pull' });
    await createEnrollment(user.id, {
      planId: plan.id,
      startDate: MONDAY,
      weeks: null,
    });

    const today = await service().getToday(user.id, MONDAY);

    expect(today.assignment?.wod.id).toBe(plain.id);
  });

  it('records which slot of which run produced the day', async () => {
    // The three columns exist so History and the completion card can say "day
    // 17 of 24" without recomputing a date difference per row.
    const user = await athlete();
    const plan = await everyDayPlan('wod_generated', { allowNamed: true });
    const enrollment = await createEnrollment(user.id, {
      planId: plan.id,
      startDate: MONDAY,
      weeks: null,
    });
    await createWod();

    await service().getToday(user.id, NEXT_MONDAY);

    const stored = await testPrisma().dailyAssignment.findFirstOrThrow({
      where: { userId: user.id, date: NEXT_MONDAY },
    });
    expect(stored.enrollmentId).toBe(enrollment.id);
    expect(stored.planDayIndex).toBe(7);
    expect(stored.planSlotId).not.toBeNull();
  });

  it('leaves the plan columns null on a day no program produced', async () => {
    const user = await athlete();
    await createWod();

    await service().getToday(user.id, MONDAY);

    const stored = await testPrisma().dailyAssignment.findFirstOrThrow({
      where: { userId: user.id, date: MONDAY },
    });
    expect(stored.enrollmentId).toBeNull();
    expect(stored.planSlotId).toBeNull();
    expect(stored.planDayIndex).toBeNull();
  });

  it('counts the athlete’s week from one', async () => {
    const user = await athlete();
    const plan = await everyDayPlan('wod_generated', { allowNamed: true });
    await createEnrollment(user.id, {
      planId: plan.id,
      startDate: MONDAY,
      weeks: null,
    });
    await createWod();

    const today = await service().getToday(user.id, NEXT_MONDAY);

    expect(today.plan).toMatchObject({ week: 2, totalWeeks: null });
  });
});

describe('SchedulerService.getToday, at the edges of a run', () => {
  it('falls back before the start date without touching the enrollment', async () => {
    // How enrolling on Thursday to start Monday works: one active
    // enrollment, and the days in between are ordinary Just WODs days.
    const user = await athlete();
    const plan = await everyDayPlan('rest');
    const enrollment = await createEnrollment(user.id, {
      planId: plan.id,
      startDate: NEXT_MONDAY,
      weeks: 4,
    });
    await createWod();

    const today = await service().getToday(user.id, MONDAY);

    expect(today.plan).toBeNull();
    // A rest-authored program did not make today a rest day, because it has
    // not started: the athlete trains.
    expect(today.assignment).not.toBeNull();
    expect(
      await testPrisma().planEnrollment.findUniqueOrThrow({
        where: { id: enrollment.id },
      }),
    ).toMatchObject({ status: 'active', completedAt: null });
  });

  it('completes a run past its last day and falls back the same request', async () => {
    // Completed on read rather than by a nightly job: the day a program ends
    // is a day the athlete opens Today, and nobody needs the row flipped
    // before then.
    const user = await athlete();
    const plan = await everyDayPlan('rest');
    const enrollment = await createEnrollment(user.id, {
      planId: plan.id,
      startDate: MONDAY,
      weeks: 1,
    });
    await createWod();

    const today = await service().getToday(user.id, NEXT_MONDAY);

    expect(
      await testPrisma().planEnrollment.findUniqueOrThrow({
        where: { id: enrollment.id },
      }),
    ).toMatchObject({ status: 'completed' });
    expect(today.plan).toBeNull();
    // The rest-authored program no longer decides the day, so the athlete's
    // own training days do: Monday is one.
    expect(today.assignment).not.toBeNull();
  });

  it('is unchanged by a second request once the run has completed', async () => {
    const user = await athlete();
    const plan = await everyDayPlan('rest');
    const enrollment = await createEnrollment(user.id, {
      planId: plan.id,
      startDate: MONDAY,
      weeks: 1,
    });
    await createWod();
    await service().getToday(user.id, NEXT_MONDAY);
    const completedAt = (
      await testPrisma().planEnrollment.findUniqueOrThrow({
        where: { id: enrollment.id },
      })
    ).completedAt;

    await service().getToday(user.id, NEXT_MONDAY);

    // `updateMany` is scoped to active rows, so the second pass cannot
    // re-stamp a completion the athlete already has.
    expect(
      await testPrisma().planEnrollment.findUniqueOrThrow({
        where: { id: enrollment.id },
      }),
    ).toMatchObject({ completedAt });
  });

  it('ignores an enrollment that is not active', async () => {
    const user = await athlete();
    const plan = await everyDayPlan('rest');
    await createEnrollment(user.id, {
      planId: plan.id,
      startDate: MONDAY,
      weeks: null,
      status: 'completed',
    });
    await createWod();

    const today = await service().getToday(user.id, MONDAY);

    expect(today.plan).toBeNull();
    expect(today.assignment).not.toBeNull();
  });

  it('reports the program alongside a day already decided', async () => {
    // The plan block is recomputed rather than read off the stored row, so it
    // is there on the second visit of the day too.
    const user = await athlete();
    const plan = await everyDayPlan('wod_generated', { allowNamed: true });
    await createEnrollment(user.id, {
      planId: plan.id,
      startDate: MONDAY,
      weeks: null,
    });
    await createWod();
    await service().getToday(user.id, MONDAY);

    const again = await service().getToday(user.id, MONDAY);

    expect(again.plan).toMatchObject({ name: plan.name, week: 1 });
    expect(again.assignment).not.toBeNull();
  });
});

describe('SchedulerService.skipToday', () => {
  it('keeps reporting the program the athlete is still on', async () => {
    // Skipping a day is not leaving the program, so the strip that says which
    // week they are in is still true afterwards.
    const user = await athlete();
    const plan = await everyDayPlan('wod_generated', { allowNamed: true });
    await createEnrollment(user.id, {
      planId: plan.id,
      startDate: MONDAY,
      weeks: null,
    });

    const skipped = await service().skipToday(user.id, MONDAY);

    expect(skipped.isRestDay).toBe(true);
    expect(skipped.plan).toMatchObject({ name: plan.name, week: 1 });
  });

  it('reports no program for an athlete who has none', async () => {
    const user = await athlete();

    expect((await service().skipToday(user.id, MONDAY)).plan).toBeNull();
  });
});
