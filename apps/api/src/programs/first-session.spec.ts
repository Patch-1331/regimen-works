import { uniformSets } from '@regimen-works/shared';
import {
  firstSessionDay,
  prescribedMinutes,
  runTrainingDays,
} from './first-session';
import type {
  ActiveProgram,
  ProgramSlot,
  ProgramSlotMovement,
} from './program-day';

/**
 * 2026-09-21 is a Monday, so 09-22 is the Tuesday after it and 09-23 the
 * Wednesday.
 */
const MONDAY = '2026-09-21';

function slot(overrides: Partial<ProgramSlot> = {}): ProgramSlot {
  return {
    id: `slot_${overrides.dayOfWeek ?? 1}`,
    dayOfWeek: 1,
    priority: 0,
    kind: 'wod_generated',
    label: null,
    wodId: null,
    pattern: null,
    wodType: null,
    allowNamed: true,
    maxTimeCapMinutes: null,
    movements: [],
    ...overrides,
  };
}

function line(restSeconds: number | null, sets = 3): ProgramSlotMovement {
  return {
    id: 'psm_1',
    order: 0,
    movementGroup: 'pull',
    exerciseId: null,
    sets: uniformSets(sets, {
      reps: 5,
      repsMax: null,
      toFailure: false,
      restSeconds,
    }),
  };
}

function program(
  slots: ProgramSlot[],
  overrides: Partial<ActiveProgram> = {},
): ActiveProgram {
  return {
    enrollmentId: 'enr_1',
    programId: 'program_1',
    programName: 'Foundations',
    scheduleMode: 'flexible',
    startDate: MONDAY,
    weeks: null,
    defaultRestSeconds: null,
    authoredWeeks: [{ order: 0, phase: 'core', label: null, slots }],
    ...overrides,
  };
}

describe('firstSessionDay (DN-200)', () => {
  it('is the start date when that day carries a session', () => {
    const first = firstSessionDay(program([slot({ dayOfWeek: 1 })]), [1, 3, 5]);
    expect(first).toMatchObject({ date: MONDAY, day: { kind: 'generated' } });
  });

  it('skips a start date the program rests on', () => {
    const fixed = program(
      [slot({ dayOfWeek: 1, kind: 'rest' }), slot({ dayOfWeek: 3 })],
      { scheduleMode: 'fixed' },
    );
    expect(firstSessionDay(fixed, [1, 3, 5])?.date).toBe('2026-09-23');
  });

  it('is null for a program with nothing to train in its first fortnight', () => {
    const resting = program(
      [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) =>
        slot({ dayOfWeek, kind: 'rest' }),
      ),
      { scheduleMode: 'fixed' },
    );
    expect(firstSessionDay(resting, [1, 3, 5])).toBeNull();
  });
});

describe('runTrainingDays (DN-200)', () => {
  it("is the athlete's own days on a flexible program", () => {
    expect(runTrainingDays(program([slot()]), [5, 1, 3])).toEqual([1, 3, 5]);
  });

  it("is the first week's trained days on a fixed one", () => {
    const fixed = program(
      [
        slot({ dayOfWeek: 2 }),
        slot({ dayOfWeek: 4 }),
        slot({ dayOfWeek: 6, kind: 'rest' }),
      ],
      { scheduleMode: 'fixed' },
    );
    expect(runTrainingDays(fixed, [1, 3, 5])).toEqual([2, 4]);
  });
});

describe('prescribedMinutes (DN-200)', () => {
  it('counts work and the rest after every set, to the nearest five', () => {
    // Six sets at 45s of work and 90s of rest: 13.5 minutes.
    expect(prescribedMinutes([line(90), line(90)], null)).toBe(15);
  });

  it("rests at the athlete's pace where they set one", () => {
    // Six sets at 45s of work and 180s of rest: 22.5 minutes.
    expect(prescribedMinutes([line(90), line(90)], 180)).toBe(25);
  });

  it('counts a minute where nobody stated a rest', () => {
    // Three sets at 45s of work and 60s assumed: 5.25 minutes.
    expect(prescribedMinutes([line(null)], null)).toBe(5);
  });

  it('never promises less than five minutes', () => {
    expect(prescribedMinutes([line(0, 1)], null)).toBe(5);
  });
});
