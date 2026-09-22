import { z } from "zod";
import {
  equipment,
  exerciseUnit,
  movementPattern,
  movementGroup,
  substitutionReason,
  wodType,
} from "./enums.js";

/**
 * The exercise as a training screen is handed it: what it is, what it needs,
 * and which group it belongs to.
 *
 * Narrower than `exerciseSchema` on purpose -- no `ownerId`, no `archivedAt`,
 * no `phase`. Those answer questions the library management screen asks, and
 * a plate that carried them would invite a client to make training decisions
 * out of library bookkeeping.
 *
 * Shared by the WOD plate and the prescribed-movements day (DN-19), so the
 * two describe a movement the same way rather than drifting apart.
 */
export const movementExerciseSchema = z.object({
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
  // Progression tracking (Feature #2) — null for movements in no group
  // (e.g. cardio). See MovementGroup for why this is finer-grained than
  // `pattern`.
  movementGroup: movementGroup.nullable(),
  // Where this exercise is listed among its group's members, and its
  // no-equipment fallback. Carried on the movement so the Today plate's
  // swap panel (WOD-5) can mark the current choice and offer the fallback
  // without a second request. Both null outside a group.
  rung: z.number().int().nonnegative().nullable(),
  fallbackExerciseId: z.string().nullable(),
});
export type MovementExercise = z.infer<typeof movementExerciseSchema>;

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
    exercise: movementExerciseSchema,
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

/**
 * One movement as a library write states it (DN-26).
 *
 * Spelled out rather than derived from `wodMovementSchema`, which is a read
 * shape: it carries `isSwapped`, `prescribedName`, `prescribedId` and
 * `prescribedReason`, all of which describe what happened to a movement in
 * one athlete's session and none of which mean anything in the library. Left
 * to inheritance, every field that shape grows would arrive here too.
 *
 * Two fields it deliberately does not have:
 *
 *   - `order`, which comes from this array's own indices. Accepted as a
 *     field, it could arrive duplicated or gapped, and `orderBy: { order }`
 *     would hand back a sequence nobody wrote.
 *   - `id`, because the movement list is written whole. See `updateWodSchema`.
 */
export const createWodMovementSchema = z
  .object({
    exerciseId: z.string().min(1),
    // Exactly one of these, which is the point — see the refinement. `reps`
    // is the flat case ("15 burpees every round"); `repScheme` is a ladder
    // ([21, 15, 9]), whose total is derived rather than restated.
    reps: z.number().int().positive().nullable().default(null),
    repScheme: z.array(z.number().int().positive()).default([]),
  })
  .refine((m) => (m.reps === null) !== (m.repScheme.length === 0), {
    message:
      "a movement is either a flat rep count or a ladder — give reps or repScheme, not both and not neither",
    path: ["reps"],
  });
export type CreateWodMovement = z.infer<typeof createWodMovementSchema>;

/**
 * The ordered movement list, with the one rule that spans it.
 *
 * At least one movement: a WOD with none parses, schedules, and hands the
 * athlete an empty screen at the moment they meant to train.
 */
const writeMovements = z
  .array(createWodMovementSchema)
  .min(1, "a WOD needs at least one movement")
  // The same rule `wodSchema` holds on the read side: a ladder is one shape
  // for the whole workout, so schemes of differing lengths leave no single
  // answer to "what round is this?".
  .refine(
    (movements) => {
      const lengths = movements
        .map((m) => m.repScheme.length)
        .filter((n) => n > 0);
      return new Set(lengths).size <= 1;
    },
    { message: "every repScheme in a WOD must have the same length" },
  );

/**
 * The fields a WOD write may set.
 *
 * No `ownerId` and no `archivedAt`. The tier is decided by which route was
 * called — `/wods` writes the caller's own, `admin/wods` writes global — and
 * archiving is its own endpoint, so neither is something a body can ask for.
 *
 * The interval fields are accepted as given and left null when they are not.
 * `resolveIntervalConfig` fills in the format's classic structure for the
 * nulls, and writing those defaults out explicitly would freeze today's EMOM
 * into rows that should keep following the helper. Whether they belong on
 * this WOD's `type` at all is a cross-field question the service settles,
 * because a PATCH need not restate `type`.
 */
const wodWriteFields = z.object({
  name: z.string().min(1),
  type: wodType,
  timeCapMinutes: z.number().int().positive(),
  rounds: z.number().int().positive().nullable(),
  workSeconds: z.number().int().positive().nullable(),
  restSeconds: z.number().int().nonnegative().nullable(),
  intervalCount: z.number().int().positive().nullable(),
  isNamed: z.boolean(),
  dominantPattern: movementPattern,
  description: z.string().nullable(),
  movements: writeMovements,
});

export const createWodSchema = wodWriteFields;
export type CreateWod = z.infer<typeof createWodSchema>;

/**
 * A PATCH carries only what is changing — the same reasoning as
 * `updateExerciseSchema`.
 *
 * `movements`, when present, replaces the list entirely rather than merging
 * into it. There are no per-movement routes: a `WodMovement` carries no
 * `ownerId`, so it is only ever authorized through the `Wod` that owns it,
 * and writing the list through its parent is what makes that true by
 * construction rather than by a check. Absent, the list is untouched.
 */
export const updateWodSchema = wodWriteFields.partial();
export type UpdateWod = z.infer<typeof updateWodSchema>;
