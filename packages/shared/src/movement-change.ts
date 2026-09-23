import { z } from "zod";
import { movementGroup } from "./enums.js";

/**
 * A change of standing movement the completion screen offers to make permanent
 * (WOD-6).
 *
 * The athlete swapped a movement before training; this is the offer to turn
 * that day's choice into their standing one. One per group, and declining is
 * free — the session is already logged either way.
 */
export const proposedMovementChangeSchema = z.object({
  movementGroup: movementGroup,
  /**
   * Null when the athlete has no standing choice in this group yet — the
   * ordinary case for a first swap since DN-86 stopped provisioning one for
   * everyone. It is a proposal like any other: "nothing chosen yet" →
   * "chin-ups".
   *
   * Note this is *not* the group's default member. The default is what they
   * were handed, not something they picked, and describing it as what they are
   * moving *from* would credit them with a choice they never made (ADR-0004
   * decision 8).
   */
  fromExerciseId: z.string().nullable(),
  fromExerciseName: z.string().nullable(),
  toExerciseId: z.string(),
  toExerciseName: z.string(),
});
export type ProposedMovementChange = z.infer<
  typeof proposedMovementChangeSchema
>;
