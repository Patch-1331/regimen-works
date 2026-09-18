import { z } from "zod";
import { equipment } from "./enums.js";
import { trainingDaysSchema } from "./schedule.js";

/**
 * The preferences the app exposes. Still not full ScheduleRule CRUD —
 * `patternCooldownDays` remains unexposed, and is DN-27's to add once Programs
 * has reshaped it from a hard rule into a soft preference.
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
