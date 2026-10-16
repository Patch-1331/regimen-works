import type { ProgramRun } from "@regimen-works/shared";
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
