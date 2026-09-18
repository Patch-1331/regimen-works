import {
  expandPlanWeeks,
  minimumViableWeeks,
  resolveSlotForDate,
} from './plan.logic';

/**
 * DN-11. Both functions are pure, so these specs are the whole story -- there
 * is no database behaviour hiding behind them.
 *
 * Weeks are written as `{ order, phase, label }` and asserted through `label`,
 * because what matters throughout is *which authored week was played where*,
 * and a label reads at a glance where an object comparison does not.
 */

function week(order: number, phase: string, label: string) {
  return { order, phase, label };
}

/** Three core weeks that wave: the shape authored overload depends on. */
const WAVING_BLOCK = [
  week(0, 'intro', 'ramp'),
  week(1, 'core', 'A'),
  week(2, 'core', 'B'),
  week(3, 'core', 'C'),
  week(4, 'peak', 'test'),
];

const labels = (weeks: { label: string }[]) => weeks.map((w) => w.label);

describe('expandPlanWeeks', () => {
  it('plays every authored week once at its natural length', () => {
    expect(labels(expandPlanWeeks(WAVING_BLOCK, 5))).toEqual([
      'ramp',
      'A',
      'B',
      'C',
      'test',
    ]);
  });

  it('cycles the core block in order to fill a longer run', () => {
    // The assertion that matters most in this file. A B C A B C, never
    // shuffled and never restarted from the wrong place: the program gets
    // harder because the block waves, and playing it out of sequence turns
    // the wave into noise.
    expect(labels(expandPlanWeeks(WAVING_BLOCK, 11))).toEqual([
      'ramp',
      'A',
      'B',
      'C',
      'A',
      'B',
      'C',
      'A',
      'B',
      'C',
      'test',
    ]);
  });

  it('cuts a cycle mid-block when the length does not divide evenly', () => {
    expect(labels(expandPlanWeeks(WAVING_BLOCK, 7))).toEqual([
      'ramp',
      'A',
      'B',
      'C',
      'A',
      'B',
      'test',
    ]);
  });

  it('sorts by the authored order rather than trusting the array', () => {
    const shuffled = [...WAVING_BLOCK].reverse();
    expect(labels(expandPlanWeeks(shuffled, 5))).toEqual([
      'ramp',
      'A',
      'B',
      'C',
      'test',
    ]);
  });

  describe('when the chosen length is shorter than the bookends', () => {
    const twoAndTwo = [
      week(0, 'intro', 'ramp-1'),
      week(1, 'intro', 'ramp-2'),
      week(2, 'core', 'A'),
      week(3, 'peak', 'peak-1'),
      week(4, 'peak', 'peak-2'),
    ];

    it('drops intro before it touches peak', () => {
      expect(labels(expandPlanWeeks(twoAndTwo, 3))).toEqual([
        'ramp-2',
        'peak-1',
        'peak-2',
      ]);
    });

    it('keeps the intro week nearest the core block when only one fits', () => {
      // Both ramps cannot fit; the one that hands over to the core block is
      // the more useful of the two.
      expect(labels(expandPlanWeeks(twoAndTwo, 3))).toContain('ramp-2');
      expect(labels(expandPlanWeeks(twoAndTwo, 3))).not.toContain('ramp-1');
    });

    it('cuts into peak only once intro is gone, keeping the finish', () => {
      expect(labels(expandPlanWeeks(twoAndTwo, 1))).toEqual(['peak-2']);
    });

    it('leaves no room for core at all, rather than dropping a bookend for it', () => {
      expect(labels(expandPlanWeeks(twoAndTwo, 2))).not.toContain('A');
    });
  });

  describe('never throws', () => {
    it('returns nothing for a length of zero or less', () => {
      expect(expandPlanWeeks(WAVING_BLOCK, 0)).toEqual([]);
      expect(expandPlanWeeks(WAVING_BLOCK, -3)).toEqual([]);
    });

    it('returns nothing for a program with no weeks', () => {
      expect(expandPlanWeeks([], 6)).toEqual([]);
    });

    it('stops short rather than inventing a core block that was never authored', () => {
      // Returns fewer than asked for, which is the one case where the exact
      // length cannot be honoured. minimumViableWeeks is what stops a plan
      // being authored this way in the first place.
      const noCore = [week(0, 'intro', 'ramp'), week(1, 'peak', 'test')];
      expect(labels(expandPlanWeeks(noCore, 6))).toEqual(['ramp', 'test']);
    });

    it('ignores a week whose phase is none of the three', () => {
      const odd = [...WAVING_BLOCK, week(5, 'deload', 'stray')];
      expect(labels(expandPlanWeeks(odd, 5))).not.toContain('stray');
    });
  });
});

describe('minimumViableWeeks', () => {
  it('is intro plus one whole core block plus peak', () => {
    expect(minimumViableWeeks(WAVING_BLOCK)).toBe(5);
  });

  it('is the length at which every authored week plays exactly once', () => {
    // The two functions have to agree about how long a program is, so this
    // asserts the relationship rather than the number.
    const shortest = minimumViableWeeks(WAVING_BLOCK);
    expect(labels(expandPlanWeeks(WAVING_BLOCK, shortest)).sort()).toEqual(
      labels(WAVING_BLOCK).sort(),
    );
  });

  it('does not charge for a week no phase will play', () => {
    expect(
      minimumViableWeeks([...WAVING_BLOCK, week(5, 'deload', 'stray')]),
    ).toBe(5);
  });

  it('is zero for a program with no weeks', () => {
    expect(minimumViableWeeks([])).toBe(0);
  });
});

describe('resolveSlotForDate', () => {
  /** Mon, Wed, Fri — so an unauthored weekday is testable alongside them. */
  const slots = [
    { dayOfWeek: 1, kind: 'wod_generated' },
    { dayOfWeek: 3, kind: 'rest' },
    { dayOfWeek: 5, kind: 'wod_generated' },
  ];
  const fourWeeks = [{ slots }, { slots }, { slots }, { slots }];

  // 2026-09-14 is a Monday.
  const enrollment = { startDate: '2026-09-14', weeks: 4 };

  it('finds the slot for a weekday in the first week', () => {
    const found = resolveSlotForDate(enrollment, fourWeeks, '2026-09-16');
    expect(found).toEqual({
      status: 'scheduled',
      slot: { dayOfWeek: 3, kind: 'rest' },
      weekIndex: 0,
      dayIndex: 2,
    });
  });

  it('counts the week by calendar, not by sevens from the start date', () => {
    // The Monday one week on is week 1, and so is the Friday after it.
    expect(
      resolveSlotForDate(enrollment, fourWeeks, '2026-09-21'),
    ).toMatchObject({ weekIndex: 1 });
    expect(
      resolveSlotForDate(enrollment, fourWeeks, '2026-09-25'),
    ).toMatchObject({ weekIndex: 1 });
  });

  it('refuses to schedule a weekday the week does not author', () => {
    // Tuesday. A four-day week says nothing about it, which is a different
    // fact from the author having written a rest day.
    expect(resolveSlotForDate(enrollment, fourWeeks, '2026-09-15')).toEqual({
      status: 'unscheduled',
      weekIndex: 0,
      dayIndex: 1,
    });
  });

  it('reports a date before the start', () => {
    expect(resolveSlotForDate(enrollment, fourWeeks, '2026-09-11')).toEqual({
      status: 'before-start',
    });
  });

  it('reports a date past the last week', () => {
    expect(resolveSlotForDate(enrollment, fourWeeks, '2026-11-02')).toEqual({
      status: 'past-end',
    });
  });

  it('runs to the end of the last calendar week, not to the last authored slot', () => {
    // The boundary, from both sides. A four-week program starting on a Monday
    // ends on the Sunday 27 days later -- and that Sunday is still inside the
    // program even though nothing is authored for it, because the program ends
    // when its last week ends rather than when its last workout does. An
    // off-by-one here either cuts the program short or runs it a week long.
    expect(
      resolveSlotForDate(enrollment, fourWeeks, '2026-10-09'),
    ).toMatchObject({ status: 'scheduled', weekIndex: 3 });
    expect(
      resolveSlotForDate(enrollment, fourWeeks, '2026-10-11'),
    ).toMatchObject({ status: 'unscheduled', weekIndex: 3, dayIndex: 27 });
    expect(resolveSlotForDate(enrollment, fourWeeks, '2026-10-12')).toEqual({
      status: 'past-end',
    });
  });

  describe('a mid-week start', () => {
    // 2026-09-16 is a Wednesday, so week 0 is Wednesday to Sunday.
    const midWeek = { startDate: '2026-09-16', weeks: 4 };

    it('gives a short first week rather than shifting the weekdays', () => {
      // Friday of the start week is still week 0 and still the Friday slot --
      // a Mon/Wed/Fri program does not become Wed/Fri/Sun because the athlete
      // enrolled on a Wednesday.
      expect(
        resolveSlotForDate(midWeek, fourWeeks, '2026-09-18'),
      ).toMatchObject({
        status: 'scheduled',
        slot: { dayOfWeek: 5 },
        weekIndex: 0,
      });
    });

    it('starts week 1 on the following Monday, days after the start', () => {
      expect(
        resolveSlotForDate(midWeek, fourWeeks, '2026-09-21'),
      ).toMatchObject({
        weekIndex: 1,
        dayIndex: 5,
      });
    });

    it('still refuses the days of that week before the start date', () => {
      // Monday of the start week is earlier than the start date, so it falls
      // back to Just WODs like any other pre-start day.
      expect(resolveSlotForDate(midWeek, fourWeeks, '2026-09-14')).toEqual({
        status: 'before-start',
      });
    });
  });

  describe('an open-ended program', () => {
    const justWods = { startDate: '2026-09-14', weeks: null };
    const oneWeek = [{ slots }];

    it('never runs past its end, because it has none', () => {
      expect(resolveSlotForDate(justWods, oneWeek, '2027-06-07')).toMatchObject(
        {
          status: 'scheduled',
          weekIndex: 38,
        },
      );
    });

    it('cycles its weeks rather than running out of them', () => {
      const two = [{ slots }, { slots: [{ dayOfWeek: 1, kind: 'rest' }] }];
      expect(resolveSlotForDate(justWods, two, '2026-09-21')).toMatchObject({
        slot: { kind: 'rest' },
      });
      expect(resolveSlotForDate(justWods, two, '2026-09-28')).toMatchObject({
        slot: { kind: 'wod_generated' },
      });
    });
  });

  it('reports past-end for a program with no weeks at all', () => {
    expect(resolveSlotForDate(enrollment, [], '2026-09-16')).toEqual({
      status: 'past-end',
    });
  });
});
