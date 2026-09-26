import { z } from "zod";

/**
 * The rest between sets, and whose word it is (ADR 0005, DN-143).
 *
 * Two sources can speak to it, and they are different kinds of fact:
 *
 * - `PlanSlotMovement.restSeconds` is what the routine's *source* said. Null
 *   means the source was silent -- the routine DN-131 measured states rest 0
 *   times in 25 movements -- and 0 means "straight through", which is a
 *   prescription. The two are never converted into each other.
 * - `PlanEnrollment.defaultRestSeconds` is the pace the *athlete* chose for
 *   this run, when they committed to the routine. Null means "use the
 *   routine's own".
 */

/**
 * One rest interval in seconds, as either source states it. Null is part of
 * the type rather than an absence of it: "nobody said" is a value here.
 */
export const restSecondsSchema = z.number().int().nonnegative().nullable();

/**
 * The rest this athlete actually trains at, for one movement on one run.
 *
 * The athlete's pace if they set one -- it governs the whole run and replaces
 * every per-movement value, deliberately. Otherwise the movement's own, which
 * may itself be null: then no clock runs, because the only number available
 * would be one nobody wrote down.
 *
 * The result does not carry what it replaced. `prescribedName` records a
 * substitution *the app* made; this records one the athlete made on purpose,
 * and reporting their own decision back to them is noise rather than honesty.
 *
 * The one place rest is resolved. A `?? 0` anywhere downstream turns "the
 * source was silent" into "straight through", which is the invention the
 * nullable column exists to prevent.
 */
export function resolveRestSeconds(
  enrollmentDefault: number | null,
  movementRest: number | null,
): number | null {
  return enrollmentDefault ?? movementRest;
}

/**
 * How long the countdown between sets runs, or null where none does.
 *
 * Null for two different reasons that reach the same screen: 0 is a
 * prescription to go straight through, and null is no prescription at all.
 * Neither has a rest to count down -- but only the first may be described
 * as "straight through", which is why the resolved value, not this, is what
 * a label reads.
 */
export function restClockSeconds(restSeconds: number | null): number | null {
  return restSeconds === null || restSeconds === 0 ? null : restSeconds;
}

/**
 * Whether starting this routine must ask the athlete for a pace.
 *
 * Only where some movement leaves rest unstated. A routine with holes asks
 * the one question once rather than 25 times; a fully specified one -- every
 * built-in routine -- asks nothing, because it already knows.
 */
export function restPaceRequired(
  movements: readonly { restSeconds: number | null }[],
): boolean {
  return movements.some((m) => m.restSeconds === null);
}

/**
 * The athlete's pace for the program they are running, as Settings shows it.
 *
 * Null where there is nothing to pace: no active program, or one with no
 * straight-sets days at all -- Just WODs has no rest between sets to set.
 */
export const restPaceSchema = z.object({
  enrollmentId: z.string(),
  planName: z.string(),
  defaultRestSeconds: restSecondsSchema,
  /** True where the routine leaves some rest unstated, so blank is not an answer. */
  required: z.boolean(),
});
export type RestPace = z.infer<typeof restPaceSchema>;

/** What changing the pace mid-run sends. Null hands the run back to the routine's own values. */
export const updateRestPaceSchema = z.object({
  defaultRestSeconds: restSecondsSchema,
});
export type UpdateRestPace = z.infer<typeof updateRestPaceSchema>;
