import { z } from "zod";
import {
  equipment,
  exerciseCategory,
  exerciseForce,
  exerciseLevel,
  exerciseMechanic,
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
  // Null for a movement no pattern describes, like light jogging or deep
  // breathing.
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
  fallbackExerciseId: z.string().nullable(),
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
 * Nor is `key` (DN-165): it is the library import's identity for a row, and
 * the import is the one thing that writes it.
 *
 * The muscles, `force`, `mechanic`, `level` and `category` are writable
 * (DN-205). They are what the muscle match reads, and a movement nobody can
 * describe in them is one the match can never stand in for — which is what
 * left every athlete's own movement needing a hand-written alternative. A
 * prime mover is the least a movement says about itself, so it is required.
 */
export const createExerciseSchema = z.object({
  name: z.string().min(1),
  pattern: movementPattern.nullable(),
  equipment: z.array(equipment),
  scalable: z.boolean(),
  unit: exerciseUnit,
  instructions: instructionSteps,
  movementGroup: movementGroup.nullable(),
  fallbackExerciseId: z.string().nullable(),
  /** The prime mover first, as on `exerciseSchema`. */
  primaryMuscles: z.array(muscle).min(1),
  secondaryMuscles: z.array(muscle),
  force: exerciseForce.nullable(),
  mechanic: exerciseMechanic.nullable(),
  level: exerciseLevel.nullable(),
  category: exerciseCategory.nullable(),
});
export type CreateExercise = z.infer<typeof createExerciseSchema>;

/**
 * What the library form asks for alternative suggestions with (DN-205): the
 * movement as written so far, in the terms the muscle match reads. `selfId`
 * is the movement being edited, so it is never suggested as its own way out;
 * null on a create.
 */
export const alternativeSuggestionsRequestSchema = z.object({
  selfId: z.string().nullable(),
  unit: exerciseUnit,
  equipment: z.array(equipment),
  movementGroup: movementGroup.nullable(),
  primaryMuscles: z.array(muscle).min(1),
  secondaryMuscles: z.array(muscle),
  force: exerciseForce.nullable(),
  mechanic: exerciseMechanic.nullable(),
  level: exerciseLevel.nullable(),
  category: exerciseCategory.nullable(),
});
export type AlternativeSuggestionsRequest = z.infer<
  typeof alternativeSuggestionsRequestSchema
>;

/**
 * A PATCH carries only what is changing, so two editors never have to restate
 * each other's fields — the same reasoning as `updateSettingsSchema`.
 *
 * `.partial()` makes every field optional but keeps each one's own type, so an
 * explicit `null` still means "clear it" and is told apart from absent.
 */
export const updateExerciseSchema = createExerciseSchema.partial();
export type UpdateExercise = z.infer<typeof updateExerciseSchema>;

/**
 * How many rows one page of the library search holds (DN-171). Fixed rather
 * than a parameter, so the response stays small whoever asks: the library is
 * ~800 movements, and a browser filtering all of them is what the search
 * exists to replace.
 */
export const LIBRARY_PAGE_SIZE = 25;

/**
 * The library page's search and filters (DN-171), read from the query string.
 * Every filter is optional and they combine with AND; an absent one does not
 * narrow anything.
 *
 * `owned` is the string "true" or "false", as a query string carries it, and
 * reads as a boolean: only exercises whose kit is all in the athlete's
 * equipment. The page turns it on by default; the API does not, so a caller
 * that never mentions kit gets the whole library.
 */
export const exerciseSearchQuerySchema = z.object({
  /** Part of the name, any case. */
  q: z.string().trim().max(100).optional(),
  /** Works this muscle, as a prime mover or otherwise. */
  muscle: muscle.optional(),
  /** Needs this piece of equipment. */
  equipment: equipment.optional(),
  category: exerciseCategory.optional(),
  /** How demanding the exercise is — a filter on exercises, never on athletes. */
  level: exerciseLevel.optional(),
  pattern: movementPattern.optional(),
  owned: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  /** 1-based. A page past the end is empty, not an error. */
  page: z.coerce.number().int().min(1).default(1),
});
export type ExerciseSearchQuery = z.infer<typeof exerciseSearchQuerySchema>;

/** One page of the library search. `total` counts every match, not the page. */
export type ExerciseSearchPage<E> = {
  items: E[];
  total: number;
  page: number;
  pageSize: number;
};
