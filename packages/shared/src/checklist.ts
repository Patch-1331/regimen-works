import { z } from "zod";
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
