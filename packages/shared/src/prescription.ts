import { z } from "zod";
import { progressionLine, substitutionReason } from "./enums.js";
import { movementExerciseSchema } from "./wod.js";

/**
 * A prescribed-movements day, as the athlete is handed it (DN-19).
 *
 * The other shape a program day can take. A WOD day carries a `Wod`; this one
 * carries straight sets — "pull, 5x3, rest 90s" — with no clock over it and
 * no single score at the end.
 *
 * **Resolved, not authored.** The program names a progression *line*, which is
 * what lets one program fit every athlete; what arrives here is the exercise
 * that line resolves to at the rung this athlete owns, dropped to its
 * no-equipment alternative where they own nothing for it. The authoring shape
 * is `planSlotMovementSchema` in `plan.ts`, and the two are deliberately
 * different: an author writes "pull", an athlete reads "chin-up".
 */
export const prescribedMovementSchema = z.object({
  /** The `PlanSlotMovement` id. Stable across reads, which is what a per-set log will key on (DN-21). */
  id: z.string(),
  order: z.number().int().nonnegative(),
  sets: z.number().int().positive(),
  /** Count in whatever unit the exercise uses — see `exercise.unit`, which makes a hold's "reps" seconds. */
  reps: z.number().int().positive(),
  /** Prescribed rest between sets. 0 says "straight through", which is a prescription rather than an omission. */
  restSeconds: z.number().int().nonnegative(),
  /**
   * The line this was prescribed by, or null where the author pinned a
   * specific exercise because the variation was the point.
   *
   * Carried rather than inferred from `exercise.line`: those are the same
   * value on a line-prescribed row and mean different things — this one is
   * what the *program* asked for, and it survives the athlete being dropped
   * off the line entirely by an equipment fallback.
   */
  line: progressionLine.nullable(),
  /** What this athlete actually trains today. */
  exercise: movementExerciseSchema,
  /** True where the athlete swapped this row themselves, for today only (DN-125). */
  isSwapped: z.boolean(),
  /**
   * What the line resolved to before an automatic layer replaced it, and
   * which layer did — the same honesty rule the WOD plate follows (DN-79,
   * DN-88): an app that quietly hands somebody a different movement should
   * at least say so.
   *
   * Only `equipment` can appear here today. A WOD's `remembered_choice`
   * has no counterpart on this shape, because resolving through the
   * athlete's rung *is* the prescription rather than a substitution for it.
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
