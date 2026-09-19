import { z } from "zod";

/**
 * A movement the athlete swapped for this day only (WOD-5). The app decides
 * what you do; you decide how hard it is — this is the write path for the
 * second half of that, and the permanent rung change is confirmed afterwards
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
