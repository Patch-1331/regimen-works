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
 * A set of movements that accomplish the same thing in a program, freely
 * interchangeable. Finer-grained than MovementPattern — a pattern like push
 * or core contains several groups that are *not* interchangeable.
 *
 * **Membership is a statement about role, not about difficulty.** A group is
 * unordered and nothing compares two of its members; `Exercise.sortOrder`
 * decides only what the swap panel lists first. See ADR-0004, and DN-130 for
 * the audit that found no running code ever read this as a ladder.
 */
export const movementGroup = z.enum([
  "push_horizontal",
  "push_vertical",
  "pull",
  "squat",
  // The equipment-split groups (DN-84, DN-115). They exist so the swap panel
  // can offer both movements in a pair that share a piece of kit: off a group
  // the panel offers only the bodyweight fallback, so an athlete who owns a
  // rope but cannot yet turn double-unders was handed high knees -- the app
  // taking away gear they actually have.
  //
  // DN-84 originally justified the split on two other grounds, and neither
  // survives: nothing in the code can tell whether a goblet squat is harder
  // than a pistol, and inserting a movement mid-group no longer renumbers
  // anything. ADR-0004 folds these back into `squat` and `hinge` for exactly
  // that reason; until that lands they stay, on DN-115's grounds alone.
  "squat_loaded",
  "squat_box",
  "hinge",
  "hinge_loaded",
  "core_dynamic",
  "core_hold",
  "core_side",
  "cardio_rope",
]);
export type MovementGroup = z.infer<typeof movementGroup>;

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

/**
 * What kind of number a finished session produced.
 *
 * The first three are metcon scores, and all three are a clock or a count
 * under one. `sets_completed` is the prescribed day's (DN-126), and is the
 * odd one out on purpose: a straight-sets session has no clock over it and no
 * single scalar, so what it produced is the sets that got done against the
 * sets that were asked for. `resultValue` carries both halves as
 * `"done/total"` -- see `formatSetsResult` in `log.ts` for why the
 * denominator is not optional.
 */
export const resultType = z.enum([
  "time_seconds",
  "rounds_reps",
  "total_reps",
  "sets_completed",
]);
export type ResultType = z.infer<typeof resultType>;

/**
 * Where an authored week sits in a program's arc (DN-9).
 *
 * The three are not decoration: `expandPlanWeeks` (DN-11) plays intro once,
 * cycles `core` in order to reach the length the athlete chose, then plays
 * peak. A week carrying anything else is a week that function will not play,
 * which is why this is an enum rather than a free label. `PlanWeek.label` is
 * where "Deload" and the like belong.
 */
export const planPhase = z.enum(["intro", "core", "peak"]);
export type PlanPhase = z.infer<typeof planPhase>;

/**
 * What a program makes of one day.
 *
 * `rest` is the program's own rest day, and is a positive instruction rather
 * than an absence — a week that authors nothing for Wednesday is a different
 * fact, which `resolveSlotForDate` reports as `unscheduled`.
 *
 * `wod_pinned` names a specific WOD, for benchmark re-tests. `wod_generated`
 * carries constraints the existing picker resolves against the library.
 *
 * `movements` is prescribed sets and reps, and is the shape that does not
 * exist yet: `PlanSlot` carries no prescription columns, and the session and
 * log models have nowhere to put a straight-sets result (docs/design/programs.md
 * §3). It is a member here because the vocabulary is decided even though the
 * machinery is not — a slot of this kind cannot be authored until DN-19.
 */
export const planSlotKind = z.enum([
  "rest",
  "wod_pinned",
  "wod_generated",
  "movements",
]);
export type PlanSlotKind = z.infer<typeof planSlotKind>;

/**
 * Whether the cadence screen is an input or a readout.
 *
 * `flexible` lets the athlete tap which weekdays they train, bounded by the
 * plan's day counts. `fixed` means the slot layout *is* the schedule, which
 * is what lets a program insist on spacing rather than mere frequency: 48
 * hours between heavy pull days is Mon/Tue/Thu/Fri, which "4 days a week"
 * cannot say.
 */
export const scheduleMode = z.enum(["fixed", "flexible"]);
export type ScheduleMode = z.infer<typeof scheduleMode>;

/**
 * Where an athlete's run at a program has got to.
 *
 * Only `active` is constrained: a partial unique index holds one active
 * enrollment per athlete, so `completed` is both the end state and the reason
 * a finished run stops occupying that slot. There is no `cancelled` — leaving
 * a program early is completing it early, and the completion card can still
 * say what changed.
 */
export const enrollmentStatus = z.enum(["active", "completed"]);
export type EnrollmentStatus = z.infer<typeof enrollmentStatus>;
