import { z } from "zod";
import { exerciseUnit, movementPattern, progressionLine, wodType } from "./enums.js";

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
    // What the library prescribed, set only where the athlete's remembered
    // choice on this line replaced it (DN-88) — which is also what marks the
    // row as a remembered choice rather than the day's prescription.
    //
    // Null on a row swapped today, for the reason above, and null when
    // nothing was replaced. A default applied automatically from weeks ago is
    // the case the silence was wrong for: the athlete never asked for the
    // substitution and was never told it happened.
    prescribedName: z.string().nullable().default(null),
    exercise: z.object({
      id: z.string(),
      name: z.string(),
      pattern: movementPattern,
      needsBar: z.boolean(),
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
  // `reps` would have the screen counting one workout while the advancement
  // math credits another, so neither layer accepts it.
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
