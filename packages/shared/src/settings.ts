import { z } from "zod";
import { equipment } from "./enums.js";
import { patternCooldownDaysSchema, trainingDaysSchema } from "./schedule.js";

/**
 * The preferences the app exposes — now every column on `ScheduleRule` that is
 * a preference at all (DN-27).
 *
 * What is still missing is not a field but a state: while a fixed program is
 * driving the schedule it overrides `trainingDays` outright, and this shape
 * has no way to say so. Reporting a value the scheduler is ignoring is the
 * failure mode there; DN-118 fixes it once there is an enrollment to read.
 */
export const settingsSchema = z.object({
  /** Feature #63 — show the warm-up/cool-down checklists at all. */
  warmupCooldownEnabled: z.boolean(),
  /**
   * Whether reaching a WOD's time cap stops the clock and ends the session.
   * On by default; turning it off hands the clock back to the athlete, who
   * then taps FINISH whenever they're done. Read through the session's own
   * `autoStopAtCap`, which is snapshotted at start — this is the preference
   * for the *next* workout, not a switch on one already running.
   */
  autoStopAtCapEnabled: z.boolean(),
  /**
   * What the athlete owns (DN-78). A standing fact about them rather than a
   * choice about today: it shapes what gets generated at all, where the
   * per-workout swap overrides what already was.
   *
   * Empty is meaningful — an athlete who owns nothing trains on bodyweight
   * alone — so there is no "unset" to distinguish from it. New athletes start
   * at the assumed baseline instead, which is `["bar"]` (DN-81); bodyweight
   * is not a member of the catalog, so owning nothing else is the empty array.
   */
  equipment: z.array(equipment),
  /**
   * Which weekdays the athlete trains on (DN-12), 0 = Sunday. This replaced
   * `maxDaysPerWeek`: the athlete picks days and the count follows from them,
   * so there is no second control stating the same fact differently.
   *
   * Whole-set replacement, like `equipment` — a week strip sends the days that
   * are lit, not the one that just changed.
   */
  trainingDays: trainingDaysSchema,
  /**
   * How long before a WOD's name or dominant pattern may repeat (DN-27), with
   * 0 meaning off. The bounds, and why 30 is the top, live on
   * `patternCooldownDaysSchema`.
   *
   * A scalar, so the per-field PATCH protection covers it outright: two tabs
   * changing it is the later write winning, which is what it should be.
   */
  patternCooldownDays: patternCooldownDaysSchema,
});
export type Settings = z.infer<typeof settingsSchema>;

/**
 * A PATCH carries only the fields being changed, so two independent switches
 * never have to restate each other's value — and a stale tab can't flip one
 * back by echoing what it last read.
 *
 * That protection is per field, and does not reach inside `equipment`: the
 * array is a whole-set replacement, with no add or remove verb. Two tabs
 * ticking different pieces means the later write wins outright, exactly as
 * two tabs setting the same toggle would.
 */
export const updateSettingsSchema = settingsSchema.partial();
export type UpdateSettings = z.infer<typeof updateSettingsSchema>;
