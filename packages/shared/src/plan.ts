import { z } from "zod";
import {
  movementPattern,
  planPhase,
  planSlotKind,
  progressionLine,
  scheduleMode,
  wodType,
} from "./enums.js";
import { SATURDAY, SUNDAY } from "./schedule.js";

/**
 * The id of the Just WODs program (DN-13), which every athlete is enrolled in
 * unless they have chosen something else.
 *
 * Shared rather than private to the API because both sides need to recognise
 * it, and for the same reason: Just WODs is the absence of programming, so a
 * screen that names it is telling the athlete about a program they did not
 * choose. Today's program strip and its rest-day copy both key off this.
 */
export const DEFAULT_PLAN_ID = "plan_just_wods";

/**
 * One movement a `movements` day prescribes, as authored (DN-19).
 *
 * The authoring shape. What the athlete is handed is
 * `prescribedMovementSchema`, where the line has already resolved to an
 * exercise at their rung — an author writes "pull", an athlete reads
 * "chin-up", and keeping the two shapes apart is what stops a client
 * resolving rungs for itself.
 *
 * Sets and reps sit here directly: no multiplier, no progression rule. An
 * author wanting escalation writes a core block that already waves
 * (3x5 / 4x5 / 5x5), which `expandPlanWeeks` repeats as a wave. A multiplier
 * would put the same fact in two places and let them disagree.
 */
export const planSlotMovementSchema = z
  .object({
    id: z.string(),
    /** Position in the session, 0-based, the way `WodMovement.order` is. */
    order: z.number().int().nonnegative(),
    /**
     * The progression line to resolve through the athlete's rung — the one to
     * reach for, because it is what lets one program fit every athlete.
     */
    line: progressionLine.nullable(),
    /**
     * A specific exercise instead, for the cases where the variation is the
     * point: a program teaching the negative names the negative, and an
     * athlete further up the line should still train it that day.
     */
    exerciseId: z.string().nullable(),
    sets: z.number().int().positive(),
    reps: z.number().int().positive(),
    /** 0 is a prescription — "straight through" — rather than an omission. */
    restSeconds: z.number().int().nonnegative(),
  })
  // Mirrors the PlanSlotMovement_line_xor_exercise CHECK. Neither set is a
  // rep count attached to nothing; both set is two different instructions in
  // one row, and a reader picking one would be guessing at the author.
  .refine((m) => (m.line !== null) !== (m.exerciseId !== null), {
    message:
      "a prescribed movement names a line or an exercise — one of them, not both and not neither",
    path: ["line"],
  });
export type PlanSlotMovement = z.infer<typeof planSlotMovementSchema>;

/**
 * One authored day (DN-9).
 *
 * `dayOfWeek` is a **calendar** weekday, not an offset from the enrollment's
 * start date. The two cannot coexist: a Mon/Tue/Thu/Fri program means nothing
 * if week 1 begins on a Wednesday, so program weeks align to calendar weeks
 * and `resolveSlotForDate` (DN-11) looks the day up by its weekday.
 *
 * The `wod_generated` constraints are nullable columns rather than a nested
 * object, mirroring the table: a null skips its axis, and the picker relaxes
 * them in a stated order rather than ever failing to produce a workout.
 */
export const planSlotSchema = z
  .object({
    id: z.string(),
    // 0 = Sunday … 6 = Saturday, the one numbering the app uses — see
    // `schedule.ts`, which states it for the whole app.
    dayOfWeek: z.number().int().min(SUNDAY).max(SATURDAY),
    kind: planSlotKind,
    /**
     * Which days survive when a flexible program runs at fewer days per week
     * than it was authored for: lower is kept first, so the program's main
     * session is 0. Never read for a fixed program, where every authored day
     * is trained.
     */
    priority: z.number().int().nonnegative(),
    /** The pinned WOD — see the refinement below. */
    wodId: z.string().nullable(),
    // What a generated day is allowed to be. `allowNamed` is false on most
    // slots because programs mostly program movement rather than benchmarks,
    // and a named WOD landing mid-progression is the surprise that default
    // protects against.
    pattern: movementPattern.nullable(),
    wodType: wodType.nullable(),
    allowNamed: z.boolean(),
    maxTimeCapMinutes: z.number().int().positive().nullable(),
    /**
     * The prescription, on a `movements` slot and empty on every other kind
     * — see the second refinement.
     *
     * Defaulted rather than required so a payload written before DN-19 still
     * parses as the WOD day it describes, which is every slot authored so
     * far.
     */
    movements: z.array(planSlotMovementSchema).default([]),
  })
  // Mirrors the PlanSlot_pinned_wod_present CHECK, and mirrors it as the
  // biconditional the constraint actually is rather than as the weaker "a
  // pinned slot has a wodId". A rest day pointing at a WOD is refused for the
  // same reason a pinned day with nothing pinned is: both are rows whose
  // `kind` and `wodId` tell different stories, and whichever one a reader
  // believes, the other is a bug waiting to surface.
  .refine((slot) => (slot.kind === planSlotKind.enum.wod_pinned) === (slot.wodId !== null), {
    message:
      "a wod_pinned slot needs a wodId, and no other kind may carry one",
    path: ["wodId"],
  })
  // The rule no CHECK can hold, because `kind` and the prescription rows live
  // in different tables (DN-19). Stated as the same biconditional for the same
  // reason as the one above: a rest day carrying sets and reps and a
  // `movements` day carrying none are both slots whose two halves describe
  // different days.
  //
  // The API is the other half of this. It resolves a `movements` slot with
  // nothing prescribed back to a generated WOD rather than handing the
  // athlete an empty screen — refusing to author the row here, and refusing
  // to crash on one that got in anyway.
  .refine(
    (slot) =>
      (slot.kind === planSlotKind.enum.movements) ===
      (slot.movements.length > 0),
    {
      message:
        "a movements slot needs at least one prescribed movement, and no other kind may carry any",
      path: ["movements"],
    },
  );
export type PlanSlot = z.infer<typeof planSlotSchema>;

/**
 * One authored week.
 *
 * `order` is its position as authored, 0-indexed — **not** the week the
 * athlete is in. That is a count from their start date, and one authored core
 * week is played several times over a run.
 */
export const planWeekSchema = z.object({
  id: z.string(),
  order: z.number().int().nonnegative(),
  phase: planPhase,
  /** Shown on the calendar preview, e.g. "Deload". Null where the week has nothing to say beyond its number. */
  label: z.string().nullable(),
  slots: z.array(planSlotSchema),
});
export type PlanWeek = z.infer<typeof planWeekSchema>;

/**
 * The program definition, without its weeks — what a picker row and the
 * Settings readout need.
 *
 * Kept separate from `planDetailSchema` because the two have genuinely
 * different costs: a picker listing eight programs does not want eight weeks
 * of seven slots each, and an endpoint handed a shape it cannot afford to
 * fill honestly is an endpoint that will return `weeks: []` and call it true.
 */
const planFields = z.object({
  id: z.string(),
  name: z.string(),
  /**
   * One line under the name in the picker. Required rather than nullable: a
   * program nobody can tell apart from the next one is not a program anyone
   * will choose.
   */
  summary: z.string(),
  /**
   * What finishing it is supposed to get you, where that is a single nameable
   * thing ("your first unassisted chin-up"). Null for programs that are a way
   * of training rather than a target — Just WODs is exactly that.
   */
  goal: z.string().nullable(),
  scheduleMode,
  minDaysPerWeek: z.number().int().min(1).max(7).nullable(),
  maxDaysPerWeek: z.number().int().min(1).max(7).nullable(),
  /**
   * Which weekdays a flexible program's picker starts on. Empty for fixed,
   * where the slots already answer it — and empty is also the honest value
   * for a flexible program with no opinion about which days, which is why
   * this is not `trainingDaysSchema`: that one requires at least one day,
   * because an athlete who trains on no days has no app. A *default* with no
   * days is a program declining to suggest, which is different.
   */
  defaultDays: z.array(z.number().int().min(SUNDAY).max(SATURDAY)),
  /**
   * How many weeks the athlete may run it for, and where the picker starts.
   * All three are null for an open-ended program: Just WODs never finishes,
   * so there is no length to choose and no last day to complete on.
   *
   * `minWeeks` has to clear `minimumViableWeeks` (DN-11) or the program can
   * end mid-wave on a light week. That is a count of authored weeks, so it is
   * checked where the weeks are visible rather than here.
   */
  minWeeks: z.number().int().positive().nullable(),
  maxWeeks: z.number().int().positive().nullable(),
  defaultWeeks: z.number().int().positive().nullable(),
});

/** The half of the schedule-mode CHECK that a shape with these three fields can answer. */
type ScheduleModeBounds = {
  scheduleMode: z.infer<typeof scheduleMode>;
  minDaysPerWeek: number | null;
  maxDaysPerWeek: number | null;
};

/**
 * Mirrors the Plan_schedule_mode_bounds CHECK: fixed carries neither day
 * bound, flexible carries both.
 *
 * Written as a named predicate rather than inline because both plan shapes
 * apply it, and a rule restated in two places is a rule that will eventually
 * be two different rules.
 */
function scheduleModeBoundsHold(plan: ScheduleModeBounds): boolean {
  const bounded = plan.minDaysPerWeek !== null && plan.maxDaysPerWeek !== null;
  return plan.scheduleMode === scheduleMode.enum.flexible
    ? bounded
    : plan.minDaysPerWeek === null && plan.maxDaysPerWeek === null;
}

const scheduleModeBoundsError = {
  message:
    "a flexible program needs both minDaysPerWeek and maxDaysPerWeek; a fixed program carries neither, because its slots are the schedule",
  path: ["scheduleMode"],
};

export const planSchema = planFields.refine(
  scheduleModeBoundsHold,
  scheduleModeBoundsError,
);
export type Plan = z.infer<typeof planSchema>;

/** The program with everything it authors — the calendar preview's shape. */
export const planDetailSchema = planFields
  .extend({ weeks: z.array(planWeekSchema) })
  .refine(scheduleModeBoundsHold, scheduleModeBoundsError);
export type PlanDetail = z.infer<typeof planDetailSchema>;
