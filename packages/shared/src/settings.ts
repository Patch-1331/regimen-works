import { z } from "zod";
import { equipment } from "./enums.js";
import { restPaceSchema } from "./rest.js";
import {
  SATURDAY,
  SUNDAY,
  patternCooldownDaysSchema,
  trainingDaysSchema,
} from "./schedule.js";

/**
 * The preferences the app exposes — now every column on `ScheduleRule` that is
 * a preference at all (DN-27).
 *
 * `scheduleLock` is the state DN-118 added: while a fixed program is driving
 * the schedule it overrides `trainingDays` outright, and a shape that could
 * only report the stored value would be reporting a value the scheduler is
 * ignoring.
 */
/**
 * Why `trainingDays` is not in effect, and what is running instead (DN-118).
 *
 * Null is the ordinary case, including for every athlete on a `flexible`
 * program -- which after DN-13 is everyone by default, since Just WODs is
 * flexible precisely so it defers to the days the athlete picked.
 *
 * Present only while a `fixed` program is inside its run. A fixed program's
 * slot layout *is* the schedule: that is what lets it insist on 48 hours
 * between heavy pull days, which "four days a week" cannot say. So for as
 * long as it runs, the athlete's own days are a preference on file rather
 * than a fact about their week.
 *
 * `trainingDays` keeps reporting the stored value rather than being
 * overwritten with the program's, because the stored value is still true --
 * it is what comes back when the run ends, and a screen that showed the
 * program's days in that field would have nothing left to restore them from.
 * This object is what says the field is asleep.
 */
export const scheduleLockSchema = z.object({
  planId: z.string(),
  /**
   * The program's name, and not optional. "Your schedule is locked" without
   * saying what locked it is not an answer the athlete can act on -- the
   * action available to them is ending the program, which they cannot take
   * if they are not told which one it is.
   */
  planName: z.string(),
  /**
   * The weekdays this program trains in the week the athlete is currently in,
   * 0 = Sunday, ascending.
   *
   * The *current* week, because a program's weeks need not agree with each
   * other -- a deload week can train fewer days than the block around it, and
   * a single answer for the whole program would be wrong in every week but
   * one.
   *
   * Not `trainingDaysSchema`, which requires at least one day: an athlete
   * picking no days has no app, but a program authoring a week of pure rest
   * has made a coaching decision, and the empty array is how it says so.
   */
  days: z.array(z.number().int().min(SUNDAY).max(SATURDAY)).max(7),
});
export type ScheduleLock = z.infer<typeof scheduleLockSchema>;

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
  /**
   * Read-only, and omitted from `updateSettingsSchema` below: it is an
   * account of the athlete's enrollment, not a preference of theirs, and the
   * way to change it is to end the program.
   */
  scheduleLock: scheduleLockSchema.nullable(),
  /**
   * The rest pace of the program being run (ADR 0005). Read-only here for the
   * same reason `scheduleLock` is -- it belongs to the enrollment, not to the
   * athlete's preferences -- and changed through `PATCH /programs/active/rest`.
   */
  restPace: restPaceSchema.nullable(),
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
 *
 * `scheduleLock` is refused outright rather than stripped. Zod drops unknown
 * keys quietly, and everywhere else in this app that is the right kindness --
 * but this field is part of the very shape being patched, so a client sending
 * it is not making a typo, it is trying to unlock its own schedule. That is
 * the one thing DN-118 exists to say no to, and saying it with a 400 is
 * better than saying it by dropping the key and returning 200. `z.never()`
 * accepts the field's absence and nothing else.
 *
 * `restPace` is refused the same way and for a smaller reason: it is written
 * to the enrollment, through its own endpoint, and a 200 here would claim a
 * change this route never made.
 */
export const updateSettingsSchema = settingsSchema
  .omit({ scheduleLock: true, restPace: true })
  .partial()
  .extend({
    scheduleLock: z.never().optional(),
    restPace: z.never().optional(),
  });
export type UpdateSettings = z.infer<typeof updateSettingsSchema>;
