import { z } from "zod";
import { movementGroup, substitutionReason } from "./enums.js";
import { refineRepShape, repShapeFields } from "./rep-shape.js";
import { loadStepPercentSchema } from "./program.js";
import { restSecondsSchema } from "./rest.js";
import { movementExerciseSchema } from "./wod.js";

/**
 * A prescribed-movements day, as the athlete is handed it (DN-19).
 *
 * The other shape a program day can take. A WOD day carries a `Wod`; this one
 * carries straight sets — "pull, 5x3, rest 90s" — with no clock over it and
 * no single score at the end.
 *
 * **Resolved, not authored.** The program names a movement *group*, which is
 * what lets one program fit every athlete; what arrives here is the movement
 * this athlete performs in that group, dropped to its no-equipment
 * alternative where they own nothing for it. The authoring shape
 * is `programSlotMovementSchema` in `program.ts`, and the two are deliberately
 * different: an author writes "pull", an athlete reads "chin-up".
 */
/**
 * One set as the athlete is handed it (ADR 0011): its count, its load step,
 * and the rest after it -- already resolved through the athlete's pace.
 *
 * Its own shape, not `programSetSchema`, for the reason the movement is: the
 * authored rest is what the source said, and this one is what this athlete
 * rests. The two differ wherever a pace is set, and a client handed the
 * authored value would have to resolve it itself.
 */
export const prescribedSetSchema = z
  .object({
    /**
     * The prescribed count, in one of three shapes — see `repShapeFields`, which
     * documents all three. Counted in whatever unit the exercise uses: see
     * `exercise.unit`, which makes a hold's "reps" seconds.
     */
    ...repShapeFields,
    /** Relative to the set before, or null where the source said nothing — see `loadStepPercentSchema`. */
    loadStepPercent: loadStepPercentSchema,
    /**
     * The rest after this set, already resolved through the athlete's pace
     * for the run — see `resolveRestSeconds`. 0 says "straight through",
     * which is a prescription; null says nobody stated one, and no clock runs.
     */
    restSeconds: restSecondsSchema,
  })
  .superRefine(refineRepShape);
export type PrescribedSet = z.infer<typeof prescribedSetSchema>;

export const prescribedMovementSchema = z.object({
  /** The `ProgramSlotMovement` id. Stable across reads, which is what a per-set log will key on (DN-21). */
  id: z.string(),
  order: z.number().int().nonnegative(),
  /**
   * In order, one entry per set (ADR 0011). A uniform 3 × 8 is three identical
   * entries, the same as it is stored; an RPT line is three different ones.
   */
  sets: z.array(prescribedSetSchema).min(1),
  /**
   * The line this was prescribed by, or null where the author pinned a
   * specific exercise because the variation was the point.
   *
   * Carried rather than inferred from `exercise.line`: those are the same
   * value in a group-prescribed row and mean different things — this one is
   * what the *program* asked for, and it survives the athlete being dropped
   * outside the group entirely by an equipment fallback.
   */
  movementGroup: movementGroup.nullable(),
  /** What this athlete actually trains today. */
  exercise: movementExerciseSchema,
  /** True where the athlete swapped this row themselves, for today only (DN-125). */
  isSwapped: z.boolean(),
  /**
   * What the group resolved to before an automatic layer replaced it, and
   * which layer did — the same honesty rule the WOD plate follows (DN-79,
   * DN-88): an app that quietly hands somebody a different movement should
   * at least say so.
   *
   * Only `equipment` can appear here today. A WOD's `remembered_choice`
   * has no counterpart on this shape, because resolving through the
   * athlete's standing choice *is* the prescription rather than a
   * substitution for it.
   *
   * All three are null on a row the athlete swapped: naming what a swap
   * overrode would argue with a decision just made (DN-116).
   */
  prescribedName: z.string().nullable(),
  /** The prescribed exercise's id, so the swap panel can offer it back (DN-110). */
  prescribedId: z.string().nullable(),
  prescribedReason: substitutionReason.nullable(),
});
export type PrescribedMovement = z.infer<typeof prescribedMovementSchema>;

/**
 * The day's prescription, in order.
 *
 * At least one movement: a prescribed day with none is an empty screen at the
 * moment the athlete meant to train, so the API falls the slot back to a
 * generated WOD rather than ever sending this with an empty list.
 */
export const prescriptionSchema = z.object({
  movements: z.array(prescribedMovementSchema).min(1),
});
export type Prescription = z.infer<typeof prescriptionSchema>;

/**
 * What a prescribed day is called, wherever one needs a name (DN-126).
 *
 * A WOD carries its own; a prescribed day is authored as a slot and has none,
 * so History, the logs list and the Today plate would each have invented one.
 * A constant rather than three string literals, because the athlete seeing
 * "Strength" on Today and something else in History would reasonably think
 * they were two different things.
 *
 * Not the program's name and not the week's: those answer "which program am I
 * running", and a history row wants to say what the *day* was.
 */
export const PRESCRIBED_DAY_NAME = "Strength";
