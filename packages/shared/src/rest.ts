import { z } from "zod";

/**
 * The rest between sets, and whose word it is (ADR 0005, DN-143).
 *
 * Two sources can speak to it, and they are different kinds of fact:
 *
 * - `ProgramSlotSet.restSeconds` is what the program's *source* said. Null
 *   means the source was silent -- the program DN-131 measured states rest 0
 *   times in 25 movements -- and 0 means "straight through", which is a
 *   prescription. The two are never converted into each other.
 * - `ProgramEnrollment.defaultRestSeconds` is the pace the *athlete* chose for
 *   this run, when they committed to the program. Null means "use the
 *   program's own".
 */

/**
 * One rest interval in seconds, as either source states it. Null is part of
 * the type rather than an absence of it: "nobody said" is a value here.
 */
export const restSecondsSchema = z.number().int().nonnegative().nullable();

/**
 * Where a rest falls: between two sets of one line, or after a line's last
 * set, before whatever comes next.
 */
export type RestPosition = "between_sets" | "after_line";

/**
 * The rest this athlete actually trains at, after one set on one run.
 *
 * The athlete's pace if they set one -- it governs the whole run and replaces
 * every per-set value above zero, deliberately. Otherwise the set's own, which
 * may itself be null: then no clock runs, because the only number available
 * would be one nobody wrote down.
 *
 * **One exception (ADR 0011, decision 4):** an explicit 0 between two sets of
 * one line survives the pace. No rest between drops is what makes a drop set a
 * drop set -- *what you do*, which the app decides, rather than *how hard it
 * is*, which the athlete does. A 0 after a line's last set is the gap before
 * the next movement, which is pace again, so the pace still replaces it.
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
  setRest: number | null,
  position: RestPosition,
): number | null {
  if (setRest === 0 && position === "between_sets") return 0;
  return enrollmentDefault ?? setRest;
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
 * Whether starting this program must ask the athlete for a pace.
 *
 * Only where some set leaves rest unstated. A program with holes asks the
 * one question once rather than 25 times; a fully specified one -- every
 * built-in program -- asks nothing, because it already knows.
 */
export function restPaceRequired(
  sets: readonly { restSeconds: number | null }[],
): boolean {
  return sets.some((s) => s.restSeconds === null);
}

/**
 * The athlete's pace for the program they are running, as Settings shows it.
 *
 * Null where there is nothing to pace: no active program, or one with no
 * straight-sets days at all -- Just WODs has no rest between sets to set.
 */
export const restPaceSchema = z.object({
  enrollmentId: z.string(),
  programName: z.string(),
  defaultRestSeconds: restSecondsSchema,
  /** True where the program leaves some rest unstated, so blank is not an answer. */
  required: z.boolean(),
});
export type RestPace = z.infer<typeof restPaceSchema>;

/** What changing the pace mid-run sends. Null hands the run back to the program's own values. */
export const updateRestPaceSchema = z.object({
  defaultRestSeconds: restSecondsSchema,
});
export type UpdateRestPace = z.infer<typeof updateRestPaceSchema>;
