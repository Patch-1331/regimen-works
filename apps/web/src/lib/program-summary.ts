import type { CompletedProgram, RungChange } from "@regimen-works/shared";

/**
 * How a finished program reads, on the card above Today and in the Completed
 * list on History (DN-18).
 *
 * Its own module rather than part of either screen, because both render the
 * same sentence and a program that reads one way in the prompt and another in
 * the record would be two claims about one run.
 */

/** "pull: Negative chin-up → Chin-up" — the line, and where it started and ended. */
export function rungChangeText(change: RungChange): string {
  // The line is a column name, and an athlete reads "push horizontal".
  return `${change.line.replace(/_/g, " ")}: ${change.fromName} → ${change.toName}`;
}

/**
 * How long, how much of it was trained, and what moved.
 *
 * Built by joining only the parts that have something to say, so an
 * open-ended run reads "12 sessions" and a program nobody trained reads
 * "6 weeks · 0 sessions", rather than either trailing a separator into
 * nothing. Zero sessions and no rung changes are a real outcome and are
 * reported as one.
 */
export function summaryText(program: CompletedProgram): string {
  const { weeks, sessions, rungChanges } = program.summary;
  return [
    // Null for an open-ended run, which never had a length to report.
    ...(weeks === null ? [] : [`${weeks} ${weeks === 1 ? "week" : "weeks"}`]),
    `${sessions} ${sessions === 1 ? "session" : "sessions"}`,
    ...rungChanges.map(rungChangeText),
  ].join(" · ");
}
