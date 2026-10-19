import { z } from "zod";
import { checklistKind, movementPattern } from "./enums.js";
import { instructionSteps } from "./exercise.js";

/**
 * One warm-up/cool-down checklist item (Feature #63) — deliberately minimal,
 * just enough to render a list, plus the steps that say how the movement is
 * performed. The checklists are where a first-timer meets a name like
 * "scapular pull-up", so the instructions ride along rather than costing a
 * second request.
 */
export const checklistExerciseSchema = z.object({
  id: z.string(),
  name: z.string(),
  instructions: instructionSteps,
});
export type ChecklistExercise = z.infer<typeof checklistExerciseSchema>;

/**
 * One of the athlete's own warm-up/cool-down entries, as Settings and the
 * exercise page show it (DN-173). Unlike `checklistExerciseSchema` this *is*
 * the entry: its id is what a remove or a reorder names, and the exercise
 * rides along for its name and its link.
 */
export const athleteChecklistEntrySchema = z.object({
  id: z.string(),
  kind: checklistKind,
  /** The day this entry is chosen for; null is filler for any day. */
  pattern: movementPattern.nullable(),
  sortOrder: z.number().int(),
  exercise: z.object({ id: z.string(), name: z.string() }),
});
export type AthleteChecklistEntry = z.infer<typeof athleteChecklistEntrySchema>;

/**
 * Put a movement on one of the athlete's own lists. No `ownerId`, and none
 * gets through: the tier is the route's, never the request's (DN-26). No
 * `instructions` either: an athlete's entry shows the exercise's own steps.
 */
export const createChecklistEntrySchema = z.object({
  exerciseId: z.string().min(1),
  kind: checklistKind,
  pattern: movementPattern.nullable(),
});
export type CreateChecklistEntry = z.infer<typeof createChecklistEntrySchema>;

/**
 * One of the athlete's lists in its new order: every one of their entries of
 * that kind, each named once. The whole list rather than a single move, so a
 * reorder sent from a stale screen is refused instead of half-applied.
 */
export const reorderChecklistEntriesSchema = z.object({
  kind: checklistKind,
  entryIds: z
    .array(z.string().min(1))
    .refine((ids) => new Set(ids).size === ids.length, {
      message: "Each entry may appear only once.",
    }),
});
export type ReorderChecklistEntries = z.infer<
  typeof reorderChecklistEntriesSchema
>;
