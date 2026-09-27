import { z } from "zod";
import { movementGroup, scheduleMode } from "./enums.js";
import { refineRepShape, repShapeFields } from "./rep-shape.js";
import { restSecondsSchema } from "./rest.js";
import { SATURDAY, SUNDAY } from "./schedule.js";

/**
 * What a routine *is* on the way in (DN-145, ADR 0006).
 *
 * One definition for every path that writes one: the editor posts it, and the
 * export file is this same shape (decision 8), so admin create, copy and the
 * import command all hand the service the body the editor does. That is why
 * it is its own shape rather than `planDetailSchema` minus the ids -- a stored
 * plan says things an author never does (weeks, phases, priority, length),
 * and a file written against the stored shape would have to say them too.
 *
 * Strict at every level. An unknown key is refused rather than dropped,
 * because a file read back later that silently loses a field it carried is
 * a routine that has been edited by nobody.
 *
 * An authored routine is one repeating week (DN-145), and its length is
 * chosen at enrolment, so neither appears here.
 */

/**
 * One line of a day: a movement, and how much of it.
 *
 * The strictness ADR 0005 took out of the columns lives here -- a row the
 * database would store is not necessarily a row an author finished writing.
 */
export const routineLineSchema = z
  .strictObject({
    /** "Any pull, chosen by my equipment" -- resolved per athlete, per day. */
    movementGroup: movementGroup.nullable(),
    /** A specific exercise, where the variation is the point. */
    exerciseId: z.string().min(1).nullable(),
    sets: z.number().int().positive(),
    ...repShapeFields,
    /** Null is "the routine does not say" -- the pace at enrolment fills it. */
    restSeconds: restSecondsSchema,
    /**
     * Named only to be refused with a reason. Sources write loads ("3x5 @
     * 80%", "135 lb") and the app does not prescribe them -- the athlete's
     * load is their own, logged rather than dictated. A file carrying one is
     * told the editor dropped it rather than told it has an unknown key,
     * which would read as a bug in the file instead of a decision in the app.
     */
    load: z
      .never({
        error:
          "the editor does not store a load — prescribe sets and reps, and the athlete logs what they lift",
      })
      .optional(),
  })
  .superRefine(refineRepShape)
  // Every row names a group or an exercise, one of them. Neither is sets and
  // reps of nothing; both is two instructions in one row.
  .refine(
    (line) => (line.movementGroup !== null) !== (line.exerciseId !== null),
    {
      message: "each line names a movement group or an exercise — one of them",
      path: ["movementGroup"],
    },
  );
export type RoutineLine = z.infer<typeof routineLineSchema>;

/**
 * One day the routine trains. A rest day is the absence of one: there is no
 * rest entry to write, and a day with no lines is refused rather than stored
 * as an empty session.
 */
export const routineDaySchema = z.strictObject({
  // 0 = Sunday … 6 = Saturday, as everywhere in the app.
  dayOfWeek: z.number().int().min(SUNDAY).max(SATURDAY),
  lines: z
    .array(routineLineSchema)
    .min(1, "a training day needs at least one line"),
});
export type RoutineDay = z.infer<typeof routineDaySchema>;

export const createRoutineSchema = z
  .strictObject({
    name: z.string().trim().min(1, "name the routine").max(80),
    /**
     * The line under the name in the picker. Null lets the service write one
     * from the schedule -- a personal routine needs no pitch, but the picker
     * still needs a line.
     */
    summary: z
      .string()
      .trim()
      .max(140)
      .nullable()
      .transform((s) => (s === "" ? null : s)),
    /**
     * `fixed`: on these weekdays. `flexible`: any N days a week, in this
     * order, where N is the number of days and the order is the week's.
     */
    scheduleMode,
    days: z.array(routineDaySchema).min(1, "a routine trains at least one day"),
  })
  .refine(
    (r) => new Set(r.days.map((d) => d.dayOfWeek)).size === r.days.length,
    { message: "each weekday appears once", path: ["days"] },
  );
export type CreateRoutine = z.infer<typeof createRoutineSchema>;

/** A row in "My routines": enough to recognise it, not the whole week. */
export const routineSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  summary: z.string(),
  scheduleMode,
  /** The weekdays it was written on, Monday first. */
  days: z.array(z.number().int().min(SUNDAY).max(SATURDAY)),
  archived: z.boolean(),
});
export type RoutineSummary = z.infer<typeof routineSummarySchema>;

/**
 * The line under a routine's name when its author left it blank.
 *
 * Here rather than in the service so the editor can show, as a placeholder,
 * the exact line that will be stored.
 */
export function defaultRoutineSummary(
  mode: z.infer<typeof scheduleMode>,
  weekdays: number[],
): string {
  if (mode === "flexible") {
    const n = weekdays.length;
    return `Your routine, ${n} day${n === 1 ? "" : "s"} a week`;
  }
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const mondayFirst = [...weekdays].sort(
    (a, b) => ((a + 6) % 7) - ((b + 6) % 7),
  );
  return `Your routine, ${mondayFirst.map((d) => names[d]).join(" · ")}`;
}
