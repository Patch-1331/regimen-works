import { z } from "zod";
import {
  movementPattern,
  planPhase,
  planSlotKind,
  scheduleMode,
  wodType,
} from "./enums.js";
import { SATURDAY, SUNDAY } from "./schedule.js";

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
  });
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
