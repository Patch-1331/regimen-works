import {
  narrowToSlot,
  resolveProgramDay,
  type ActiveProgram,
  type ProgramSlot,
  type ProgramSlotMovement,
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
    priority: 0,
    kind: 'wod_generated',
    wodId: null,
    pattern: null,
    wodType: null,
    allowNamed: false,
    maxTimeCapMinutes: null,
    movements: [],
    ...overrides,
  };
}

function prescribed(
  overrides: Partial<ProgramSlotMovement> = {},
): ProgramSlotMovement {
  return {
    id: 'psm_1',
    order: 0,
    movementGroup: 'pull',
    exerciseId: null,
    sets: 5,
    reps: 3,
    restSeconds: 90,
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
    expect(resolveProgramDay(null, WEEKDAYS, MONDAY, [])).toEqual({
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
      [],
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
      [],
    );

    expect(day).toEqual({ kind: 'completed', enrollmentId: 'enr_1' });
  });

  it('never completes an open-ended run, however far past the start', () => {
    const day = resolveProgramDay(program(), EVERY_DAY, '2027-06-14', []);

    expect(day.kind).toBe('generated');
  });

  describe('whose schedule decides the day', () => {
    it('defers to the athlete’s training days on a flexible program', () => {
      // The reason Just WODs can author all seven weekdays without turning
      // every day into a training day.
      const day = resolveProgramDay(program(), WEEKDAYS, SATURDAY, []);

      expect(day.kind).toBe('rest');
    });

    it('trains on that same day once the athlete adds it', () => {
      const day = resolveProgramDay(program(), [...WEEKDAYS, 6], SATURDAY, []);

      expect(day.kind).toBe('generated');
    });

    it('overrides them on a fixed program, whose slots are the schedule', () => {
      // What lets a program insist on 48 hours between heavy pull days, which
      // "4 days a week" cannot say.
      const day = resolveProgramDay(
        program({ scheduleMode: 'fixed' }),
        WEEKDAYS,
        SATURDAY,
        [],
      );

      expect(day.kind).toBe('generated');
    });

    it('reports no slot kind on a day the athlete chose off', () => {
      // Distinct from an authored rest, and the rest-day copy depends on it:
      // "planned rest" over a day the athlete took off would be the app
      // taking credit for their decision.
      const day = resolveProgramDay(program(), WEEKDAYS, SATURDAY, []);

      expect(day).toMatchObject({ kind: 'rest', day: { slotKind: null } });
    });
  });

  /**
   * Laying a flexible week onto the days the athlete actually trains (DN-128).
   *
   * `assignSlotsToTrainingDays` owns the rules and `plan.logic.spec` covers
   * them; what is checked here is the resolver's half -- which day the remap
   * is asked about, and what the two day-shaped answers with no session on
   * them record.
   */
  describe('a flexible week on the athlete’s own days', () => {
    const TUESDAY = '2026-09-15';
    const THURSDAY = '2026-09-17';

    /** Foundations' shape in miniature: three ranked days, Mon/Wed/Fri. */
    function ranked(overrides: Partial<ActiveProgram> = {}) {
      return program({
        authoredWeeks: [
          {
            order: 0,
            phase: 'core',
            label: null,
            slots: [
              slot({ dayOfWeek: 1, priority: 0, id: 'press' }),
              slot({ dayOfWeek: 3, priority: 1, id: 'squat' }),
              slot({ dayOfWeek: 5, priority: 2, id: 'vertical' }),
            ],
          },
        ],
        ...overrides,
      });
    }

    it('gives the top-ranked session to the first day the athlete trains', () => {
      // Before DN-128 a Tue/Thu/Sat athlete got whatever the author happened
      // to write on Tuesday, which for Foundations was the conditioning day.
      const day = resolveProgramDay(ranked(), [2, 4, 6], TUESDAY, []);

      expect(day).toMatchObject({ day: { planSlotId: 'press' } });
    });

    it('keeps the authored order across the athlete’s week', () => {
      // Tuesday trained, so it still holds the week's first place and
      // Thursday is the second session rather than the first (DN-123).
      const day = resolveProgramDay(ranked(), [2, 4, 6], THURSDAY, [2]);

      expect(day).toMatchObject({ day: { planSlotId: 'squat' } });
    });

    it('records no slot against a day the athlete chose off', () => {
      // The session this week would have authored here is being trained on
      // another day now; recording it against a rest day would count it twice.
      const day = resolveProgramDay(ranked(), [2, 4, 6], MONDAY, []);

      expect(day).toMatchObject({
        kind: 'rest',
        day: { slotKind: null, planSlotId: null },
      });
    });

    it('still trains a day the program has run out of sessions for', () => {
      // They said they train today. An unconstrained WOD is what Just WODs
      // would have given them, and it beats the app overruling a choice it
      // asked them to make -- but `slotKind` stays null, because this is a day
      // beside the program rather than a day of it.
      const day = resolveProgramDay(
        ranked(),
        [1, 2, 3, 4, 5],
        THURSDAY,
        [1, 2, 3],
      );

      expect(day).toMatchObject({
        kind: 'generated',
        day: { slotKind: null, planSlotId: null },
        constraints: {
          pattern: null,
          wodType: null,
          allowNamed: true,
          maxTimeCapMinutes: null,
        },
      });
    });

    it('leaves a fixed program’s ranking entirely alone', () => {
      // A fixed program's slot layout is the schedule. Remapping it would undo
      // the one thing it is for: 48 hours between heavy pull days is a
      // statement about the calendar, and there is nothing to rank.
      const day = resolveProgramDay(
        ranked({ scheduleMode: 'fixed' }),
        [2, 4, 6],
        TUESDAY,
        [],
      );

      expect(day).toMatchObject({
        kind: 'rest',
        day: { slotKind: null, planSlotId: null },
      });
    });

    describe('a week that re-flows around what was done (DN-123)', () => {
      /** Mon/Wed/Fri, the days `ranked()` authors and this athlete trains. */
      const MWF = [1, 3, 5];
      const WEDNESDAY = '2026-09-16';
      const FRIDAY = '2026-09-18';

      const slotOn = (
        days: number[],
        date: string,
        completed: number[],
      ): string | null => {
        const day = resolveProgramDay(ranked(), days, date, completed);
        return day.kind === 'fallback' || day.kind === 'completed'
          ? null
          : day.day.planSlotId;
      };

      it('carries a missed session forward to the next day they train', () => {
        // Monday went by untrained, so it holds no place in the week and the
        // session behind it is still owed. Before DN-123 Wednesday took its
        // position in the sequence regardless and the press was simply gone.
        expect(slotOn(MWF, WEDNESDAY, [])).toBe('press');
      });

      it('leaves the week alone when nothing has been missed', () => {
        expect(slotOn(MWF, WEDNESDAY, [1])).toBe('squat');
        expect(slotOn(MWF, FRIDAY, [1, 3])).toBe('vertical');
      });

      it('hands a makeup the session the athlete missed', () => {
        // The issue in one line: Monday done, Wednesday missed, Thursday
        // taken as a makeup. Thursday is owed the squat, not Thursday's own
        // authored session and not the press they already did.
        expect(slotOn([...MWF, 4], THURSDAY, [1])).toBe('squat');
      });

      it('does not hand a makeup a session already done', () => {
        // Both training days behind them were trained, so the makeup takes
        // the one the week has left rather than repeating either.
        expect(slotOn([...MWF, 4], THURSDAY, [1, 3])).toBe('vertical');
      });

      it('spends the week out rather than offering a session twice', () => {
        // DN-123's own complaint, at the point where it would otherwise come
        // back: the makeup on Thursday took the last session, so Friday has
        // none left. A day beside the program, not a second helping of it --
        // which is the answer to "what happens when the week has no room".
        const friday = resolveProgramDay(ranked(), MWF, FRIDAY, [1, 3, 4]);

        expect(friday).toMatchObject({
          kind: 'generated',
          day: { slotKind: null, planSlotId: null },
        });
      });

      it('stops treating a day they trained as a rest day', () => {
        // Thursday is not one of their days, but they trained it. Reporting
        // it as rest afterwards would have the app disagree with the row it
        // just wrote.
        const thursday = resolveProgramDay(ranked(), MWF, THURSDAY, [1, 4]);

        expect(thursday.kind).not.toBe('rest');
      });

      it('leaves a fixed program out of it entirely', () => {
        // A fixed program never offers a makeup, so nothing can have been
        // trained off-schedule -- and its week is its schedule either way.
        const fixed = ranked({ scheduleMode: 'fixed' });

        expect(resolveProgramDay(fixed, MWF, WEDNESDAY, []).kind).not.toBe(
          'rest',
        );
        expect(resolveProgramDay(fixed, MWF, WEDNESDAY, [])).toMatchObject({
          day: { planSlotId: 'squat' },
        });
      });
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
        [],
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

    it('hands over what a movements day prescribes', () => {
      expect(
        dayOfKind('movements', { movements: [prescribed()] }),
      ).toMatchObject({
        kind: 'prescribed',
        day: { slotKind: 'movements', planSlotId: 'slot_1' },
        movements: [
          { movementGroup: 'pull', sets: 5, reps: 3, restSeconds: 90 },
        ],
      });
    });

    it('prescribes in the authored order whatever order the rows arrive in', () => {
      // `order` is the only thing that says what comes first, so it is applied
      // here rather than left to whichever query fetched the rows.
      //
      // Three rows, shuffled rather than merely reversed: with two, simply
      // flipping the list produces the right answer and the test proves
      // nothing about sorting.
      const day = dayOfKind('movements', {
        movements: [
          prescribed({ id: 'psm_2', order: 1, movementGroup: 'squat' }),
          prescribed({ id: 'psm_3', order: 2, movementGroup: 'hinge' }),
          prescribed({ id: 'psm_1', order: 0, movementGroup: 'pull' }),
        ],
      });

      expect(day.kind).toBe('prescribed');
      expect(
        day.kind === 'prescribed'
          ? day.movements.map((m) => m.movementGroup)
          : [],
      ).toEqual(['pull', 'squat', 'hinge']);
    });

    it('generates rather than showing an empty screen when a movements day prescribes nothing', () => {
      // `planSlotSchema` refuses to author this and the API refuses to crash
      // on it -- the same stance as the pinned slot with nothing pinned. The
      // athlete still trains, and `slotKind` still says what the row claimed
      // to be.
      expect(dayOfKind('movements')).toMatchObject({
        kind: 'generated',
        day: { slotKind: 'movements' },
        constraints: { pattern: null, allowNamed: true },
      });
    });

    it('ignores a prescription hanging off a kind that is not movements', () => {
      // No CHECK can hold that rule, so the reader holds it: the slot's kind
      // is what decides the day, and a stray row does not turn a WOD day into
      // straight sets.
      expect(
        dayOfKind('wod_generated', { movements: [prescribed()] }),
      ).toMatchObject({ kind: 'generated' });
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
        [],
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
      const day = resolveProgramDay(program(), EVERY_DAY, '2026-09-23', []);

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
        [],
      );

      expect(day).toMatchObject({
        day: { weekLabel: 'Deload', totalWeeks: 2 },
      });
    });

    it('cycles the authored weeks of an open-ended run rather than running out', () => {
      const day = resolveProgramDay(program(), EVERY_DAY, '2027-01-04', []);

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

  it('keeps everything, and reports nothing given up, when the slot constrains nothing', () => {
    expect(narrowToSlot(pool, constraints())).toEqual({
      candidates: pool,
      relaxed: [],
    });
  });

  it('filters on each axis', () => {
    expect(narrowToSlot(pool, constraints({ pattern: 'push' }))).toEqual({
      candidates: [pushForTime],
      relaxed: [],
    });
    expect(narrowToSlot(pool, constraints({ wodType: 'amrap' }))).toEqual({
      candidates: [pullAmrap],
      relaxed: [],
    });
    expect(narrowToSlot(pool, constraints({ maxTimeCapMinutes: 10 }))).toEqual({
      candidates: [pullAmrap, namedPull],
      relaxed: [],
    });
    expect(narrowToSlot(pool, constraints({ allowNamed: false }))).toEqual({
      candidates: [pullAmrap, pushForTime],
      relaxed: [],
    });
  });

  it('drops the time cap before the format, and the format before the pattern', () => {
    // The stated order, least important first: a cap is a convenience, the
    // format a preference, the pattern the session's point.
    const kept = narrowToSlot(
      pool,
      constraints({ pattern: 'pull', wodType: 'tabata', maxTimeCapMinutes: 1 }),
    );

    expect(kept).toEqual({
      candidates: [pullAmrap, namedPull],
      relaxed: ['maxTimeCapMinutes', 'wodType'],
    });
  });

  it('protects allowNamed longest, dropping even the pattern before it', () => {
    // An author who turned benchmarks off meant it: a named WOD landing in
    // the middle of a progression block is the surprise that default exists
    // to prevent. The argument this beat is recorded on SLOT_AXES.
    const kept = narrowToSlot(
      [namedPull, pushForTime],
      constraints({ pattern: 'pull', allowNamed: false }),
    );

    expect(kept).toEqual({
      candidates: [pushForTime],
      relaxed: ['pattern'],
    });
  });

  it('hands back the whole pool rather than nothing, once every axis is spent', () => {
    // The discipline applyEquipmentFloor and pickWod's relaxation ladder both keep: the
    // library is small, and no workout at all is worse than an off-pattern one.
    const kept = narrowToSlot([namedPull], constraints({ allowNamed: false }));

    expect(kept).toEqual({
      candidates: [namedPull],
      relaxed: ['allowNamed'],
    });
  });

  describe('reporting what it gave up', () => {
    // One step at a time: each case constrains every axis, and stocks the
    // library with exactly the WOD that survives down to the step under test.
    // What is asserted is the report as much as the pool, because the report
    // is the only evidence anyone gets that the library has a hole (DN-14).
    const everything = constraints({
      pattern: 'pull',
      wodType: 'amrap',
      allowNamed: false,
      maxTimeCapMinutes: 10,
    });

    it('reports nothing when the slot is satisfied exactly as authored', () => {
      expect(narrowToSlot([pullAmrap], everything)).toEqual({
        candidates: [pullAmrap],
        relaxed: [],
      });
    });

    it('reports the time cap when only an over-long WOD fits the rest', () => {
      const longPullAmrap = { ...pullAmrap, timeCapMinutes: 30 };

      expect(narrowToSlot([longPullAmrap], everything)).toEqual({
        candidates: [longPullAmrap],
        relaxed: ['maxTimeCapMinutes'],
      });
    });

    it('reports the cap and the format when only another format fits', () => {
      const longPullEmom = {
        ...pullAmrap,
        type: 'emom',
        timeCapMinutes: 30,
      };

      expect(narrowToSlot([longPullEmom], everything)).toEqual({
        candidates: [longPullEmom],
        relaxed: ['maxTimeCapMinutes', 'wodType'],
      });
    });

    it('reports the pattern too when the library has none of it -- the squat hole DN-23 fills', () => {
      // The library today: no squat-dominant WOD exists at all, so a squat
      // slot walks the whole group down to the pattern and gets a pull day.
      const longPullEmom = { ...pullAmrap, type: 'emom', timeCapMinutes: 30 };

      expect(
        narrowToSlot(
          [longPullEmom],
          constraints({
            pattern: 'squat',
            wodType: 'amrap',
            allowNamed: false,
            maxTimeCapMinutes: 10,
          }),
        ),
      ).toEqual({
        candidates: [longPullEmom],
        relaxed: ['maxTimeCapMinutes', 'wodType', 'pattern'],
      });
    });

    it('reports every axis when even the benchmark ban has to go', () => {
      const longNamedSquatEmom = {
        dominantPattern: 'squat',
        type: 'emom',
        isNamed: true,
        timeCapMinutes: 30,
      };

      expect(narrowToSlot([longNamedSquatEmom], everything)).toEqual({
        candidates: [longNamedSquatEmom],
        relaxed: ['maxTimeCapMinutes', 'wodType', 'pattern', 'allowNamed'],
      });
    });

    it('reports only the axes the slot actually asked for', () => {
      // A null axis asked for nothing, so giving it up costs nothing. Counting
      // it would bury the real holes under noise from every loose slot.
      const longPushForTime = { ...pushForTime, timeCapMinutes: 30 };

      expect(
        narrowToSlot(
          [longPushForTime],
          constraints({ pattern: 'pull', maxTimeCapMinutes: 10 }),
        ),
      ).toEqual({
        candidates: [longPushForTime],
        relaxed: ['maxTimeCapMinutes', 'pattern'],
      });
    });

    it('never counts allowNamed: true as relaxed, since it forbids nothing', () => {
      const longNamedPush = {
        ...namedPull,
        dominantPattern: 'push',
        timeCapMinutes: 30,
      };

      expect(
        narrowToSlot([longNamedPush], constraints({ pattern: 'pull' })),
      ).toEqual({ candidates: [longNamedPush], relaxed: ['pattern'] });

      // And still not when the group runs past that position entirely, which is
      // the only place a slot that forbade nothing could be reported as
      // having given something up.
      expect(
        narrowToSlot(
          [],
          constraints({ pattern: 'pull', maxTimeCapMinutes: 10 }),
        ),
      ).toEqual({ candidates: [], relaxed: ['maxTimeCapMinutes', 'pattern'] });
    });

    it('reports an empty pool as everything given up rather than a satisfied slot', () => {
      // Nothing to pick from is not the same fact as "the library had it all
      // along", and a caller that saw [] with relaxed: [] would conclude the
      // wrong one.
      expect(narrowToSlot([], everything)).toEqual({
        candidates: [],
        relaxed: ['maxTimeCapMinutes', 'wodType', 'pattern', 'allowNamed'],
      });
    });
  });
});
