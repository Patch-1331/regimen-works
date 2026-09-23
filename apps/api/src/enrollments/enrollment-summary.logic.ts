import {
  movementGroup,
  type EnrollmentSummary,
  type MovementChange,
  type MovementSnapshot,
} from '@regimen-works/shared';

/**
 * What a finished program has to show for itself (DN-18).
 *
 * Pure, because every input is a fact the caller has already fetched and the
 * interesting part is the arithmetic on them: which groups moved, and what the
 * movement was called at each end.
 */

/** Movement names by exercise id, for the groups in play. */
export type MovementNames = ReadonlyMap<string, string>;

/**
 * Which groups moved over the run, and what they moved between.
 *
 * Both directions are reported, because "up" is not a thing this app has an
 * opinion about (DN-88). A group is in the list when the athlete performs a
 * different movement in it than they did on the start date, and that is the
 * whole test — the summary describes what changed, not whether it improved.
 *
 * A group the athlete had not chosen in when the run began reports a null
 * `from`: they moved from nothing, which is what happened. Before DN-139 this
 * read as rung 0, which invented a movement they were never shown and then
 * reported them as having climbed off it. An absent choice is now absent all
 * the way through.
 *
 * A group is left out when the athlete has no choice in it *now* — there is no
 * destination to name — or when either end's movement cannot be named, which
 * means the row was hard-deleted out from under the snapshot. Neither is
 * something the athlete should be shown a broken sentence about.
 */
export function movementChangesOver(
  startingMovements: MovementSnapshot,
  currentMovements: ReadonlyMap<string, string>,
  names: MovementNames,
): MovementChange[] {
  const started = new Map(Object.entries(startingMovements));
  const groups = new Set([...started.keys(), ...currentMovements.keys()]);

  return [...groups]
    .filter((group) => movementGroup.safeParse(group).success)
    .sort()
    .flatMap((group) => {
      const fromExerciseId = started.get(group) ?? null;
      const toExerciseId = currentMovements.get(group);
      if (toExerciseId === undefined || fromExerciseId === toExerciseId)
        return [];

      const toName = names.get(toExerciseId);
      if (toName === undefined) return [];

      // Null `from` is a real value; a `from` that is set but unnameable is a
      // hole, and the two are deliberately not collapsed -- reporting a
      // deleted movement as "nothing chosen yet" would tell the athlete they
      // started from scratch when they did not.
      const fromName =
        fromExerciseId === null ? null : (names.get(fromExerciseId) ?? null);
      if (fromExerciseId !== null && fromName === null) return [];

      return [
        {
          movementGroup: group as MovementChange['movementGroup'],
          fromExerciseId,
          fromName,
          toExerciseId,
          toName,
        },
      ];
    });
}

/**
 * The figures snapshotted onto `PlanEnrollment.summary` at completion.
 *
 * Every field is allowed to be empty, and an empty one is a real answer: a
 * program run for its whole length with nothing logged reads "0 sessions",
 * not as a figure that failed to compute. That case is the one worth getting
 * right -- an athlete who enrolled, trained nothing and let the weeks run out
 * still finished the run, and a card that broke on them would break exactly
 * when it is least welcome.
 */
export function buildEnrollmentSummary(input: {
  weeks: number | null;
  sessions: number;
  startingMovements: MovementSnapshot;
  currentMovements: ReadonlyMap<string, string>;
  names: MovementNames;
}): EnrollmentSummary {
  return {
    weeks: input.weeks,
    sessions: input.sessions,
    movementChanges: movementChangesOver(
      input.startingMovements,
      input.currentMovements,
      input.names,
    ),
  };
}
