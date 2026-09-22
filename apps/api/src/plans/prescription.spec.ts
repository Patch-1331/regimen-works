import { attachPrescribedExercises, STARTING_RUNG } from './prescription';
import type { ProgramSlotMovement } from './program-day';

/**
 * Turning an authored line into the exercise this athlete performs (DN-19).
 *
 * The rung lookup is the whole reason a program authors "pull" rather than
 * "chin-up": one program, written once, fits the athlete on rung 0 and the one
 * on rung 4. These tests are about what happens when the library cannot answer
 * — the case a program author never sees and an athlete does.
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

const ex = (id: string, movementGroup: string | null, rung: number | null) => ({
  id,
  movementGroup,
  rung,
});

const GROUP = new Map([
  ['pull:0', ex('ex_row', 'pull', 0)],
  ['pull:2', ex('ex_chinup', 'pull', 2)],
]);

const attach = (
  movements: ProgramSlotMovement[],
  rungs: [string, number][] = [],
  byId: [string, ReturnType<typeof ex>][] = [],
) => attachPrescribedExercises(movements, new Map(rungs), GROUP, new Map(byId));

describe('attachPrescribedExercises', () => {
  it('resolves a movementGroup to the rung the athlete trains it at', () => {
    const [attached] = attach([movement()], [['pull', 2]]);

    expect(attached.exercise.id).toBe('ex_chinup');
    expect(attached.movement.sets).toBe(5);
  });

  it('starts an athlete who has never recorded a rung at the bottom', () => {
    // Not an error state: it is every athlete's first day in a group. The
    // bottom rung is the one thing the library can walk upwards on its own,
    // and a movement somebody cannot do yet is how they decide the app is not
    // for them.
    expect(attach([movement()])[0].exercise.id).toBe('ex_row');
    expect(STARTING_RUNG).toBe(0);
  });

  it('leaves a pinned exercise where the author put it', () => {
    // The case where the variation is the point -- a program teaching the
    // negative names the negative, and an athlete further up the group should
    // still train it that day.
    const negative = ex('ex_negative', 'pull', 1);
    const [attached] = attach(
      [movement({ movementGroup: null, exerciseId: 'ex_negative' })],
      [['pull', 2]],
      [['ex_negative', negative]],
    );

    expect(attached.exercise.id).toBe('ex_negative');
  });

  it('drops a movementGroup the library cannot answer at that rung', () => {
    // A library gap, not a prescription: "5x3" with nothing to perform is not
    // something an athlete can train.
    expect(attach([movement()], [['pull', 9]])).toEqual([]);
  });

  it('drops a pinned exercise that is gone or not this athlete’s to see', () => {
    expect(
      attach([movement({ movementGroup: null, exerciseId: 'ex_missing' })]),
    ).toEqual([]);
  });

  it('keeps the rows it can answer when one of them is missing', () => {
    // Half a session is still a session. The alternative -- refusing the whole
    // day over one gap -- costs the athlete the four movements that were fine.
    const attached = attach(
      [movement(), movement({ id: 'psm_2', order: 1, movementGroup: 'squat' })],
      [],
    );

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
