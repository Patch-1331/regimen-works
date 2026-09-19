import { resolveScheduleLock } from './schedule-lock';
import type { ActiveProgram, ProgramSlot } from './program-day';

/**
 * Whether a program is currently driving the athlete's week (DN-118).
 *
 * The dates are real weekdays and the tests say which: 2026-09-14 is a
 * Monday, so 09-21 is the Monday after it and 09-20 the Sunday between. A
 * lock that holds only because nobody checked the calendar is the bug these
 * cases exist to catch.
 */
const MONDAY = '2026-09-14';
const NEXT_MONDAY = '2026-09-21';
const WEEK_THREE = '2026-09-28';
const WEEK_FOUR = '2026-10-05';

function slot(overrides: Partial<ProgramSlot> = {}): ProgramSlot {
  return {
    id: `slot_${overrides.dayOfWeek ?? 1}`,
    dayOfWeek: 1,
    kind: 'wod_generated',
    wodId: null,
    pattern: null,
    wodType: null,
    allowNamed: false,
    maxTimeCapMinutes: null,
    ...overrides,
  };
}

/** A week that trains on `days` and rests on the rest of them. */
function week(days: number[], overrides: Record<string, unknown> = {}) {
  return {
    order: 0,
    phase: 'core',
    label: null,
    slots: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) =>
      slot({
        dayOfWeek,
        id: `slot_${dayOfWeek}`,
        kind: days.includes(dayOfWeek) ? 'wod_generated' : 'rest',
      }),
    ),
    ...overrides,
  };
}

function program(overrides: Partial<ActiveProgram> = {}): ActiveProgram {
  return {
    enrollmentId: 'enr_1',
    planId: 'plan_pull_up_builder',
    planName: 'Pull-Up Builder',
    scheduleMode: 'fixed',
    startDate: MONDAY,
    weeks: null,
    authoredWeeks: [week([1, 3, 5])],
    ...overrides,
  };
}

describe('resolveScheduleLock', () => {
  it('locks the week to a fixed program that is running', () => {
    expect(resolveScheduleLock(program(), MONDAY)).toEqual({
      planId: 'plan_pull_up_builder',
      planName: 'Pull-Up Builder',
      days: [1, 3, 5],
    });
  });

  it('leaves a flexible program alone, which is the ordinary case', () => {
    // Just WODs is flexible on purpose: DN-13 enrolled every athlete in it,
    // and a lock here would have taken everybody's schedule away at once.
    expect(
      resolveScheduleLock(program({ scheduleMode: 'flexible' }), MONDAY),
    ).toBeNull();
  });

  it('leaves an athlete with no enrollment alone', () => {
    expect(resolveScheduleLock(null, MONDAY)).toBeNull();
  });

  it('does not lock the week before the program starts', () => {
    // Enrolling on Thursday to start Monday is supported outright, and the
    // days in between are still the athlete's own (DN-11).
    expect(
      resolveScheduleLock(program({ startDate: NEXT_MONDAY }), MONDAY),
    ).toBeNull();
  });

  it('does not lock the week once the run is over', () => {
    // `getToday` retires the enrollment on the next request; reporting it as
    // locked in the meantime would be locking a week to a stopped program.
    expect(
      resolveScheduleLock(
        program({ weeks: 1, authoredWeeks: [week([1, 3, 5])] }),
        NEXT_MONDAY,
      ),
    ).toBeNull();
  });

  it('reports the week the athlete is in, not the first one', () => {
    // A deload week trains fewer days than the block around it. One answer
    // for the whole program would be wrong in every week but one.
    const lock = resolveScheduleLock(
      program({
        weeks: 3,
        authoredWeeks: [
          week([1, 3, 5]),
          week([1, 2, 3, 4, 5], { order: 1 }),
          week([2, 4], { order: 2, label: 'Deload' }),
        ],
      }),
      WEEK_THREE,
    );

    expect(lock?.days).toEqual([2, 4]);
  });

  it('expands a bounded run before counting weeks into it', () => {
    // A four-week run authored as one intro week and one core week is
    // intro, core, core, core -- so week 4 is the core week, not the end of
    // a two-week list. Reading the authored weeks straight would put the
    // athlete in week 4 of a program that has two, and report the intro
    // week's days forever after.
    const lock = resolveScheduleLock(
      program({
        weeks: 4,
        authoredWeeks: [
          week([1, 2, 3, 4, 5], { phase: 'intro' }),
          week([1, 3, 5], { order: 1 }),
        ],
      }),
      WEEK_FOUR,
    );

    expect(lock?.days).toEqual([1, 3, 5]);
  });

  it('reports the intro week while the athlete is still in it', () => {
    const lock = resolveScheduleLock(
      program({
        weeks: 4,
        authoredWeeks: [
          week([1, 2, 3, 4, 5], { phase: 'intro' }),
          week([1, 3, 5], { order: 1 }),
        ],
      }),
      MONDAY,
    );

    expect(lock?.days).toEqual([1, 2, 3, 4, 5]);
  });

  it('cycles the weeks of an open-ended fixed program', () => {
    const lock = resolveScheduleLock(
      program({
        weeks: null,
        authoredWeeks: [week([1, 3, 5]), week([2, 4], { order: 1 })],
      }),
      NEXT_MONDAY,
    );

    expect(lock?.days).toEqual([2, 4]);
  });

  it('counts an authored rest day as a day off, not a training day', () => {
    const lock = resolveScheduleLock(
      program({ authoredWeeks: [week([2, 4])] }),
      MONDAY,
    );

    expect(lock?.days).toEqual([2, 4]);
  });

  it('counts a weekday the week says nothing about as a day off too', () => {
    // "The author said rest" and "the author said nothing" are different
    // facts about the program (DN-11), and the settings screen has no use for
    // the difference: both are days the athlete is not expected.
    const lock = resolveScheduleLock(
      program({
        authoredWeeks: [
          {
            order: 0,
            phase: 'core',
            label: null,
            slots: [1, 4].map((dayOfWeek) => slot({ dayOfWeek })),
          },
        ],
      }),
      MONDAY,
    );

    expect(lock?.days).toEqual([1, 4]);
  });

  it('reports an all-rest week as no training days rather than as no lock', () => {
    // An athlete picking no days has no app, so `trainingDaysSchema` refuses
    // it. A program authoring a week of pure rest has made a coaching
    // decision, and the empty array is how it says so.
    expect(
      resolveScheduleLock(program({ authoredWeeks: [week([])] }), MONDAY),
    ).toEqual({
      planId: 'plan_pull_up_builder',
      planName: 'Pull-Up Builder',
      days: [],
    });
  });

  it('reports the days in ascending order whatever order they were authored', () => {
    const lock = resolveScheduleLock(
      program({
        authoredWeeks: [
          {
            order: 0,
            phase: 'core',
            label: null,
            slots: [5, 1, 3].map((dayOfWeek) => slot({ dayOfWeek })),
          },
        ],
      }),
      MONDAY,
    );

    expect(lock?.days).toEqual([1, 3, 5]);
  });
});
