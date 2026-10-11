import { z } from "zod";
import {
  equipment,
  exerciseCategory,
  exerciseForce,
  exerciseLevel,
  exerciseMechanic,
  exercisePhase,
  exerciseUnit,
  muscle,
  movementPattern,
  movementGroup,
} from "./enums.js";

/**
 * How a movement is performed, as numbered steps (DN-165) — the setup, the
 * rep, and the cues that decide whether it is the movement at all.
 *
 * Empty when nobody has written any, which is the honest answer a null used
 * to give. A step is never blank: a screen numbering the list would print a
 * number with nothing after it.
 *
 * One definition for every shape that carries an exercise, so the library,
 * the plate and the checklists cannot disagree about what a step is.
 */
export const instructionSteps = z.array(z.string().trim().min(1));
export type InstructionSteps = z.infer<typeof instructionSteps>;

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
  // How the movement is performed, step by step. Empty on rows nobody has
  // written copy for.
  instructions: instructionSteps,
  movementGroup: movementGroup.nullable(),
  // Display order within the group, nothing more (DN-139) — no athlete's
  // choice resolves through it.
  sortOrder: z.number().int().nonnegative().nullable(),
  fallbackExerciseId: z.string().nullable(),
  phase: exercisePhase.nullable(),
  /**
   * The stable identity the library import matches on (DN-165, ADR-0007):
   * free-exercise-db's own id, or an `rw-` prefixed one for the app's own
   * exercises. Null on an athlete's own exercise, which no import touches.
   */
  key: z.string().nullable(),
  /**
   * What the movement works. The prime mover comes first. Both empty on an
   * exercise nobody has described — every athlete-owned one today — and
   * empty means "cannot be matched", never "matches anything".
   */
  primaryMuscles: z.array(muscle),
  secondaryMuscles: z.array(muscle),
  force: exerciseForce.nullable(),
  mechanic: exerciseMechanic.nullable(),
  /** A fact about the exercise, never the athlete — see `exerciseLevel`. */
  level: exerciseLevel.nullable(),
  category: exerciseCategory.nullable(),
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
 *
 * Nor are the library import's fields — `key`, the muscles, `force`,
 * `mechanic`, `level`, `category` (DN-165). They describe an exercise in the
 * dataset's terms, and the import is the one thing that writes them; an
 * athlete's own movement carries none, which the matcher reads as "cannot be
 * matched".
 */
export const createExerciseSchema = z.object({
  name: z.string().min(1),
  pattern: movementPattern.nullable(),
  equipment: z.array(equipment),
  scalable: z.boolean(),
  unit: exerciseUnit,
  instructions: instructionSteps,
  movementGroup: movementGroup.nullable(),
  // Display order within the group, nothing more (DN-139) — no athlete's
  // choice resolves through it.
  sortOrder: z.number().int().nonnegative().nullable(),
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
