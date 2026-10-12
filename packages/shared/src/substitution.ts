import { z } from "zod";
import { equipment, exerciseLevel } from "./enums.js";

/**
 * A movement the athlete swapped for this day only (WOD-5). The app decides
 * what you do; you decide how hard it is — this is the write path for the
 * second half of that, and the permanent change of movement is confirmed afterwards
 * from what was actually trained.
 *
 * Keyed by the movement rather than by the exercise, so a day naming the same
 * line twice moves only the row the athlete tapped — and by *which kind* of
 * movement, because since DN-125 a day can be a program's straight sets
 * rather than a WOD, and those carry no `WodMovement` at all. Exactly one of
 * the two, mirroring the AssignmentSubstitution_movement_xor CHECK: neither
 * is a swap attached to nothing, and both is two movements with no way to
 * tell which was tapped.
 */
export const setSubstitutionRequestSchema = z
  .object({
    wodMovementId: z.string().min(1).nullable().default(null),
    planSlotMovementId: z.string().min(1).nullable().default(null),
    exerciseId: z.string().min(1),
  })
  .refine(
    (b) => (b.wodMovementId !== null) !== (b.planSlotMovementId !== null),
    {
      message:
        "a swap names a WOD movement or a prescribed movement — one of them, not both and not neither",
      path: ["wodMovementId"],
    },
  );
export type SetSubstitutionRequest = z.infer<
  typeof setSubstitutionRequestSchema
>;

/**
 * Which movement the swap panel is asking about (DN-170): the same either-or
 * as a swap itself, read from the query string rather than a body.
 */
export const swapOptionsQuerySchema = z
  .object({
    wodMovementId: z.string().min(1).nullable().default(null),
    planSlotMovementId: z.string().min(1).nullable().default(null),
  })
  .refine(
    (q) => (q.wodMovementId !== null) !== (q.planSlotMovementId !== null),
    {
      message:
        "options are for a WOD movement or a prescribed movement — one of them, not both and not neither",
      path: ["wodMovementId"],
    },
  );
export type SwapOptionsQuery = z.infer<typeof swapOptionsQuerySchema>;

/** One movement the panel offers. */
export const swapOptionSchema = z.object({
  exerciseId: z.string(),
  name: z.string(),
  /** How demanding the exercise is — never a statement about the athlete. */
  level: exerciseLevel.nullable(),
  equipment: z.array(equipment),
  /** The hand-written no-equipment stand-in for the movement. */
  isFallback: z.boolean(),
});
export type SwapOption = z.infer<typeof swapOptionSchema>;

/**
 * The swap panel's options for one movement, computed from the whole library
 * by the muscle match (DN-170). Each section is capped for display.
 *
 * - `main`: moves the athlete owns the kit for, at the same level or easier.
 * - `harder`: moves they own the kit for, at a higher level. The automatic
 *   swap never picks these; only the athlete does.
 * - `needsEquipment`: moves at the same level or easier that need kit they
 *   have not listed. Taking one is for the day; it never touches Settings.
 */
export const swapOptionsResponseSchema = z.object({
  main: z.array(swapOptionSchema),
  harder: z.array(swapOptionSchema),
  needsEquipment: z.array(swapOptionSchema),
});
export type SwapOptionsResponse = z.infer<typeof swapOptionsResponseSchema>;
