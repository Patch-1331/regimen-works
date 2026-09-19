import { z } from "zod";
import { movementPattern, resultType, wodType } from "./enums.js";

export const workoutLogSchema = z.object({
  id: z.string(),
  assignmentId: z.string(),
  resultType: resultType,
  resultValue: z.string(),
  rpe: z.number().int().min(1).max(10).nullable(),
  notes: z.string().nullable(),
});
export type WorkoutLog = z.infer<typeof workoutLogSchema>;

/** Request body for POST /assignments/:id/log — assignmentId comes from the URL, not the body. */
export const logResultRequestSchema = z.object({
  resultType: resultType,
  resultValue: z.string().min(1),
  rpe: z.number().int().min(1).max(10).nullable().optional(),
  notes: z.string().nullable().optional(),
});
export type LogResultRequest = z.infer<typeof logResultRequestSchema>;

/**
 * One row of the History list — a log with just enough context to render it.
 *
 * `name` rather than `wodName`, and the WOD's own facts under a nullable
 * block, because a prescribed day (DN-126) has a name and no WOD at all.
 * Grouping them is what makes the absence legible: a consumer keyed on
 * `wodType` or `dominantPattern` has to reach through a null to get there,
 * so a strength session cannot quietly land in a chart of metcon formats
 * counted as an AMRAP push day.
 */
export const workoutLogListItemSchema = z.object({
  id: z.string(),
  assignmentId: z.string(),
  date: z.string(),
  /** The WOD's name, or what the day was — `"Strength"` on a prescribed one. */
  name: z.string(),
  /** Null on a prescribed day, which has no WOD and so neither of these. */
  wod: z
    .object({
      type: wodType,
      dominantPattern: movementPattern,
    })
    .nullable(),
  resultType: resultType,
  resultValue: z.string(),
  rpe: z.number().int().min(1).max(10).nullable(),
  notes: z.string().nullable(),
});
export type WorkoutLogListItem = z.infer<typeof workoutLogListItemSchema>;

/** A straight-sets result, as `resultValue` carries it. */
export type SetsResult = {
  /** Sets the athlete actually did. */
  completed: number;
  /** Sets the day prescribed. */
  total: number;
};

/**
 * A straight-sets result as one string: `"6/8"`.
 *
 * Both halves, the way `rounds_reps` carries `"5+12"` in one field. The
 * denominator is not decoration and not derivable later: the prescription it
 * refers to lives on an authored slot a program can edit, so a bare `6` read
 * back next year would be scored against whatever that day says *then*. `6/8`
 * says what was asked of the athlete on the day they answered it.
 */
export function formatSetsResult(result: SetsResult): string {
  return `${result.completed}/${result.total}`;
}

/**
 * Reads a `sets_completed` result back, or null where the string is not one.
 *
 * Null rather than a throw or a zeroed pair: this parses a column, and a row
 * written by some future version of the app is a row to skip rather than a
 * reason for the whole History list to fail. A zeroed pair would be worse
 * still -- it would render as a session where nothing got done.
 */
export function parseSetsResult(resultValue: string): SetsResult | null {
  const match = /^(\d+)\/(\d+)$/.exec(resultValue);
  if (!match) return null;

  const completed = Number(match[1]);
  const total = Number(match[2]);
  // A day prescribing nothing has no sets to have completed, and finishing
  // more sets than were asked for is not a better session -- it is a number
  // that did not come from this app.
  if (total === 0 || completed > total) return null;

  return { completed, total };
}
