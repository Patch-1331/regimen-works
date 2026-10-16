import { DEFAULT_PROGRAM_ID, type ProgramRun } from "@regimen-works/shared";
import { shortDate } from "./movementHistory";

/**
 * Where the run under way stands (DN-179): "Week 3 of 6", "Week 12" for an
 * open-ended one, or when it starts if that is still ahead.
 */
export function currentRunLine(run: ProgramRun): string {
  if (run.week === null) return `Starts ${shortDate(run.startDate)}`;
  return run.totalWeeks === null
    ? `Week ${run.week}`
    : `Week ${run.week} of ${run.totalWeeks}`;
}

/**
 * How a past run stopped: "finished, 6 weeks" or "ended at week 2 of 6".
 * Finished means it reached its last day; ended means the athlete started
 * something else first (DN-178), which is no failing, just a choice.
 */
export function pastRunLine(run: ProgramRun): string {
  const week = run.week ?? 1;
  if (run.status === "completed") {
    return `finished, ${week} week${week === 1 ? "" : "s"}`;
  }
  return run.totalWeeks === null
    ? `ended at week ${week}`
    : `ended at week ${week} of ${run.totalWeeks}`;
}

/**
 * What starting something else does to the run under way, said on the
 * confirm step of a start from Programs (DN-180): "This ends Pull-Up Builder
 * at week 2 of 6. What you've trained stays in your history."
 *
 * Null when there is nothing to say: no run, or Just WODs, which is no
 * program and so nothing the athlete gives up by leaving it.
 */
export function endsLine(run: ProgramRun | null): string | null {
  if (run === null || run.programId === DEFAULT_PROGRAM_ID) return null;
  if (run.week === null) {
    return `This replaces ${run.programName}, which hasn't started yet.`;
  }
  const at =
    run.totalWeeks === null
      ? `week ${run.week}`
      : `week ${run.week} of ${run.totalWeeks}`;
  return `This ends ${run.programName} at ${at}. What you've trained stays in your history.`;
}
