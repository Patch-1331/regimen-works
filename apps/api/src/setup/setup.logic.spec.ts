import type { CommitSetup } from '@regimen-works/shared';
import { fixedDaysOf, setupRejection, startDateRange } from './setup.logic';
import type { SetupPlanBounds, StartDateRange } from './setup.logic';

/**
 * The wizard's rules (DN-15).
 *
 * These are the sentences an athlete reads when an answer will not do, so
 * they are checked as sentences rather than as booleans -- a rule that says
 * "invalid" is a rule that has told the athlete nothing they can act on.
 */

const FLEXIBLE: SetupPlanBounds = {
  name: 'Pull-Up Builder',
  scheduleMode: 'flexible',
  minDaysPerWeek: 3,
  maxDaysPerWeek: 5,
  minWeeks: 4,
  maxWeeks: 8,
};

const FIXED: SetupPlanBounds = {
  name: 'Bar Muscle-Up',
  scheduleMode: 'fixed',
  minDaysPerWeek: null,
  maxDaysPerWeek: null,
  minWeeks: 6,
  maxWeeks: 6,
};

const OPEN_ENDED: SetupPlanBounds = {
  name: 'Just WODs',
  scheduleMode: 'flexible',
  minDaysPerWeek: 1,
  maxDaysPerWeek: 7,
  minWeeks: null,
  maxWeeks: null,
};

/** Three weeks starting the day they were asked, nothing trained yet. */
const RANGE = startDateRange('2026-09-19', false);

function answers(overrides: Partial<CommitSetup> = {}): CommitSetup {
  return {
    planId: 'plan-1',
    trainingDays: [1, 3, 5],
    weeks: 6,
    startDate: '2026-09-19',
    ...overrides,
  };
}

describe('startDateRange', () => {
  it('starts today while today has not been trained', () => {
    // The point of the whole rule: an athlete setting the app up this
    // morning should be training this morning, not tomorrow.
    expect(startDateRange('2026-09-19', false).earliestStartDate).toBe(
      '2026-09-19',
    );
  });

  it('starts tomorrow once today has been touched', () => {
    // Committing today discards today's assignment, so offering today here
    // would be offering to delete the session the athlete is in.
    expect(startDateRange('2026-09-19', true).earliestStartDate).toBe(
      '2026-09-20',
    );
  });

  it('offers three weeks, counting the earliest as the first', () => {
    const range = startDateRange('2026-09-19', false);
    expect(range.latestStartDate).toBe('2026-10-09');
  });

  it('measures the three weeks from the earliest date, not from today', () => {
    // Otherwise an athlete who trained this morning gets twenty days rather
    // than twenty-one, and the grid comes up a day short of a whole week.
    const range = startDateRange('2026-09-19', true);
    expect(range.earliestStartDate).toBe('2026-09-20');
    expect(range.latestStartDate).toBe('2026-10-10');
  });

  it('crosses a month end', () => {
    expect(startDateRange('2026-09-30', false).earliestStartDate).toBe(
      '2026-09-30',
    );
    expect(startDateRange('2026-09-30', true).earliestStartDate).toBe(
      '2026-10-01',
    );
  });
});

describe('fixedDaysOf', () => {
  const week = (order: number, days: number[]) => ({
    order,
    slots: days.map((dayOfWeek) => ({ dayOfWeek, kind: 'movements' })),
  });

  it('reads the days out of a fixed program first week', () => {
    expect(
      fixedDaysOf({ scheduleMode: 'fixed', weeks: [week(0, [1, 2, 4, 5])] }),
    ).toEqual([1, 2, 4, 5]);
  });

  it('leaves out the days the program authored as rest', () => {
    // A rest slot is the program deciding the athlete does not train that
    // day, which belongs out of this list as squarely as a weekday the week
    // never mentions.
    expect(
      fixedDaysOf({
        scheduleMode: 'fixed',
        weeks: [
          {
            order: 0,
            slots: [
              { dayOfWeek: 1, kind: 'movements' },
              { dayOfWeek: 2, kind: 'rest' },
              { dayOfWeek: 3, kind: 'wod_generated' },
            ],
          },
        ],
      }),
    ).toEqual([1, 3]);
  });

  it('answers with the first authored week where the weeks disagree', () => {
    // A deload week can train fewer days than the block around it, and the
    // week the athlete is about to live is week one.
    expect(
      fixedDaysOf({
        scheduleMode: 'fixed',
        weeks: [week(1, [1, 3]), week(0, [1, 2, 4, 5])],
      }),
    ).toEqual([1, 2, 4, 5]);
  });

  it('sorts the days and never repeats one', () => {
    // Two slots on one weekday is a double session, not two training days.
    expect(
      fixedDaysOf({ scheduleMode: 'fixed', weeks: [week(0, [5, 1, 5, 3])] }),
    ).toEqual([1, 3, 5]);
  });

  it('has no answer for a flexible program', () => {
    // Its days are the athlete's. `defaultDays` is where it suggests some,
    // and reporting its slots here would read as days it had fixed.
    expect(
      fixedDaysOf({ scheduleMode: 'flexible', weeks: [week(0, [1, 3, 5])] }),
    ).toEqual([]);
  });

  it('has no answer for a program with no weeks authored yet', () => {
    expect(fixedDaysOf({ scheduleMode: 'fixed', weeks: [] })).toEqual([]);
  });
});

describe('setupRejection: training days', () => {
  it('accepts a day count inside the program bounds', () => {
    expect(setupRejection(FLEXIBLE, answers(), RANGE)).toBeNull();
  });

  it('names the program and the number when there are too few days', () => {
    expect(
      setupRejection(FLEXIBLE, answers({ trainingDays: [2] }), RANGE),
    ).toBe('Pull-Up Builder needs at least 3 days a week.');
  });

  it('names the program and the number when there are too many', () => {
    expect(
      setupRejection(
        FLEXIBLE,
        answers({ trainingDays: [1, 2, 3, 4, 5, 6] }),
        RANGE,
      ),
    ).toBe('Pull-Up Builder runs at most 5 days a week.');
  });

  it('refuses one day short of the minimum', () => {
    // The boundary, not a number well outside it: a bound that let two days
    // through on a three-day program would be a program running at a cadence
    // it was not written for, and every "too few" test above would still
    // pass.
    expect(
      setupRejection(FLEXIBLE, answers({ trainingDays: [1, 3] }), RANGE),
    ).toBe('Pull-Up Builder needs at least 3 days a week.');
  });

  it('refuses one day past the maximum', () => {
    expect(
      setupRejection(
        FLEXIBLE,
        answers({ trainingDays: [1, 2, 3, 4, 5, 6] }),
        RANGE,
      ),
    ).toBe('Pull-Up Builder runs at most 5 days a week.');
  });

  it('accepts the bounds themselves', () => {
    // Off-by-one here is a program refusing the cadence it advertises.
    expect(
      setupRejection(FLEXIBLE, answers({ trainingDays: [1, 3, 5] }), RANGE),
    ).toBeNull();
    expect(
      setupRejection(
        FLEXIBLE,
        answers({ trainingDays: [1, 2, 3, 4, 5] }),
        RANGE,
      ),
    ).toBeNull();
  });

  it('says "day" rather than "days" where the bound is one', () => {
    expect(
      setupRejection(
        { ...OPEN_ENDED, minDaysPerWeek: 1, maxDaysPerWeek: 1 },
        answers({ trainingDays: [1, 3], weeks: null }),
        RANGE,
      ),
    ).toBe('Just WODs runs at most 1 day a week.');
  });

  it('asks a flexible program for days it was not given', () => {
    expect(
      setupRejection(FLEXIBLE, answers({ trainingDays: null }), RANGE),
    ).toBe('Pick the days you train.');
  });

  it('takes no days for a fixed program, whose slots are the schedule', () => {
    expect(
      setupRejection(FIXED, answers({ trainingDays: null, weeks: 6 }), RANGE),
    ).toBeNull();
  });

  it('refuses days sent for a fixed program rather than ignoring them', () => {
    // Storing nothing and answering 200 would leave the client right about
    // the request and wrong about the week.
    expect(
      setupRejection(FIXED, answers({ trainingDays: [1, 3], weeks: 6 }), RANGE),
    ).toBe(
      'Bar Muscle-Up sets its own training days, so there are none to choose.',
    );
  });
});

describe('setupRejection: length', () => {
  it('accepts a length inside the program bounds', () => {
    expect(setupRejection(FLEXIBLE, answers({ weeks: 4 }), RANGE)).toBeNull();
    expect(setupRejection(FLEXIBLE, answers({ weeks: 8 }), RANGE)).toBeNull();
  });

  it('names the range when the length falls outside it', () => {
    expect(setupRejection(FLEXIBLE, answers({ weeks: 9 }), RANGE)).toBe(
      'Pull-Up Builder runs for between 4 and 8 weeks.',
    );
    expect(setupRejection(FLEXIBLE, answers({ weeks: 3 }), RANGE)).toBe(
      'Pull-Up Builder runs for between 4 and 8 weeks.',
    );
  });

  it('asks a program that has a length for one', () => {
    expect(setupRejection(FLEXIBLE, answers({ weeks: null }), RANGE)).toBe(
      'Choose how many weeks to run Pull-Up Builder for.',
    );
  });

  it('takes no length for an open-ended program', () => {
    expect(
      setupRejection(
        OPEN_ENDED,
        answers({ weeks: null, trainingDays: [1, 3, 5] }),
        RANGE,
      ),
    ).toBeNull();
  });

  it('refuses a length on an open-ended program', () => {
    // A number here is a completion date for something that never completes.
    expect(
      setupRejection(
        OPEN_ENDED,
        answers({ weeks: 6, trainingDays: [1, 3, 5] }),
        RANGE,
      ),
    ).toBe('Just WODs has no end, so there is no length to choose.');
  });
});

describe('setupRejection: start date', () => {
  it('accepts the earliest date offered', () => {
    expect(
      setupRejection(FLEXIBLE, answers({ startDate: '2026-09-19' }), RANGE),
    ).toBeNull();
  });

  it('accepts the last date offered', () => {
    expect(
      setupRejection(FLEXIBLE, answers({ startDate: '2026-10-09' }), RANGE),
    ).toBeNull();
  });

  it('refuses a date past the end of the range', () => {
    expect(
      setupRejection(FLEXIBLE, answers({ startDate: '2026-10-10' }), RANGE),
    ).toBe('Pick a start date within the next three weeks.');
  });

  it('refuses a date in the past', () => {
    expect(
      setupRejection(FLEXIBLE, answers({ startDate: '2026-09-18' }), RANGE),
    ).toBe('That start date has already passed.');
  });

  it('explains that today is spoken for when today has been trained', () => {
    // The same comparison as the one above and a completely different
    // sentence: the athlete did not pick a stale date, they picked a day the
    // app has already spent.
    const touched: StartDateRange = startDateRange('2026-09-19', true);
    expect(
      setupRejection(FLEXIBLE, answers({ startDate: '2026-09-19' }), touched),
    ).toBe(
      "Today's workout is already under way, so the earliest you can start is tomorrow.",
    );
  });

  it('still calls a genuinely past date past, on a touched day', () => {
    const touched = startDateRange('2026-09-19', true);
    expect(
      setupRejection(FLEXIBLE, answers({ startDate: '2026-09-18' }), touched),
    ).toBe('That start date has already passed.');
  });
});

describe('setupRejection: order', () => {
  it('complains about the days before the date', () => {
    // The wizard asks one question per screen, so a complaint has exactly one
    // place to appear -- and it should be about the screen the athlete is
    // furthest back on rather than the one they just left.
    expect(
      setupRejection(
        FLEXIBLE,
        answers({ trainingDays: [2], startDate: '2026-10-10' }),
        RANGE,
      ),
    ).toBe('Pull-Up Builder needs at least 3 days a week.');
  });
});
