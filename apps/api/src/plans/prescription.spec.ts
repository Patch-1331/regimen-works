import { attachPrescribedExercises } from './prescription';
import type { ProgramSlotMovement } from './program-day';

/**
 * Turning an authored group into the movement this athlete performs (DN-19).
 *
 * The lookup is the whole reason a program authors "pull" rather than
 * "chin-up": one program, written once, fits the athlete who does rows and the
 * one who does chin-ups. These tests are about what happens when the athlete
 * has not answered, or their answer no longer works — the cases a program
 * author never sees and an athlete does.
 */

function movement(overrides: Partial<ProgramSlotMovement> = {}) {
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

const ex = (
  id: string,
  movementGroup: string | null,
  options: { equipment?: string[]; isGroupDefault?: boolean } = {},
) => ({
  id,
  movementGroup,
  equipment: options.equipment ?? [],
  isGroupDefault: options.isGroupDefault ?? false,
});

const row = ex('ex_row', 'pull', { isGroupDefault: true });
const chinUp = ex('ex_chinup', 'pull');
const barChinUp = ex('ex_bar_chinup', 'pull', { equipment: ['bar'] });

const LIBRARY = [row, chinUp, barChinUp];
const BY_ID = new Map(LIBRARY.map((e) => [e.id, e]));
const DEFAULTS = new Map([['pull', row]]);

const attach = (
  movements: ProgramSlotMovement[],
  chosen: [string, string][] = [],
  options: {
    byId?: [string, ReturnType<typeof ex>][];
    defaults?: [string, ReturnType<typeof ex>][];
    owned?: string[];
  } = {},
) =>
  attachPrescribedExercises(
    movements,
    new Map(chosen),
    options.byId ? new Map(options.byId) : BY_ID,
    options.defaults ? new Map(options.defaults) : DEFAULTS,
    new Set(options.owned ?? ['bar']),
  );

describe('attachPrescribedExercises', () => {
  it('resolves a group to the movement the athlete chose in it', () => {
    const [attached] = attach([movement()], [['pull', 'ex_chinup']]);

    expect(attached.exercise.id).toBe('ex_chinup');
    expect(attached.movement.sets).toBe(5);
  });

  // The absent-choice path (DN-139, ADR-0004 decisions 7 and 8). Before this
  // the answer was "rung 0", which is the bottom of a ladder the app does not
  // have — an accident of list order rather than a decision anyone made.
  it("hands an athlete who has chosen nothing the group's declared default", () => {
    // Not an error state: it is every athlete's first day in a group, and the
    // ordinary case since DN-86 stopped provisioning a row per group. Nothing
    // is written back -- this function has no writer to write it with, which
    // is the point: a stored default is indistinguishable from a choice the
    // athlete made.
    expect(attach([movement()])[0].exercise.id).toBe('ex_row');
  });

  it('drops a group with no default declared rather than inventing one', () => {
    // A library hole, and the honest answer is to say nothing: picking the
    // first member by list order is exactly the accident the default replaced.
    expect(attach([movement()], [], { defaults: [] })).toEqual([]);
  });

  // The stale-choice path. Both cases below reach the athlete as the same
  // thing -- a movement they did not pick -- so they take the same path.
  it("falls back to the default when the athlete's choice has been archived", () => {
    // Archived rows never reach `byId`: `libraryVisibleTo` has filtered them
    // out upstream. The stored row is deliberately left alone, so unarchiving
    // restores their preference for free.
    const [attached] = attach([movement()], [['pull', 'ex_retired']]);

    expect(attached.exercise.id).toBe('ex_row');
  });

  it('falls back to the default when they own nothing for their choice', () => {
    const [attached] = attach([movement()], [['pull', 'ex_bar_chinup']], {
      owned: [],
    });

    expect(attached.exercise.id).toBe('ex_row');
  });

  it('keeps their choice when they own what it needs', () => {
    const [attached] = attach([movement()], [['pull', 'ex_bar_chinup']], {
      owned: ['bar'],
    });

    expect(attached.exercise.id).toBe('ex_bar_chinup');
  });

  it('leaves a pinned exercise where the author put it', () => {
    // The case where the variation is the point -- a program teaching the
    // negative names the negative, and an athlete who usually does chin-ups
    // should still train it that day.
    const negative = ex('ex_negative', 'pull');
    const [attached] = attach(
      [movement({ movementGroup: null, exerciseId: 'ex_negative' })],
      [['pull', 'ex_chinup']],
      { byId: [...BY_ID, ['ex_negative', negative]] },
    );

    expect(attached.exercise.id).toBe('ex_negative');
  });

  it('drops a pinned exercise that is gone or not this athlete’s to see', () => {
    expect(
      attach([movement({ movementGroup: null, exerciseId: 'ex_missing' })]),
    ).toEqual([]);
  });

  it('keeps the rows it can answer when one of them is missing', () => {
    // Half a session is still a session. The alternative -- refusing the whole
    // day over one gap -- costs the athlete the four movements that were fine.
    const attached = attach([
      movement(),
      movement({ id: 'psm_2', order: 1, movementGroup: 'squat' }),
    ]);

    expect(attached.map((a) => a.movement.id)).toEqual(['psm_1']);
  });

  it('keeps the authored order', () => {
    const attached = attach([
      movement({ id: 'psm_1', order: 0 }),
      movement({ id: 'psm_2', order: 1 }),
    ]);

    expect(attached.map((a) => a.movement.order)).toEqual([0, 1]);
  });
});
