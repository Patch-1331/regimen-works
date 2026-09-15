import { z } from "zod";
import {
  equipment,
  exercisePhase,
  exerciseUnit,
  movementPattern,
  progressionLine,
} from "./enums.js";

export const exerciseSchema = z.object({
  id: z.string(),
  name: z.string(),
  // Null only for general warm-up/cool-down filler not tied to a pattern.
  pattern: movementPattern.nullable(),
  // What the movement needs beyond the athlete's own body. Empty is the
  // baseline: bodyweight is the absence of a tag rather than a tag of its own.
  equipment: z.array(equipment),
  scalable: z.boolean(),
  unit: exerciseUnit,
  // How the movement is performed, in prose. Null on rows added outside the
  // seed; every seeded exercise has one.
  instructions: z.string().nullable(),
  line: progressionLine.nullable(),
  rung: z.number().int().nonnegative().nullable(),
  altExerciseId: z.string().nullable(),
  phase: exercisePhase.nullable(),
});
export type Exercise = z.infer<typeof exerciseSchema>;

export const createExerciseSchema = exerciseSchema.omit({ id: true });
export type CreateExercise = z.infer<typeof createExerciseSchema>;
