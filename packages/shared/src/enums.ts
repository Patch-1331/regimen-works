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
  // The loaded ladders (DN-84) are their own lines rather than rungs appended
  // to `squat` and `hinge`: a goblet squat is not harder than a pistol, and
  // inserting one mid-ladder would renumber every rung above it, silently
  // changing what each athlete's stored `SkillLevel.rung` refers to.
  "squat_loaded",
  // The two lines where every rung needs equipment (DN-115). They exist so
  // the swap panel can offer both movements in a pair that share a piece of
  // kit: off a line the panel offers only the bodyweight alternative, so an
  // athlete who owns a rope but cannot yet turn double-unders was handed high
  // knees -- the app taking away gear they actually have.
  "squat_box",
  "hinge",
  "hinge_loaded",
  "core_dynamic",
  "core_hold",
  "core_side",
  "cardio_rope",
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

/**
 * Why a movement on the plate is not the one the library prescribed — read
 * alongside `prescribedName`, which carries what it replaced.
 *
 * Two automatic substitutions, and the difference matters to the athlete:
 * `remembered_choice` is a decision they made themselves once and the app is
 * still honouring (DN-88), while `equipment` is the app standing down from a
 * movement they have no gear for (DN-79). A screen that calls the second one
 * their pick is telling them something untrue.
 *
 * The day's own swap is not a member. It is marked by `isSwapped` and carries
 * no prescription at all: the athlete chose what they are looking at, and
 * naming what they overrode would argue with them.
 */
export const substitutionReason = z.enum(["remembered_choice", "equipment"]);
export type SubstitutionReason = z.infer<typeof substitutionReason>;

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
