import { z } from "zod";

export const movementPattern = z.enum([
  "push",
  "pull",
  "squat",
  "hinge",
  "core",
  "cardio",
]);
export type MovementPattern = z.infer<typeof movementPattern>;

/**
 * Finer-grained than MovementPattern — a pattern like push or core actually
 * contains multiple independent progression ladders (see docs/plan.md and
 * the "Scaling the Ladder" design doc for Feature #2).
 */
export const progressionLine = z.enum([
  "push_horizontal",
  "push_vertical",
  "pull",
  "squat",
  "hinge",
  "core_dynamic",
  "core_hold",
  "core_side",
]);
export type ProgressionLine = z.infer<typeof progressionLine>;

/**
 * The equipment catalog — what a movement needs beyond the athlete's own
 * body, and what the athlete says they own in Settings. One vocabulary for
 * both sides, so a tag written on an exercise and a box ticked in Settings
 * are the same word.
 *
 * It lives here, next to `movementPattern`, for the reason that enum does:
 * the seed's exercise tags, the API's ownership check and the web client's
 * option list all read one list instead of restating it three times and
 * drifting.
 *
 * `bodyweight` is deliberately not a member. The baseline is the absence of
 * a tag: an exercise that needs nothing carries no equipment, and there is
 * no Settings row for owning your own body. A value that is true for every
 * athlete and every movement is one every reader has to filter back out, so
 * the catalog holds only things an athlete can actually be without.
 *
 * Display labels and what each piece accepts live in `equipment.ts`.
 */
export const equipment = z.enum([
  "bar",
  "jump_rope",
  "box",
  "dumbbell",
  "kettlebell",
]);
export type Equipment = z.infer<typeof equipment>;

/** What an Exercise's `reps` count actually measures — most movements count reps, but a hold (e.g. plank) is timed. */
export const exerciseUnit = z.enum(["reps", "seconds"]);
export type ExerciseUnit = z.infer<typeof exerciseUnit>;

/** Tags an Exercise as warm-up/cool-down checklist content (Feature #63). Null for regular pool exercises. */
export const exercisePhase = z.enum(["warmup", "cooldown"]);
export type ExercisePhase = z.infer<typeof exercisePhase>;

export const wodType = z.enum(["amrap", "for_time", "emom", "tabata"]);
export type WodType = z.infer<typeof wodType>;

export const assignmentStatus = z.enum([
  "scheduled",
  "in_progress",
  "completed",
  "skipped",
]);
export type AssignmentStatus = z.infer<typeof assignmentStatus>;

export const sessionStatus = z.enum(["in_progress", "completed", "abandoned"]);
export type SessionStatus = z.infer<typeof sessionStatus>;

export const resultType = z.enum(["time_seconds", "rounds_reps", "total_reps"]);
export type ResultType = z.infer<typeof resultType>;
