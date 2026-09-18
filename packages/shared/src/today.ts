import { z } from "zod";
import { checklistExerciseSchema } from "./checklist.js";
import { assignmentStatus } from "./enums.js";
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
});
export type TodayResponse = z.infer<typeof todayResponseSchema>;
