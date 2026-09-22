import type { ProgramSlotMovement } from './program-day';

/**
 * Turning what a program *wrote* into what this athlete *trains* (DN-19) —
 * pure, like the rest of this directory. No DB, no clock.
 *
 * A program authors a group ("pull, 5x3") rather than an exercise, because that
 * is what lets one program fit an athlete on rung 0 and an athlete on rung 4
 * without being written twice. This is where the group becomes a movement with
 * a name.
 */

/** Enough of an exercise to sit under a prescribed movement. */
export type LinedExercise = {
  id: string;
  movementGroup: string | null;
  rung: number | null;
};

/** A prescribed row with the exercise this athlete performs it as. */
export type AttachedMovement<E> = {
  movement: ProgramSlotMovement;
  exercise: E;
};

/**
 * What an athlete is prescribed on a group they have never chosen on.
 *
 * A program row names a group and not a movement, so unlike
 * `applyRememberedChoice` there is nothing here to pass through: something
 * has to pick a member or the row is dropped. Today that is the first-listed
 * one, and the reason once given for it -- "the bottom, deliberately… the
 * rung is the one thing the library can walk upwards on its own" -- was wrong
 * twice over. Nothing in the app walks a rung upwards (`logs.service.ts`
 * stopped moving them), and "the bottom" is an opinion about difficulty that
 * DN-86 removed from provisioning and this reinstated at read time.
 *
 * ADR-0004 replaces it with a default member declared in the seed: the same
 * opinion, written down where it can be argued with. Still nothing is stored,
 * and the athlete overrides it in one tap.
 */
export const STARTING_RUNG = 0;

/**
 * Attaches an exercise to each prescribed row: the movement the athlete
 * chose in that group, or the exercise the author pinned.
 *
 * Rows whose exercise cannot be found are **dropped** rather than carried
 * through empty. That is a library gap — a group with no exercise at that
 * position,
 * or an exercise archived out from under a program — and "5x3" with nothing to
 * perform is not a prescription anybody can train. The caller treats an empty
 * result the way it treats a `movements` slot with nothing on it at all.
 *
 * A pinned row is *not* moved to the athlete's choice: the author naming a
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
      movement.movementGroup !== null
        ? exerciseAtRung.get(
            `${movement.movementGroup}:${chosenRung.get(movement.movementGroup) ?? STARTING_RUNG}`,
          )
        : movement.exerciseId !== null
          ? exerciseById.get(movement.exerciseId)
          : undefined;
    if (exercise) attached.push({ movement, exercise });
  }
  return attached;
}
