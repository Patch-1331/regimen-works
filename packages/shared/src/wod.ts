import { z } from "zod";
import {
  equipment,
  exerciseUnit,
  movementPattern,
  progressionLine,
  substitutionReason,
  wodType,
} from "./enums.js";

export const wodMovementSchema = z
  .object({
    id: z.string(),
    // Count in whatever unit the exercise itself uses — see exercise.unit.
    // With a repScheme set this is the ladder's total, not a per-round count.
    reps: z.number().int().positive(),
    order: z.number().int().nonnegative(),
    // Per-round counts for a ladder — [21, 15, 9] for a 21-15-9. Empty means
    // the movement is `reps` every round, which is most of them. Read it
    // through packages/shared/round-split rather than indexing it directly.
    repScheme: z.array(z.number().int().positive()).default([]),
    // True when the athlete swapped this movement for today (WOD-5), so the
    // plate can mark it and the swap panel can offer to put it back. The
    // prescribed movement isn't carried alongside it: the athlete chose what
    // they see, and showing what they overrode would argue with them.
    isSwapped: z.boolean().default(false),
    // What the library prescribed, set only where something other than the
    // athlete's own tap for today replaced it — their remembered choice on
    // this line (DN-88), or the equipment they own (DN-79).
    //
    // Null on a row swapped today, for the reason above, and null when
    // nothing was replaced. A substitution applied automatically is the case
    // the silence was wrong for: the athlete never asked for it and was never
    // told it happened.
    prescribedName: z.string().nullable().default(null),
    // The same movement's id, so the screen can offer it back rather than
    // only naming it (DN-110). An athlete handed high knees for want of a
    // rope, standing in a gym that has one, could read what the workout
    // asked for and had no way to take it.
    //
    // Carried rather than derived on the client: the alternative is shared
    // between movements -- high knees stands in for several rope movements --
    // so working backwards from it is ambiguous exactly where the library is
    // growing, and every wrong guess is a 400 from the swap endpoint.
    //
    // Non-null exactly when `prescribedName` is, and defaulted for the same
    // reason: an older payload degrades to a panel that explains without
    // offering, not to a parse error.
    prescribedId: z.string().nullable().default(null),
    // Why it was replaced, so the screen can say so without guessing. Non-null
    // exactly when `prescribedName` is, and the two are read together: the
    // copy for a standing choice ("your pick") is a lie about a movement the
    // app dropped for want of a pull-up bar, which is not the athlete's pick
    // at all.
    //
    // Defaulted rather than required for the same reason `prescribedName` is:
    // a client reading an older payload should degrade to silence, not fail.
    prescribedReason: substitutionReason.nullable().default(null),
    exercise: z.object({
      id: z.string(),
      name: z.string(),
      pattern: movementPattern,
      // What performing it needs, in the place `needsBar` held: carried on
      // every movement the client is handed, so a screen can mark one the
      // athlete has no equipment for without a second request. Empty for the
      // bodyweight baseline, which is most of the pool.
      equipment: z.array(equipment),
      unit: exerciseUnit,
      // How the movement is performed, in prose — carried on the movement so
      // every screen that lists a WOD can offer it without a second request.
      // Null on exercises added outside the seed.
      instructions: z.string().nullable(),
      // Progression tracking (Feature #2) — null for exercises not on a
      // tracked ladder (e.g. cardio). See ProgressionLine for why this is
      // finer-grained than `pattern`.
      line: progressionLine.nullable(),
      // Where this exercise sits on that ladder, and its no-equipment
      // substitute. Carried on the movement so the Today plate's swap panel
      // (WOD-5) can mark the current rung and offer the alternative without
      // a second request. Both null off a tracked line.
      rung: z.number().int().nonnegative().nullable(),
      altExerciseId: z.string().nullable(),
    }),
  })
  // Mirrors the CHECK constraint on WodMovement. A scheme that doesn't sum to
  // `reps` would have the screen counting one workout while the record credits
  // another, so neither layer accepts it.
  .refine(
    (m) =>
      m.repScheme.length === 0 ||
      m.repScheme.reduce((sum, r) => sum + r, 0) === m.reps,
    { message: "repScheme must sum to reps", path: ["repScheme"] },
  );
export type WodMovement = z.infer<typeof wodMovementSchema>;

export const wodSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: wodType,
  timeCapMinutes: z.number().int().positive(),
  rounds: z.number().int().positive().nullable(),
  // Interval structure for the emom/tabata timer (Feature #30) — null on
  // AMRAP/For Time, and on interval WODs seeded before the fields existed.
  // Read these through `resolveIntervalConfig`, which fills the format's
  // classic structure in for the nulls.
  workSeconds: z.number().int().positive().nullable(),
  restSeconds: z.number().int().nonnegative().nullable(),
  intervalCount: z.number().int().positive().nullable(),
  isNamed: z.boolean(),
  dominantPattern: movementPattern,
  // How the workout is meant to be performed, in prose — the intent no other
  // field carries ("one pass, for time" vs. "as many rounds as possible").
  // Not where the rep numbers live; those are movements[].repScheme.
  description: z.string().nullable(),
  movements: z.array(wodMovementSchema),
})
  // A ladder is one shape for the whole WOD: 21-15-9 of push-ups and jump
  // squats is three rounds for both movements. Schemes of different lengths
  // would leave no single answer to "what round is this?".
  .refine(
    (wod) => {
      const lengths = wod.movements
        .map((m) => m.repScheme.length)
        .filter((n) => n > 0);
      return new Set(lengths).size <= 1;
    },
    {
      message: "every repScheme in a WOD must have the same length",
      path: ["movements"],
    },
  );
export type Wod = z.infer<typeof wodSchema>;
