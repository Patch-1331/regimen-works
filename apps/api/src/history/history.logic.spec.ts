import type { SessionMovement } from '@regimen-works/shared';
import { buildMovementHistory, type TrainedDay } from './history.logic';

/**
 * The narrative the Stats panel will read (DN-89): which movement was trained,
 * when, and how much of it — never whether it was enough.
 *
 * Written against days rather than a database because the shape of the answer
 * is the decision here. Which sessions count as a training day is the
 * service's, and is pinned in `history.service.db-spec.ts`.
 */

function movement(
  // `exercise` is overridden field by field, so it is lifted out of the
  // Partial rather than intersected with it — an intersection would demand the
  // whole object back.
  overrides: Partial<Omit<SessionMovement, 'exercise'>> & {
    exercise?: Partial<SessionMovement['exercise']>;
  } = {},
): SessionMovement {
  return {
    wodMovementId: 'wm-1',
    programSlotMovementId: null,
    sets: null,
    prescribedSets: null,
    restSeconds: null,
    order: 0,
    reps: 30,
    repsMax: null,
    toFailure: false,
    repScheme: [],
    isSwapped: false,
    prescribedName: null,
    prescribedReason: null,
    ...overrides,
    exercise: {
      id: 'chin-up',
      name: 'Chin-up',
      unit: 'reps',
      movementGroup: 'pull',
      ...overrides.exercise,
    },
  };
}

function day(
  date: string,
  movements: SessionMovement[],
  name = 'Cindy',
): TrainedDay {
  return { date, name, movements };
}

describe('buildMovementHistory', () => {
  it('says nothing about an athlete who has trained nothing', () => {
    expect(buildMovementHistory([])).toEqual([]);
  });

  it('gathers one movement across the days it was trained', () => {
    const history = buildMovementHistory([
      day('2026-09-10', [movement({ reps: 20 })]),
      day('2026-09-14', [movement({ reps: 30 })]),
    ]);

    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      exerciseId: 'chin-up',
      name: 'Chin-up',
      movementGroup: 'pull',
      unit: 'reps',
      sessions: 2,
      total: 50,
      firstTrained: '2026-09-10',
      lastTrained: '2026-09-14',
    });
  });

  it('reads newest first, whatever order the days arrive in', () => {
    // The athlete opens this asking about now, not about March.
    const history = buildMovementHistory([
      day('2026-09-10', [movement()]),
      day('2026-09-16', [movement()]),
      day('2026-09-12', [movement()]),
    ]);

    expect(history[0].days.map((d) => d.date)).toEqual([
      '2026-09-16',
      '2026-09-12',
      '2026-09-10',
    ]);
  });

  it('puts the movement they are training now at the top', () => {
    const negatives = movement({
      exercise: { id: 'negative', name: 'Negative pull-up' },
    });
    const history = buildMovementHistory([
      day('2026-08-01', [negatives]),
      day('2026-09-16', [movement()]),
    ]);

    // The narrative this exists for: chin-ups lately, negatives before that.
    expect(history.map((h) => h.name)).toEqual(['Chin-up', 'Negative pull-up']);
  });

  it('keeps the two movements of a movementGroup apart rather than summing the movementGroup', () => {
    const history = buildMovementHistory([
      day('2026-09-10', [
        movement({ reps: 20 }),
        movement({
          reps: 15,
          wodMovementId: 'wm-2',
          exercise: { id: 'pull-up', name: 'Pull-up' },
        }),
      ]),
    ]);

    expect(history.map((h) => [h.exerciseId, h.total])).toEqual([
      ['chin-up', 20],
      ['pull-up', 15],
    ]);
  });

  it('counts a movement trained twice in one day as volume, not two sessions', () => {
    // Two rows of one WOD can resolve to the same movement — two rope
    // movements both falling to high knees, say.
    const history = buildMovementHistory([
      day('2026-09-16', [
        movement({
          reps: 20,
          exercise: {
            id: 'high-knees',
            name: 'High knees',
            movementGroup: null,
          },
        }),
        movement({
          reps: 40,
          wodMovementId: 'wm-2',
          exercise: {
            id: 'high-knees',
            name: 'High knees',
            movementGroup: null,
          },
        }),
      ]),
    ]);

    expect(history[0]).toMatchObject({ sessions: 1, total: 60 });
  });

  it('carries why a movement stood in for another', () => {
    // Three things put a movement on the plate that the library did not
    // prescribe, and they are not the same fact (DN-79, DN-88).
    const history = buildMovementHistory([
      day('2026-09-16', [
        movement({
          exercise: {
            id: 'row',
            name: 'Row under table',
            movementGroup: null,
          },
          prescribedName: 'Pull-up',
          prescribedReason: 'equipment',
        }),
      ]),
    ]);

    expect(history[0].days[0]).toMatchObject({
      prescribedName: 'Pull-up',
      prescribedReason: 'equipment',
      isSwapped: false,
    });
  });

  it('keeps the name the day carried, not the name it has now', () => {
    // The snapshot copies the name for exactly this reason (DN-90): a rename
    // must not rewrite August. Keyed by id, so it stays one history.
    const history = buildMovementHistory([
      day('2026-08-01', [movement({ exercise: { name: 'Chin up' } })]),
      day('2026-09-16', [movement({ exercise: { name: 'Chin-up' } })]),
    ]);

    expect(history).toHaveLength(1);
    expect(history[0].name).toBe('Chin-up');
    expect(history[0].sessions).toBe(2);
  });

  it('names the workout each day came from', () => {
    const history = buildMovementHistory([
      day('2026-09-16', [movement()], 'Fran'),
    ]);
    expect(history[0].days[0].name).toBe('Fran');
  });

  it('counts seconds and reps in their own units without mixing them', () => {
    const history = buildMovementHistory([
      day('2026-09-16', [
        movement({
          reps: 30,
          exercise: {
            id: 'plank',
            name: 'Plank hold',
            unit: 'seconds',
            movementGroup: 'core_hold',
          },
        }),
        movement({ reps: 45, wodMovementId: 'wm-2' }),
      ]),
    ]);

    expect(history.map((h) => [h.unit, h.total])).toEqual([
      ['seconds', 30],
      ['reps', 45],
    ]);
  });

  describe('a straight-sets day (DN-191)', () => {
    /** A prescribed line: `sets` of the snapshot, each set in `prescribedSets`. */
    function line(
      prescribedSets: SessionMovement['prescribedSets'] & object,
    ): SessionMovement {
      const [first] = prescribedSets;
      return movement({
        wodMovementId: null,
        programSlotMovementId: 'psm-1',
        sets: prescribedSets.length,
        prescribedSets,
        reps: first.reps,
        repsMax: first.repsMax,
        toFailure: first.toFailure,
        restSeconds: first.restSeconds,
      });
    }

    function set(
      reps: number | null,
      repsMax: number | null = null,
      loadStepPercent: number | null = null,
    ) {
      return {
        reps,
        repsMax,
        toFailure: reps === null,
        loadStepPercent,
        restSeconds: 120,
      };
    }

    it('carries every set of an RPT day in order, with its load steps', () => {
      const history = buildMovementHistory([
        day(
          '2026-10-20',
          [line([set(6, 8), set(8, 10, -10), set(10, 12, -10)])],
          'Strength',
        ),
      ]);

      expect(history[0].days[0].sets).toEqual([
        { reps: 6, repsMax: 8, toFailure: false, loadStepPercent: null },
        { reps: 8, repsMax: 10, toFailure: false, loadStepPercent: -10 },
        { reps: 10, repsMax: 12, toFailure: false, loadStepPercent: -10 },
      ]);
      // The day's own shape stays the first set's, as the snapshot holds it.
      expect(history[0].days[0]).toMatchObject({ reps: 6, repsMax: 8 });
    });

    it('counts the floor of every set of an RPT day', () => {
      const history = buildMovementHistory([
        day('2026-10-20', [line([set(6, 8), set(8, 10), set(10, 12)])]),
      ]);
      expect(history[0].total).toBe(24);
    });

    it('counts a uniform 5 x 5 as 25, and keeps its sets alike', () => {
      const fives = Array.from({ length: 5 }, () => set(5));
      const history = buildMovementHistory([day('2026-10-20', [line(fives)])]);

      expect(history[0].total).toBe(25);
      expect(history[0].days[0].sets).toHaveLength(5);
      expect(new Set(history[0].days[0].sets!.map((s) => s.reps))).toEqual(
        new Set([5]),
      );
    });

    it('carries a drop set, and counts nothing for the sets worked to failure', () => {
      const history = buildMovementHistory([
        day('2026-10-20', [
          line([set(8), set(null, null, -20), set(null, null, -20)]),
        ]),
      ]);

      expect(history[0].total).toBe(8);
      expect(history[0].days[0].sets).toEqual([
        { reps: 8, repsMax: null, toFailure: false, loadStepPercent: null },
        { reps: null, repsMax: null, toFailure: true, loadStepPercent: -20 },
        { reps: null, repsMax: null, toFailure: true, loadStepPercent: -20 },
      ]);
    });

    it('reads a day snapshotted before sets could differ as its one shape, every set', () => {
      // `prescribedSets` null: every set was the row's own shape, and the app
      // knew of no load step (DN-186).
      const history = buildMovementHistory([
        day('2026-09-16', [
          movement({
            wodMovementId: null,
            programSlotMovementId: 'psm-1',
            sets: 3,
            prescribedSets: null,
            reps: 8,
            repsMax: 10,
          }),
        ]),
      ]);

      expect(history[0].days[0].sets).toEqual(
        Array.from({ length: 3 }, () => ({
          reps: 8,
          repsMax: 10,
          toFailure: false,
          loadStepPercent: null,
        })),
      );
      expect(history[0].total).toBe(24);
    });

    it('leaves a WOD movement as it was: no sets, and its reps are the day', () => {
      const history = buildMovementHistory([
        day('2026-10-20', [movement({ reps: 45, repScheme: [21, 15, 9] })]),
      ]);

      expect(history[0].days[0].sets).toBeNull();
      expect(history[0].total).toBe(45);
    });
  });
});
