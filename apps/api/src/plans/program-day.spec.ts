import {
  narrowToSlot,
  resolveProgramDay,
  type ActiveProgram,
  type ProgramSlot,
  type SlotConstraints,
} from './program-day';

/**
 * Dates here are real weekdays and the tests say which: 2026-09-14 is a
 * Monday, so 09-19 is a Saturday and 09-20 the Sunday that ends that week.
 * A program day is a calendar fact, and a fixture that only works because
 * nobody checked the calendar is the bug these tests exist to catch.
 */
const MONDAY = '2026-09-14';
const SATURDAY = '2026-09-19';

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

function program(overrides: Partial<ActiveProgram> = {}): ActiveProgram {
  return {
    enrollmentId: 'enr_1',
    planId: 'plan_1',
    planName: 'Pull-Up Builder',
    scheduleMode: 'flexible',
    startDate: MONDAY,
    weeks: null,
    authoredWeeks: [
      {
        order: 0,
        phase: 'core',
        label: null,
        slots: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) =>
          slot({ dayOfWeek, id: `slot_${dayOfWeek}` }),
        ),
      },
    ],
    ...overrides,
  };
}

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAYS = [1, 2, 3, 4, 5];

describe('resolveProgramDay', () => {
  it('falls back when the athlete has no active enrollment', () => {
    // Not a broken state: an athlete whose program has just completed has none
    // until provisioning re-enrolls them, and their Today still has to render.
    expect(resolveProgramDay(null, WEEKDAYS, MONDAY)).toEqual({
      kind: 'fallback',
      reason: 'no-enrollment',
    });
  });

  it('falls back before the start date, which is how a future start works', () => {
    // One active enrollment, no second row and no status-flipping job: the
    // whole rule for the gap between enrolling and starting is date < start.
    const day = resolveProgramDay(
      program({ startDate: '2026-09-21' }),
      WEEKDAYS,
      MONDAY,
    );

    expect(day).toEqual({ kind: 'fallback', reason: 'before-start' });
  });

  it('reports a run past its last day as completed, naming the enrollment', () => {
    // Four weeks from Monday 09-14 runs to Sunday 10-11, so 10-12 is the
    // first day past the end -- not the last authored workout's date.
    const day = resolveProgramDay(
      program({
        weeks: 4,
        authoredWeeks: [
          {
            order: 0,
            phase: 'core',
            label: null,
            slots: [slot({ dayOfWeek: 1 })],
          },
        ],
      }),
      WEEKDAYS,
      '2026-10-12',
    );

    expect(day).toEqual({ kind: 'completed', enrollmentId: 'enr_1' });
  });

  it('never completes an open-ended run, however far past the start', () => {
    const day = resolveProgramDay(program(), EVERY_DAY, '2027-06-14');

    expect(day.kind).toBe('generated');
  });

  describe('whose schedule decides the day', () => {
    it('defers to the athlete’s training days on a flexible program', () => {
      // The reason Just WODs can author all seven weekdays without turning
      // every day into a training day.
      const day = resolveProgramDay(program(), WEEKDAYS, SATURDAY);

      expect(day.kind).toBe('rest');
    });

    it('trains on that same day once the athlete adds it', () => {
      const day = resolveProgramDay(program(), [...WEEKDAYS, 6], SATURDAY);

      expect(day.kind).toBe('generated');
    });

    it('overrides them on a fixed program, whose slots are the schedule', () => {
      // What lets a program insist on 48 hours between heavy pull days, which
      // "4 days a week" cannot say.
      const day = resolveProgramDay(
        program({ scheduleMode: 'fixed' }),
        WEEKDAYS,
        SATURDAY,
      );

      expect(day.kind).toBe('generated');
    });

    it('reports no slot kind on a day the athlete chose off', () => {
      // Distinct from an authored rest, and the rest-day copy depends on it:
      // "planned rest" over a day the athlete took off would be the app
      // taking credit for their decision.
      const day = resolveProgramDay(program(), WEEKDAYS, SATURDAY);

      expect(day).toMatchObject({ kind: 'rest', day: { slotKind: null } });
    });
  });

  describe('each slot kind', () => {
    function dayOfKind(kind: string, extra: Partial<ProgramSlot> = {}) {
      return resolveProgramDay(
        program({
          authoredWeeks: [
            {
              order: 0,
              phase: 'core',
              label: null,
              slots: [slot({ dayOfWeek: 1, kind, ...extra })],
            },
          ],
        }),
        WEEKDAYS,
        MONDAY,
      );
    }

    it('rests on an authored rest day, and says the program planned it', () => {
      expect(dayOfKind('rest')).toMatchObject({
        kind: 'rest',
        day: { slotKind: 'rest', planSlotId: 'slot_1' },
      });
    });

    it('uses the pinned WOD', () => {
      expect(dayOfKind('wod_pinned', { wodId: 'wod_fran' })).toMatchObject({
        kind: 'pinned',
        wodId: 'wod_fran',
        day: { slotKind: 'wod_pinned' },
      });
    });

    it('generates with the slot’s constraints', () => {
      const day = dayOfKind('wod_generated', {
        pattern: 'pull',
        wodType: 'amrap',
        allowNamed: false,
        maxTimeCapMinutes: 12,
      });

      expect(day).toMatchObject({
        kind: 'generated',
        constraints: {
          pattern: 'pull',
          wodType: 'amrap',
          allowNamed: false,
          maxTimeCapMinutes: 12,
        },
      });
    });

    it('stubs a movements day as an unconstrained WOD, still reporting its kind', () => {
      // PlanSlot carries no prescription columns until DN-19, so this cannot
      // be authored yet. The athlete still trains; the screen that learns to
      // render it can tell what it is looking at.
      expect(dayOfKind('movements')).toMatchObject({
        kind: 'generated',
        day: { slotKind: 'movements' },
        constraints: { pattern: null, allowNamed: true },
      });
    });

    it('generates rather than crashing on a pinned slot with nothing pinned', () => {
      // A CHECK makes this unrepresentable. It is handled anyway because the
      // alternative is an impossible row taking down somebody's Today screen.
      expect(dayOfKind('wod_pinned', { wodId: null })).toMatchObject({
        kind: 'generated',
      });
    });

    it('rests when the week authors nothing for this weekday', () => {
      // A four-day week says nothing about Wednesday. Distinct from an
      // authored rest, and there is no slot to record against the day.
      const day = resolveProgramDay(
        program({
          scheduleMode: 'fixed',
          authoredWeeks: [
            {
              order: 0,
              phase: 'core',
              label: null,
              slots: [slot({ dayOfWeek: 2 })],
            },
          ],
        }),
        EVERY_DAY,
        MONDAY,
      );

      expect(day).toMatchObject({
        kind: 'rest',
        day: { slotKind: null, planSlotId: null },
      });
    });
  });

  describe('where the athlete is', () => {
    it('counts weeks from one, and days from zero', () => {
      // The week is the one number an athlete reads; planDayIndex is what
      // DailyAssignment stores and what "day 17 of 24" counts.
      const day = resolveProgramDay(program(), EVERY_DAY, '2026-09-23');

      expect(day).toMatchObject({
        day: { week: 2, planDayIndex: 9, totalWeeks: null },
      });
    });

    it('carries the authored week’s label through the expansion', () => {
      const day = resolveProgramDay(
        program({
          weeks: 2,
          authoredWeeks: [
            {
              order: 0,
              phase: 'core',
              label: 'Deload',
              slots: [slot({ dayOfWeek: 1 })],
            },
          ],
        }),
        WEEKDAYS,
        MONDAY,
      );

      expect(day).toMatchObject({
        day: { weekLabel: 'Deload', totalWeeks: 2 },
      });
    });

    it('cycles the authored weeks of an open-ended run rather than running out', () => {
      const day = resolveProgramDay(program(), EVERY_DAY, '2027-01-04');

      expect(day.kind).toBe('generated');
    });
  });
});

describe('narrowToSlot', () => {
  const pullAmrap = {
    dominantPattern: 'pull',
    type: 'amrap',
    isNamed: false,
    timeCapMinutes: 10,
  };
  const pushForTime = {
    dominantPattern: 'push',
    type: 'for_time',
    isNamed: false,
    timeCapMinutes: 20,
  };
  const namedPull = {
    dominantPattern: 'pull',
    type: 'for_time',
    isNamed: true,
    timeCapMinutes: 8,
  };
  const pool = [pullAmrap, pushForTime, namedPull];

  function constraints(overrides: Partial<SlotConstraints> = {}) {
    return {
      pattern: null,
      wodType: null,
      allowNamed: true,
      maxTimeCapMinutes: null,
      ...overrides,
    };
  }

  it('keeps everything when the slot constrains nothing', () => {
    expect(narrowToSlot(pool, constraints())).toEqual(pool);
  });

  it('filters on each axis', () => {
    expect(narrowToSlot(pool, constraints({ pattern: 'push' }))).toEqual([
      pushForTime,
    ]);
    expect(narrowToSlot(pool, constraints({ wodType: 'amrap' }))).toEqual([
      pullAmrap,
    ]);
    expect(narrowToSlot(pool, constraints({ maxTimeCapMinutes: 10 }))).toEqual([
      pullAmrap,
      namedPull,
    ]);
    expect(narrowToSlot(pool, constraints({ allowNamed: false }))).toEqual([
      pullAmrap,
      pushForTime,
    ]);
  });

  it('drops the time cap before the format, and the format before the pattern', () => {
    // The stated order, least important first: a cap is a convenience, the
    // format a preference, the pattern the session's point.
    const kept = narrowToSlot(
      pool,
      constraints({ pattern: 'pull', wodType: 'tabata', maxTimeCapMinutes: 1 }),
    );

    expect(kept).toEqual([pullAmrap, namedPull]);
  });

  it('protects allowNamed longest, dropping even the pattern before it', () => {
    // An author who turned benchmarks off meant it: a named WOD landing in
    // the middle of a progression block is the surprise that default exists
    // to prevent.
    const kept = narrowToSlot(
      [namedPull, pushForTime],
      constraints({ pattern: 'pull', allowNamed: false }),
    );

    expect(kept).toEqual([pushForTime]);
  });

  it('hands back the whole pool rather than nothing, once every axis is spent', () => {
    // The discipline applyEquipmentFloor and pickWod's ladder both keep: the
    // library is small, and no workout at all is worse than an off-pattern one.
    const kept = narrowToSlot([namedPull], constraints({ allowNamed: false }));

    expect(kept).toEqual([namedPull]);
  });
});
