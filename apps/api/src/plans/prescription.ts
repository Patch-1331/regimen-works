import type { ProgramSlotMovement } from './program-day';
import { resolveGroupChoice, type GroupMember } from './group-choice';

/**
 * Turning what a program *wrote* into what this athlete *trains* (DN-19) —
 * pure, like the rest of this directory. No DB, no clock.
 *
 * A program authors a group ("pull, 5x3") rather than an exercise, because that
 * is what lets one program fit an athlete who trains pull-ups and one who
 * trains ring rows without being written twice. This is where the group
 * becomes a movement with a name.
 */

/** Enough of an exercise to sit under a prescribed movement. */
export type LinedExercise = GroupMember;

/** A prescribed row with the exercise this athlete performs it as. */
export type AttachedMovement<E> = {
  movement: ProgramSlotMovement;
  exercise: E;
};

/**
 * Attaches an exercise to each prescribed row: the movement the athlete
 * chose in that group, or the exercise the author pinned.
 *
 * Rows whose exercise cannot be found are **dropped** rather than carried
 * through empty, and after DN-139 that means one thing only: a group with no
 * declared default member, which is a library hole. An exercise archived out
 * from under a program no longer lands here — it resolves to the group's
 * default, so a program day stops quietly losing a movement.
 *
 * A pinned row is *not* moved to the athlete's choice: the author naming a
 * specific variation is the case where the variation is the point, and
 * resolving it away would quietly delete the instruction.
 */
export function attachPrescribedExercises<E extends LinedExercise>(
  movements: ProgramSlotMovement[],
  chosen: ReadonlyMap<string, string>, // group -> the exercise they picked
  exerciseById: ReadonlyMap<string, E>,
  defaults: ReadonlyMap<string, E>, // group -> its declared default member
  owned: ReadonlySet<string>,
): AttachedMovement<E>[] {
  const attached: AttachedMovement<E>[] = [];
  for (const movement of movements) {
    const exercise =
      movement.movementGroup !== null
        ? resolveGroupChoice(
            movement.movementGroup,
            chosen,
            exerciseById,
            defaults,
            owned,
          )
        : movement.exerciseId !== null
          ? exerciseById.get(movement.exerciseId)
          : undefined;
    if (exercise) attached.push({ movement, exercise });
  }
  return attached;
}
