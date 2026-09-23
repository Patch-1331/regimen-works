import type { CompletedProgram, MovementChange } from "@regimen-works/shared";

/**
 * How a finished program reads, on the card above Today and in the Completed
 * list on History (DN-18).
 *
 * Its own module rather than part of either screen, because both render the
 * same sentence and a program that reads one way in the prompt and another in
 * the record would be two claims about one run.
 */

/**
 * "pull: Negative chin-up → Chin-up" — the group, and what the athlete
 * performed in it at each end of the run.
 *
 * A null `fromName` is the athlete arriving with nothing chosen in this group
 * (DN-86), which is the ordinary case for a first program and reads as the
 * start it was. It is deliberately not filled in with the group's default:
 * they were handed that, they did not pick it (ADR-0004 decision 8).
 */
export function movementChangeText(change: MovementChange): string {
  // The group is a column name, and an athlete reads "push horizontal".
  const from = change.fromName ?? "not set";
  return `${change.movementGroup.replace(/_/g, " ")}: ${from} → ${change.toName}`;
}

/**
 * How long, how much of it was trained, and what moved.
 *
 * Built by joining only the parts that have something to say, so an
 * open-ended run reads "12 sessions" and a program nobody trained reads
 * "6 weeks · 0 sessions", rather than either trailing a separator into
 * nothing. Zero sessions and no movement changes are a real outcome and are
 * reported as one.
 */
export function summaryText(program: CompletedProgram): string {
  const { weeks, sessions, movementChanges } = program.summary;
  return [
    // Null for an open-ended run, which never had a length to report.
    ...(weeks === null ? [] : [`${weeks} ${weeks === 1 ? "week" : "weeks"}`]),
    `${sessions} ${sessions === 1 ? "session" : "sessions"}`,
    ...movementChanges.map(movementChangeText),
  ].join(" · ");
}
