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
    planSlotMovementId: null,
    sets: null,
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
      sortOrder: 1,
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
      exercise: { id: 'negative', name: 'Negative pull-up', sortOrder: 0 },
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
          exercise: { id: 'pull-up', name: 'Pull-up', sortOrder: 2 },
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
            sortOrder: null,
          },
        }),
        movement({
          reps: 40,
          wodMovementId: 'wm-2',
          exercise: {
            id: 'high-knees',
            name: 'High knees',
            movementGroup: null,
            sortOrder: null,
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
            sortOrder: null,
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
            sortOrder: 2,
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
});
