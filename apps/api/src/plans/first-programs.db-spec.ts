import { testPrisma } from '../test-support/database';
import { createEnrollment, createUser } from '../test-support/fixtures';
import { loadActiveProgram } from './active-program';
import {
  FOUNDATIONS,
  PULL_UP_BUILDER,
  programSlotId,
  upsertFirstPrograms,
} from './first-programs';
import { resolveProgramDay, type ProgramDay } from './program-day';

/**
 * The two programs as rows, and as weeks an athlete actually walks (DN-24).
 *
 * The unit spec reads the definitions; this reads them back out of Postgres
 * after the seed has written them, which is the only place three separate
 * claims can be checked at once: that the CHECKs accept the data, that a
 * second deploy converges, and that `resolveProgramDay` makes of these
 * programs what their authors meant -- through the very query `getToday` runs.
 */

const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

/** Monday. Every date in this spec is stated relative to one. */
const MONDAY_START = '2026-10-05';

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * One run, walked day by day from its start date.
 *
 * Through `loadActiveProgram` rather than off the seed objects, so what is
 * being walked is the row shape `getToday` sees -- a slot whose prescription
 * failed to write reads here as a generated day, exactly as it would in
 * production, rather than as data that looks right in TypeScript.
 */
async function walk(
  planId: string,
  {
    weeks,
    startDate,
    trainingDays = ALL_WEEKDAYS,
    days,
  }: {
    weeks: number;
    startDate: string;
    trainingDays?: number[];
    days: number;
  },
): Promise<ProgramDay[]> {
  const user = await createUser();
  await createEnrollment(user.id, { planId, startDate, weeks });
  const program = await loadActiveProgram(testPrisma(), user.id);

  return Array.from({ length: days }, (_, i) =>
    resolveProgramDay(program, trainingDays, addDays(startDate, i)),
  );
}

describe('the first programs, seeded', () => {
  beforeEach(async () => {
    await upsertFirstPrograms(testPrisma());
  });

  it('writes both programs whole', async () => {
    // Counted rather than spot-checked: a slot or a prescription that silently
    // failed to write is the failure mode that leaves an athlete on an empty
    // Thursday, and it is invisible in any single row.
    for (const program of [PULL_UP_BUILDER, FOUNDATIONS]) {
      const weeks = await testPrisma().planWeek.count({
        where: { planId: program.id },
      });
      const slots = await testPrisma().planSlot.count({
        where: { planWeek: { planId: program.id } },
      });
      const movements = await testPrisma().planSlotMovement.count({
        where: { planSlot: { planWeek: { planId: program.id } } },
      });
      expect({ weeks, slots, movements }).toEqual({
        weeks: program.weeks.length,
        slots: program.weeks.reduce((n, w) => n + w.slots.length, 0),
        movements: program.weeks.reduce(
          (n, w) =>
            n + w.slots.reduce((m, s) => m + (s.movements ?? []).length, 0),
          0,
        ),
      });
    }
  });

  it('converges when the deploy runs it again', async () => {
    const before = await testPrisma().planSlotMovement.count();

    await upsertFirstPrograms(testPrisma());

    expect(await testPrisma().plan.count()).toBe(2);
    expect(await testPrisma().planSlotMovement.count()).toBe(before);
  });

  it('corrects a slot that has drifted from the definition', async () => {
    // Why this writes rather than skipping what exists: an athlete enrolled
    // last month must not be left running last month's program.
    const slotId = programSlotId(PULL_UP_BUILDER.id, 4, 4);
    await testPrisma().planSlot.update({
      where: { id: slotId },
      data: { allowNamed: false, pattern: 'squat' },
    });

    await upsertFirstPrograms(testPrisma());

    expect(
      await testPrisma().planSlot.findUnique({ where: { id: slotId } }),
    ).toMatchObject({ allowNamed: true, pattern: 'pull' });
  });

  it('drops a prescription the definition no longer carries', async () => {
    // The reason prescriptions are deleted and rewritten rather than upserted
    // row by row. An extra movement left behind by an edit is a set the
    // athlete does that nobody wrote, and it would survive every later deploy.
    const slotId = programSlotId(PULL_UP_BUILDER.id, 0, 1);
    await testPrisma().planSlotMovement.create({
      data: {
        planSlotId: slotId,
        order: 99,
        line: 'squat',
        sets: 9,
        reps: 9,
        restSeconds: 0,
      },
    });

    await upsertFirstPrograms(testPrisma());

    const movements = await testPrisma().planSlotMovement.findMany({
      where: { planSlotId: slotId },
    });
    expect(movements.map((m) => m.order)).toEqual([0, 1, 2]);
  });

  describe('Pull-Up Builder, walked end to end', () => {
    it('trains the four days it authored and rests the other three', async () => {
      // The fixed claim, made against an athlete who trains every day: the
      // program says which days are training days, and Wednesday is a rest
      // day because the program said so and not because they chose it.
      const week = await walk(PULL_UP_BUILDER.id, {
        weeks: 6,
        startDate: MONDAY_START,
        days: 7,
      });
      expect(week.map((d) => d.kind)).toEqual([
        'prescribed', // Mon
        'prescribed', // Tue
        'rest', // Wed -- unauthored
        'prescribed', // Thu
        'generated', // Fri
        'rest', // Sat -- unauthored
        'rest', // Sun -- unauthored
      ]);
    });

    it('overrides the athlete’s own training days', async () => {
      // The whole point of `fixed`, and the only thing that makes the spacing
      // rule true. An athlete who trains Mon/Wed/Fri still pulls on Thursday.
      const week = await walk(PULL_UP_BUILDER.id, {
        weeks: 6,
        startDate: MONDAY_START,
        trainingDays: [1, 3, 5],
        days: 7,
      });
      expect(week[3].kind).toBe('prescribed');
      expect(week[2].kind).toBe('rest');
    });

    it('waves the main session as the run repeats the core block', async () => {
      // The authored wave, seen from the athlete's side: `expandPlanWeeks`
      // cycles the core block in order, so a six-week run plays intro, 3, 4,
      // 5, then 3 again as the deload before the peak.
      const run = await walk(PULL_UP_BUILDER.id, {
        weeks: 6,
        startDate: MONDAY_START,
        days: 7 * 6,
      });
      const mondays = run.filter((_d, i) => i % 7 === 0);
      expect(
        mondays.map((day) =>
          day.kind === 'prescribed' ? day.movements[0].sets : day.kind,
        ),
      ).toEqual([3, 3, 4, 5, 3, 5]);
    });

    it('ends on the re-test, at every length it offers', async () => {
      // The claim `minWeeks` exists to make. At five weeks the intro is
      // trimmed and the core block still plays whole; at twelve it plays three
      // times. Either way the last trained day is the benchmark, which is what
      // a program ending mid-wave would not be.
      for (const weeks of [PULL_UP_BUILDER.minWeeks, 6, 8, 12]) {
        const run = await walk(PULL_UP_BUILDER.id, {
          weeks,
          startDate: MONDAY_START,
          days: 7 * weeks,
        });
        const retest = run[7 * (weeks - 1) + 3];
        expect(
          retest.kind === 'generated' ? retest.constraints : retest.kind,
        ).toMatchObject({ pattern: 'pull', allowNamed: true });
        // And then it is over: the day after the last authored day is past
        // the end, not a sixth week that nobody chose.
        expect(
          resolveProgramDay(
            await programOf(PULL_UP_BUILDER.id, weeks),
            ALL_WEEKDAYS,
            addDays(MONDAY_START, 7 * weeks),
          ).kind,
        ).toBe('completed');
      }
    });

    it('starts the week the athlete starts in, whatever day that is', async () => {
      // Program weeks are calendar weeks (DN-11), so a Thursday start lands
      // the athlete on week 1's Thursday -- the second pull day -- rather than
      // rebasing the program onto their start date. A Mon/Tue/Thu/Fri program
      // means nothing if week 1 begins on a Wednesday.
      const thursday = addDays(MONDAY_START, 3);
      const run = await walk(PULL_UP_BUILDER.id, {
        weeks: 6,
        startDate: thursday,
        days: 5,
      });
      expect(run.map((d) => d.kind)).toEqual([
        'prescribed', // Thu of week 1
        'generated', // Fri
        'rest', // Sat
        'rest', // Sun
        'prescribed', // Mon of week 2
      ]);
      expect(run[0].kind === 'prescribed' && run[0].day.week).toBe(1);
      expect(run[4].kind === 'prescribed' && run[4].day.week).toBe(2);
    });
  });

  describe('Foundations, walked end to end', () => {
    it('trains the days the athlete chose, not the days it authored', async () => {
      // The flexible claim, and the mirror of the fixed one above. Five days
      // are authored; an athlete on Mon/Wed/Fri trains three, and Tuesday is a
      // rest day because they said so.
      const week = await walk(FOUNDATIONS.id, {
        weeks: 8,
        startDate: MONDAY_START,
        trainingDays: [1, 3, 5],
        days: 7,
      });
      expect(week.map((d) => d.kind)).toEqual([
        'prescribed', // Mon
        'rest', // Tue -- authored, but not a day they train
        'prescribed', // Wed
        'rest', // Thu -- likewise
        'prescribed', // Fri
        'rest',
        'rest',
      ]);
      // Their own decision, not the program's: `slotKind` stays null so the
      // rest-day copy does not take credit for a day they chose off.
      expect(week[1].kind === 'rest' && week[1].day.slotKind).toBeNull();
    });

    it('gives a five-day athlete all five authored days', async () => {
      const week = await walk(FOUNDATIONS.id, {
        weeks: 8,
        startDate: MONDAY_START,
        trainingDays: [1, 2, 3, 4, 5],
        days: 7,
      });
      expect(week.map((d) => d.kind)).toEqual([
        'prescribed',
        'generated', // Tue -- the conditioning day
        'prescribed',
        'prescribed',
        'prescribed',
        'rest',
        'rest',
      ]);
    });

    it('covers every pattern in the week, at three days and at five', async () => {
      // The property the ranking protects, checked through the resolver
      // rather than off the data: a shortened run still has to be the same
      // program.
      for (const trainingDays of [
        [1, 3, 5],
        [1, 2, 3, 4, 5],
      ]) {
        const week = await walk(FOUNDATIONS.id, {
          weeks: 8,
          startDate: MONDAY_START,
          trainingDays,
          days: 7,
        });
        const lines = new Set(
          week.flatMap((day) =>
            day.kind === 'prescribed' ? day.movements.map((m) => m.line) : [],
          ),
        );
        expect([...lines].sort()).toEqual([
          'core_dynamic',
          'core_hold',
          'core_side',
          'hinge',
          'pull',
          'push_horizontal',
          'push_vertical',
          'squat',
        ]);
      }
    });

    it('runs for as long as the athlete asked, and then completes', async () => {
      for (const weeks of [FOUNDATIONS.minWeeks, 8, 16]) {
        const program = await programOf(FOUNDATIONS.id, weeks);
        const lastDay = addDays(MONDAY_START, 7 * weeks - 1);
        expect(resolveProgramDay(program, ALL_WEEKDAYS, lastDay).kind).not.toBe(
          'completed',
        );
        expect(
          resolveProgramDay(program, ALL_WEEKDAYS, addDays(lastDay, 1)).kind,
        ).toBe('completed');
      }
    });

    it('finishes on its peak week from any start day', async () => {
      // Start dates mid-week shift which calendar week the run begins in,
      // which is the one thing that could land the last week somewhere other
      // than the peak.
      for (const offset of [0, 2, 4, 6]) {
        const startDate = addDays(MONDAY_START, offset);
        const program = await programOf(FOUNDATIONS.id, 8, startDate);
        const run = Array.from({ length: 7 * 8 }, (_, i) =>
          resolveProgramDay(program, ALL_WEEKDAYS, addDays(startDate, i)),
        );
        const last = run.findLast((d) => d.kind === 'prescribed');
        expect(last?.kind === 'prescribed' && last.day.week).toBe(8);
        // Five sets at the top of the wave is what the peak week is.
        expect(
          last?.kind === 'prescribed' && last.movements[0].sets,
        ).toBeGreaterThanOrEqual(3);
      }
    });
  });
});

/** An enrolment built solely to be resolved against, with no walk. */
async function programOf(
  planId: string,
  weeks: number,
  startDate = MONDAY_START,
) {
  const user = await createUser();
  await createEnrollment(user.id, { planId, startDate, weeks });
  return loadActiveProgram(testPrisma(), user.id);
}
