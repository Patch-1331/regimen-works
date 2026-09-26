import type { ActiveProgram, ProgramSlot } from './program-day';
import { restPaceOf } from './rest-pace';

/**
 * What Settings shows about the run's rest pace (ADR 0005, DN-143).
 */

function slot(rests: (number | null)[]): ProgramSlot {
  return {
    id: 'slot',
    dayOfWeek: 1,
    priority: 0,
    kind: rests.length > 0 ? 'movements' : 'wod_generated',
    wodId: null,
    pattern: null,
    wodType: null,
    allowNamed: true,
    maxTimeCapMinutes: null,
    movements: rests.map((restSeconds, order) => ({
      id: `m${order}`,
      order,
      movementGroup: 'pull',
      exerciseId: null,
      sets: 3,
      reps: 5,
      repsMax: null,
      toFailure: false,
      restSeconds,
    })),
  };
}

function program(
  weeks: (number | null)[][],
  overrides: Partial<ActiveProgram> = {},
): ActiveProgram {
  return {
    enrollmentId: 'enr_1',
    planId: 'plan_1',
    planName: 'Strength Base',
    scheduleMode: 'flexible',
    startDate: '2026-09-14',
    weeks: 6,
    defaultRestSeconds: null,
    authoredWeeks: weeks.map((rests, order) => ({
      order,
      phase: 'core',
      label: null,
      slots: [slot(rests)],
    })),
    ...overrides,
  };
}

describe('restPaceOf', () => {
  it('has nothing to pace with no program running', () => {
    expect(restPaceOf(null)).toBeNull();
  });

  it('has nothing to pace on a program with no straight sets', () => {
    // Just WODs: a field for rest between sets would be a setting that does
    // nothing.
    expect(restPaceOf(program([[]]))).toBeNull();
  });

  it("reports the run's pace, and that blank is allowed where every rest is stated", () => {
    expect(restPaceOf(program([[90, 0]], { defaultRestSeconds: 120 }))).toEqual(
      {
        enrollmentId: 'enr_1',
        planName: 'Strength Base',
        defaultRestSeconds: 120,
        required: false,
      },
    );
  });

  it('requires a pace where any week leaves a rest unstated', () => {
    // Week two's hole is a clock the athlete will reach even from week one.
    expect(restPaceOf(program([[90], [90, null]]))!.required).toBe(true);
  });
});
