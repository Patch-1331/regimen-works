import { z } from "zod";

/**
 * Weekday numbering, stated once for the whole app: **0 = Sunday … 6 = Saturday**.
 *
 * This is `Date.prototype.getUTCDay()`'s numbering, and it was already the de
 * facto convention on both sides before it was written down — `getWeekRange`
 * in `scheduler.logic.ts` and `isoWeekStart` in `apps/web/src/lib/stats.ts`
 * each reached for `getUTCDay()` independently. Naming it here means the
 * scheduler's weekday lookup needs no conversion at all.
 *
 * Monday-first is a *display* order, not a second numbering. A week strip that
 * renders Mon–Sun converts at the point it renders and nowhere else (DN-12).
 */
export const SUNDAY = 0;
export const SATURDAY = 6;

/** Mon–Fri, the spread that matches the old `maxDaysPerWeek` default of 5. */
export const DEFAULT_TRAINING_DAYS: readonly number[] = [1, 2, 3, 4, 5];

/**
 * The weekdays an athlete trains on (DN-12).
 *
 * At least one day, because an athlete who trains on no days has no app — and
 * "I'm taking a break" is answered by not opening it, not by emptying this.
 *
 * Duplicates are refused rather than quietly collapsed: a client sending
 * `[1, 1, 3]` believes it is asking for three days, and silently storing two
 * would leave it right about the request and wrong about the result. Order is
 * normalised instead, so a stored value is comparable to any other and a
 * picker's tap order never leaks into the database.
 */
export const trainingDaysSchema = z
  .array(z.number().int().min(SUNDAY).max(SATURDAY))
  .min(1, "Pick at least one training day.")
  .max(7)
  .refine(
    (days) => new Set(days).size === days.length,
    "A weekday can only be listed once.",
  )
  .transform((days) => [...days].sort((a, b) => a - b));

export const scheduleRuleSchema = z.object({
  id: z.string(),
  trainingDays: trainingDaysSchema,
  patternCooldownDays: z.number().int().min(0),
});
export type ScheduleRule = z.infer<typeof scheduleRuleSchema>;

export const updateScheduleRuleSchema = scheduleRuleSchema.omit({ id: true });
export type UpdateScheduleRule = z.infer<typeof updateScheduleRuleSchema>;

/**
 * Just the day count, for callers (e.g. the Stats page) that don't need the
 * full rule row.
 *
 * Derived from `trainingDays.length` rather than stored. "Days per week" is
 * the count of the days that were picked and never an input of its own, so
 * there is no column it could disagree with (DN-12).
 */
export const scheduleCapSchema = z.object({
  maxDaysPerWeek: z.number().int().min(1).max(7),
});
export type ScheduleCap = z.infer<typeof scheduleCapSchema>;
