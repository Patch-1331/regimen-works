import type { ProgramSlotMovement } from './program-day';

/**
 * Turning what a program *wrote* into what this athlete *trains* (DN-19) —
 * pure, like the rest of this directory. No DB, no clock.
 *
 * A program authors a line ("pull, 5x3") rather than an exercise, because that
 * is what lets one program fit an athlete on rung 0 and an athlete on rung 4
 * without being written twice. This is where the line becomes a movement with
 * a name.
 */

/** Enough of an exercise to sit under a prescribed movement. */
export type LinedExercise = {
  id: string;
  line: string | null;
  rung: number | null;
};

/** A prescribed row with the exercise this athlete performs it as. */
export type AttachedMovement<E> = {
  movement: ProgramSlotMovement;
  exercise: E;
};

/**
 * The rung an athlete trains a line at before they have ever recorded one.
 *
 * The bottom, deliberately. A program handing somebody a movement they cannot
 * do yet is how an athlete decides the app is not for them, and the rung is
 * the one thing the library can walk upwards on its own.
 */
export const STARTING_RUNG = 0;

/**
 * Attaches an exercise to each prescribed row: the athlete's rung on the line,
 * or the exercise the author pinned.
 *
 * Rows whose exercise cannot be found are **dropped** rather than carried
 * through empty. That is a library gap — a line with no exercise at that rung,
 * or an exercise archived out from under a program — and "5x3" with nothing to
 * perform is not a prescription anybody can train. The caller treats an empty
 * result the way it treats a `movements` slot with nothing on it at all.
 *
 * A pinned row is *not* moved to the athlete's rung: the author naming a
 * specific variation is the case where the variation is the point, and
 * resolving it away would quietly delete the instruction.
 */
export function attachPrescribedExercises<E extends LinedExercise>(
  movements: ProgramSlotMovement[],
  chosenRung: ReadonlyMap<string, number>,
  exerciseAtRung: ReadonlyMap<string, E>, // key: `${line}:${rung}`
  exerciseById: ReadonlyMap<string, E>,
): AttachedMovement<E>[] {
  const attached: AttachedMovement<E>[] = [];
  for (const movement of movements) {
    const exercise =
      movement.line !== null
        ? exerciseAtRung.get(
            `${movement.line}:${chosenRung.get(movement.line) ?? STARTING_RUNG}`,
          )
        : movement.exerciseId !== null
          ? exerciseById.get(movement.exerciseId)
          : undefined;
    if (exercise) attached.push({ movement, exercise });
  }
  return attached;
}
