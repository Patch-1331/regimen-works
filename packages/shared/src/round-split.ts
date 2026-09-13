/**
 * How a movement's reps are divided across rounds.
 *
 * Two things can do the dividing, and they are not equals:
 *
 *  - A **rep scheme** (`WodMovement.repScheme`) — the workout's own structure,
 *    e.g. [21, 15, 9]. It comes from the WOD and is not the athlete's to
 *    change.
 *  - A **manual split** (`WorkoutSession.roundSplitCount`) — an athlete
 *    breaking a long flat movement into chunks mid-session, e.g. 45 push-ups
 *    as 5 x 9.
 *
 * Where both are present the scheme wins: it is how the workout is meant to be
 * performed, so it outranks a stale manual choice. That rule lives here, in one
 * implementation shared by the web client and the API, because the alternative
 * — the screen counting one workout while the record credits another — is
 * exactly the bug this module exists to make unrepresentable.
 */

/** A movement as far as round arithmetic cares: a total, and possibly a ladder. */
export type SplittableMovement = {
  reps: number;
  repScheme: number[];
};

/** True when the WOD's own structure sets the rounds, leaving nothing to split. */
export function hasRepScheme(movements: { repScheme: number[] }[]): boolean {
  return movements.some((m) => m.repScheme.length > 0);
}

/**
 * Rounds the scheme itself prescribes, or null for a WOD with no scheme.
 * Every scheme in a WOD is the same length (see `wodSchema`), so the first
 * one answers for all of them.
 */
export function schemeRoundCount(
  movements: { repScheme: number[] }[],
): number | null {
  const scheme = movements.find((m) => m.repScheme.length > 0);
  return scheme ? scheme.repScheme.length : null;
}

/**
 * Rounds to show for a WOD: the scheme's length if it has one, else whatever
 * the WOD declares. A 21-15-9 is three rounds whether or not `rounds` was set.
 */
export function effectiveRounds(wod: {
  rounds: number | null;
  movements: { repScheme: number[] }[];
}): number | null {
  return schemeRoundCount(wod.movements) ?? wod.rounds;
}

/** Splits `total` into `rounds` even chunks, front-loading the remainder. */
export function computeRoundReps(total: number, rounds: number): number[] {
  if (rounds <= 1) return [total];
  const base = Math.floor(total / rounds);
  const remainder = total % rounds;
  return Array.from({ length: rounds }, (_, i) => base + (i < remainder ? 1 : 0));
}

/**
 * The per-round counts a movement is actually performed at — the scheme as
 * given, an even split when the athlete asked for one, or a single round of
 * the full total.
 */
export function roundRepsFor(
  movement: SplittableMovement,
  roundSplitCount: number | null,
): number[] {
  if (movement.repScheme.length > 0) return movement.repScheme;
  if (!roundSplitCount || roundSplitCount <= 1) return [movement.reps];
  return computeRoundReps(movement.reps, roundSplitCount);
}

/**
 * Reps to show for a given 0-indexed round. Clamped to the last round so an
 * extra tap past the end of a ladder keeps showing the final round's count
 * rather than blanking the display.
 */
export function repsForRound(
  movement: SplittableMovement,
  roundIndex: number,
  roundSplitCount: number | null,
): number {
  const perRound = roundRepsFor(movement, roundSplitCount);
  return perRound[Math.min(Math.max(roundIndex, 0), perRound.length - 1)];
}

/** The movement with the highest total reps — the natural anchor for a reps-per-round split. */
export function anchorMovement<T extends { reps: number }>(movements: T[]): T {
  return movements.reduce((max, m) => (m.reps > max.reps ? m : max), movements[0]);
}

/** Round count that fits `repsPerRound` chunks of the anchor movement's total. */
export function roundsFromReps(anchorTotal: number, repsPerRound: number): number {
  return Math.max(1, Math.ceil(anchorTotal / Math.max(1, repsPerRound)));
}
