/**
 * What a finished session offers to keep as the athlete's standing choice
 * (WOD-6).
 *
 * A swap applies to today only. If the athlete trained a group at something
 * other than their standing choice, the completion screen offers to remember
 * it — "you did chin-ups today, make that your pull movement?" The stored
 * choice then moves because of what they actually picked, which is what makes
 * it theirs rather than the app's view of them.
 */

/** A group the athlete trained today, and the movement they trained it at. */
export type TrainedMovement = {
  movementGroup: string;
  exerciseId: string;
  exerciseName: string;
};

export type ProposedMovementChange = {
  movementGroup: string;
  /** Null when the group has no choice on record — see `proposeMovementChanges`. */
  fromExerciseId: string | null;
  fromExerciseName: string | null;
  toExerciseId: string;
  toExerciseName: string;
};

/**
 * Proposals are per group, never per movement: one prompt for "pull", however
 * many pull movements the WOD happened to contain.
 *
 * Where a group was trained at two different movements in one session — two
 * pull movements, swapped differently — the one chosen **most recently** wins,
 * so `trained` must arrive in the order the athlete picked them. This used to
 * take the higher rung, on the grounds that "someone who did both chin-ups and
 * negatives did chin-ups". That is an inference about ability, and under
 * DN-88 the app makes none: it has no way to know which of the two they meant
 * to keep, and the last thing they reached for is the closest it can honestly
 * get. With DN-139 there is no longer an ordering to prefer along even if it
 * wanted to.
 *
 * A proposal can move a group to any other member, and that is deliberate: the
 * athlete picked an easier movement on purpose, and remembering it is not the
 * app demoting them. What the app never does is change the choice on its own.
 *
 * A group with no choice on record proposes too, with a null `from` (DN-86).
 * Since provisioning stopped handing everyone a starting position, that is
 * what a brand-new athlete's every group looks like — and their first swap is
 * precisely the choice worth remembering, so skipping it would mean
 * re-swapping the same movement every session forever. What they were *handed*
 * in the meantime is the group's default, which they never chose and which is
 * therefore not what they are moving from (ADR-0004 decision 8).
 */
export function proposeMovementChanges(
  trained: TrainedMovement[],
  current: Map<string, { exerciseId: string; exerciseName: string }>,
): ProposedMovementChange[] {
  // Last write wins: `trained` is in the order the athlete chose, so a later
  // entry simply replaces an earlier one on the same group.
  const latestByGroup = new Map<string, TrainedMovement>();
  for (const t of trained) latestByGroup.set(t.movementGroup, t);

  const proposals: ProposedMovementChange[] = [];
  for (const [movementGroup, t] of latestByGroup) {
    const from = current.get(movementGroup) ?? null;
    if (from?.exerciseId === t.exerciseId) continue; // on record — nothing to ask

    proposals.push({
      movementGroup,
      fromExerciseId: from?.exerciseId ?? null,
      fromExerciseName: from?.exerciseName ?? null,
      toExerciseId: t.exerciseId,
      toExerciseName: t.exerciseName,
    });
  }

  // Stable order so the card doesn't reshuffle between reads.
  return proposals.sort((a, b) =>
    a.movementGroup.localeCompare(b.movementGroup),
  );
}
