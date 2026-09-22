import { z } from "zod";
import { movementGroup } from "./enums.js";

/**
 * A rung change the completion screen offers to make permanent (WOD-6).
 *
 * The athlete swapped a movement before training; this is the offer to turn
 * that day's choice into their standing level. One per group, and declining is
 * free — the session is already logged either way.
 */
export const proposedRungChangeSchema = z.object({
  movementGroup: movementGroup,
  /**
   * Null when the athlete has no default in this group yet — the ordinary case
   * for a first swap since DN-86 stopped provisioning a rung for everyone. It
   * is a proposal like any other: "no default yet" → "chin-ups".
   */
  fromRung: z.number().int().nonnegative().nullable(),
  toRung: z.number().int().nonnegative(),
  exerciseId: z.string(),
  exerciseName: z.string(),
});
export type ProposedRungChange = z.infer<typeof proposedRungChangeSchema>;
