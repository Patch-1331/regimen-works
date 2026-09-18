import { z } from "zod";
import { checklistExerciseSchema } from "./checklist.js";
import { assignmentStatus, planSlotKind } from "./enums.js";
import { wodSchema } from "./wod.js";
import { workoutSessionSchema } from "./session.js";

export const todayAssignmentSchema = z.object({
  id: z.string(),
  date: z.string(),
  status: assignmentStatus,
  wod: wodSchema,
  /** Present once a workout has been started — lets a reloaded/locked screen resume the timer. */
  session: workoutSessionSchema.nullable(),
});
export type TodayAssignment = z.infer<typeof todayAssignmentSchema>;

/**
 * Which program day the athlete is training, when they are training one.
 *
 * Deliberately not the enrollment and not the plan: this block answers "where
 * am I in my program today?", and the screen that asks it wants a heading, not
 * a program definition. The full shapes are `planEnrollmentSchema` and
 * `planDetailSchema`, fetched by the screens that actually need them.
 */
export const todayPlanSchema = z.object({
  enrollmentId: z.string(),
  planId: z.string(),
  /** The program's name, for the heading above the plate. */
  name: z.string(),
  /**
   * Which week the athlete is in, **1-based** — the only 1-based number in
   * this vocabulary, because it is the one an athlete reads. `PlanWeek.order`
   * and `resolveSlotForDate`'s `weekIndex` are both 0-based and neither is
   * this: an authored core week is played several times over a run.
   */
  week: z.number().int().positive(),
  /** How many weeks this run lasts. Null for an open-ended program, where "week 3 of ..." has no second half. */
  totalWeeks: z.number().int().positive().nullable(),
  /** This week's label, e.g. "Deload". Null where the week has nothing to say beyond its number. */
  weekLabel: z.string().nullable(),
  /**
   * What the program makes of today. Null when the program is running but
   * authors nothing for this weekday — `resolveSlotForDate`'s `unscheduled`,
   * which is a different fact from an authored `rest` and is why that function
   * keeps the two apart.
   */
  slotKind: planSlotKind.nullable(),
});
export type TodayPlan = z.infer<typeof todayPlanSchema>;

/**
 * `assignment` is null exactly when `isRestDay` is true and no WOD has
 * been generated for today — today's weekday is not one the athlete trains on
 * (ScheduleRule.trainingDays). This used to mean the week's day quota had been
 * used up, which made rest days depend on the order the week was trained in;
 * since DN-12 it is a property of the date alone.
 */
export const todayResponseSchema = z.object({
  date: z.string(),
  isRestDay: z.boolean(),
  assignment: todayAssignmentSchema.nullable(),
  // Feature #63 — lets the web app decide whether to show the checklist
  // screens at all. Lists are null whenever the setting is off or there's
  // no assignment to build a checklist for (rest day).
  warmupCooldownEnabled: z.boolean(),
  warmup: z.array(checklistExerciseSchema).nullable(),
  cooldown: z.array(checklistExerciseSchema).nullable(),
  /**
   * The program context for today (DN-10), or null when there is none to
   * report: no active enrollment, or an enrollment whose start date has not
   * arrived and whose days still fall back to Just WODs.
   *
   * Nullable rather than a second response shape, so every existing client
   * path keeps working untouched while the program UI is built — a client
   * that ignores this field still renders today correctly, which is what
   * makes the block safe to add before anything reads it.
   */
  plan: todayPlanSchema.nullable(),
});
export type TodayResponse = z.infer<typeof todayResponseSchema>;
