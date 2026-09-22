import { z } from "zod";
import {
  equipment,
  exercisePhase,
  exerciseUnit,
  movementPattern,
  movementGroup,
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
  movementGroup: movementGroup.nullable(),
  rung: z.number().int().nonnegative().nullable(),
  fallbackExerciseId: z.string().nullable(),
  phase: exercisePhase.nullable(),
  /**
   * Which tier this row belongs to (DN-93): null is global library content,
   * set is the reading athlete's own. Exposed so the library UI can tell what
   * it may offer to edit — the API refuses the write either way.
   */
  ownerId: z.string().nullable(),
  /**
   * When it was retired (DN-25), or null while it is live. Reads that build a
   * pool never return archived rows at all; this is here for the management
   * screen, which is the one view that asks for them on purpose.
   */
  archivedAt: z.string().nullable(),
});
export type Exercise = z.infer<typeof exerciseSchema>;

/**
 * What a caller may write (DN-25).
 *
 * Written out rather than derived from `exerciseSchema` with `.omit()`. The
 * read shape is going to keep growing — `ownerId` and `archivedAt` arrived
 * together with these endpoints — and every field added to it would otherwise
 * become writable by inheritance, silently. The three fields missing here are
 * missing on purpose: `id` is the database's, and `ownerId`/`archivedAt` are
 * the server's answer to *which route was called*, never the body's to choose.
 */
export const createExerciseSchema = z.object({
  name: z.string().min(1),
  pattern: movementPattern.nullable(),
  equipment: z.array(equipment),
  scalable: z.boolean(),
  unit: exerciseUnit,
  instructions: z.string().nullable(),
  movementGroup: movementGroup.nullable(),
  rung: z.number().int().nonnegative().nullable(),
  fallbackExerciseId: z.string().nullable(),
  phase: exercisePhase.nullable(),
});
export type CreateExercise = z.infer<typeof createExerciseSchema>;

/**
 * A PATCH carries only what is changing, so two editors never have to restate
 * each other's fields — the same reasoning as `updateSettingsSchema`.
 *
 * `.partial()` makes every field optional but keeps each one's own type, so an
 * explicit `null` still means "clear it" and is told apart from absent.
 */
export const updateExerciseSchema = createExerciseSchema.partial();
export type UpdateExercise = z.infer<typeof updateExerciseSchema>;
