import { z } from "zod";
import { planSchema } from "./plan.js";
import { restSecondsSchema } from "./rest.js";
import { SATURDAY, SUNDAY, trainingDaysSchema } from "./schedule.js";

/**
 * The first-run setup wizard (DN-15): three questions, then training.
 *
 * The questions are the three the app cannot guess -- which program, which
 * days, and when to start. There is deliberately no fourth about what the
 * athlete can do: nobody is placed anywhere, and the athlete fixes it
 * in one tap on their first workout, which is a better first impression than
 * a form asking how many pull-ups you can do before you have done one here.
 */

/**
 * How many days of start dates the picker offers, counting the earliest as
 * the first.
 *
 * Three weeks exactly, so the grid is three rows of seven and every weekday
 * appears the same number of times -- an athlete who wants to start "next
 * Monday" or "the Monday after" can, and one who wants to start in two months
 * is choosing a date they will have forgotten about by the time it arrives.
 */
export const SETUP_START_DATE_DAYS = 21;

/**
 * A program as the picker shows it.
 *
 * `planSchema` plus the one thing the picker needs that a plan's own fields
 * cannot answer: which weekdays a *fixed* program trains. A fixed program
 * carries no `defaultDays` -- its slots are the schedule -- so without this
 * the cadence screen could say "Fixed schedule" and not what it fixed them
 * to, which is the half the athlete actually wants to know.
 */
export const setupProgramSchema = z.intersection(
  planSchema,
  z.object({
    /**
     * The weekdays this program trains in its first week, 0 = Sunday,
     * ascending. Empty for a flexible program, which has no answer here:
     * the athlete's own picks are the answer, and `defaultDays` is where it
     * suggests some.
     *
     * The first week specifically, because a program's weeks need not agree
     * -- the same reason `scheduleLock.days` reports the current one. At
     * setup there is no current week yet, and week one is what the athlete
     * is about to live.
     */
    fixedDays: z.array(z.number().int().min(SUNDAY).max(SATURDAY)).max(7),
    /**
     * Whether this program has any straight sets, and so a rest between sets
     * for the athlete to set a pace for. False for Just WODs, where the
     * wizard asks nothing about rest -- a field there would do nothing.
     */
    hasStraightSets: z.boolean(),
    /**
     * Whether some movement in this program leaves its rest unstated, which
     * makes the wizard's rest field required (ADR 0005). Across every week,
     * not just the first: a hole in week six is still a clock the athlete
     * would reach with nothing to run.
     */
    restPaceRequired: z.boolean(),
  }),
);
export type SetupProgram = z.infer<typeof setupProgramSchema>;

/**
 * Everything the wizard needs to render, in one request.
 *
 * One request rather than three, because the wizard is the first screen an
 * athlete ever sees and a first screen that arrives in pieces is a first
 * screen that arrives wrong -- the day picker cannot be drawn before the
 * program bounding it is known, and the date grid cannot be drawn before the
 * earliest legal date is.
 */
export const setupOptionsSchema = z.object({
  programs: z.array(setupProgramSchema).min(1),
  /**
   * The athlete's stored training days, which the day picker starts from
   * unless they pick a program that suggests otherwise.
   *
   * Sent even though a brand-new athlete's are the Mon-Fri default: the
   * wizard is also reachable by an athlete who abandoned it halfway and came
   * back, and asking them to re-pick days they already picked is the thing
   * stamping `onboardedAt` last is supposed to avoid.
   */
  trainingDays: trainingDaysSchema,
  /**
   * The first date the athlete may start on.
   *
   * Today while today's workout is untouched, tomorrow once a session has
   * been started or a result logged. The line between the two is whether
   * choosing today would destroy work: starting today re-resolves today's
   * assignment under the new program, which is exactly right on a day not
   * yet trained and exactly wrong on one that has been.
   */
  earliestStartDate: z.string().date(),
  /** The last date offered, `SETUP_START_DATE_DAYS - 1` after the earliest. */
  latestStartDate: z.string().date(),
  /**
   * The rest pace the athlete set on their most recent run, to prefill the
   * field with. Null where they have never set one, which leaves a fully
   * specified program asking nothing at all.
   */
  lastRestSeconds: restSecondsSchema,
});
export type SetupOptions = z.infer<typeof setupOptionsSchema>;

/**
 * The three answers, committed together.
 *
 * Every field is checked against the chosen program by the service rather
 * than here, because every rule needs something this shape cannot see: the
 * day count needs the program's bounds, `weeks` needs to know whether the
 * program ends at all, and `startDate` needs a clock.
 */
export const commitSetupSchema = z.object({
  planId: z.string().min(1),
  /**
   * Null for a `fixed` program, whose days are not the athlete's to choose
   * -- and null rather than "sent and ignored", so a client that thinks it
   * is setting days on a fixed program is told it is wrong instead of being
   * agreed with and overruled.
   *
   * A flexible program requires them, and the count is checked against its
   * min/max where the program is loaded.
   */
  trainingDays: trainingDaysSchema.nullable(),
  /**
   * How many weeks to run it for. Null exactly when the program is
   * open-ended: Just WODs has no length to choose, and a number on it would
   * be a completion date for something that never completes.
   */
  weeks: z.number().int().positive().nullable(),
  startDate: z.string().date(),
  /**
   * The athlete's rest pace for this run, overriding every per-movement rest
   * (ADR 0005). Null keeps the program's own, which is only an answer when
   * the program states one everywhere -- the service refuses null on a
   * program with holes.
   *
   * Defaults to null so a client that never asks sends the answer a fully
   * specified program wants.
   */
  defaultRestSeconds: restSecondsSchema.default(null),
});
export type CommitSetup = z.infer<typeof commitSetupSchema>;
