import { z } from "zod";
import {
  exerciseUnit,
  progressionLine,
  sessionStatus,
  substitutionReason,
} from "./enums.js";

export const roundSplitSchema = z.object({
  round: z.number().int().positive(),
  atSeconds: z.number().int().nonnegative(),
});
export type RoundSplit = z.infer<typeof roundSplitSchema>;

/**
 * One movement as it was actually trained (DN-90). A WOD is resolved at read
 * time through several layers -- the athlete's current rung, then today's
 * swap -- and every one of those inputs keeps moving afterwards. This is the
 * output of that resolution, written onto the session when it starts, so
 * history can say what was done rather than re-deriving what today's settings
 * would have done.
 *
 * The exercise fields are copied, not referenced, for the same reason: a
 * renamed exercise or a re-rung ladder must not rewrite August.
 */
export const sessionMovementSchema = z.object({
  /** The WodMovement this row stood in for -- the join back to the template. */
  wodMovementId: z.string(),
  order: z.number().int().nonnegative(),
  /** Total count, in the exercise's own unit; with a repScheme this is the ladder's sum. */
  reps: z.number().int().positive(),
  repScheme: z.array(z.number().int().positive()),
  /** True when this is the athlete's own swap for the day rather than their standing choice. */
  isSwapped: z.boolean(),
  /**
   * What the library prescribed, where the athlete's remembered choice
   * (DN-88) or their equipment (DN-79) replaced it. Defaults to null so
   * sessions snapshotted before the field existed still parse — they predate
   * it, and there is no honest way to fill it in after the fact.
   *
   * Recorded on a row the athlete swapped, too (DN-116) — the Today plate
   * hides it there, history keeps it. So on a session written before that
   * change, a null beside `isSwapped: true` means *not recorded* rather than
   * "nothing replaced it", and reading it as the latter would invent a fact
   * about a day nobody can go back to.
   */
  prescribedName: z.string().nullable().default(null),
  /**
   * Why it was replaced. Null for the same reasons `prescribedName` is, and
   * additionally on a session snapshotted between DN-88 and DN-79, where the
   * name was recorded and the reason was not — every such row was a
   * remembered choice, but guessing that here would bake an assumption into
   * history rather than leave the gap visible.
   */
  prescribedReason: substitutionReason.nullable().default(null),
  exercise: z.object({
    id: z.string(),
    name: z.string(),
    unit: exerciseUnit,
    line: progressionLine.nullable(),
    rung: z.number().int().nonnegative().nullable(),
  }),
});
export type SessionMovement = z.infer<typeof sessionMovementSchema>;

export const workoutSessionSchema = z.object({
  id: z.string(),
  assignmentId: z.string(),
  startedAt: z.string().datetime(),
  capSeconds: z.number().int().positive(),
  roundSplits: z.array(roundSplitSchema),
  /**
   * What the athlete actually trained, resolved once when the session started
   * (DN-90). Empty only on sessions that predate the snapshot -- a WOD always
   * has movements -- so an empty list reads as "not recorded", never "none".
   */
  movements: z.array(sessionMovementSchema),
  status: sessionStatus,
  /** Elapsed time when "Finish" was tapped — the natural score for a For Time WOD. */
  finishedAtSeconds: z.number().int().nonnegative().nullable(),
  /** Optional user-chosen round count to break high-rep movements into; null = unsplit. */
  roundSplitCount: z.number().int().positive().nullable(),
  /**
   * Whether this session's clock stops at `capSeconds`, copied from the
   * athlete's setting when the session started (see `settingsSchema`). False
   * means the clock runs on past the cap and only a FINISH tap ends it.
   */
  autoStopAtCap: z.boolean(),
  // Feature #63 — stamped when each checklist is finished; null if skipped
  // or the setting is off.
  warmupCompletedAt: z.string().datetime().nullable(),
  cooldownCompletedAt: z.string().datetime().nullable(),
  // Feature #30 — where the EMOM/Tabata interval timer has got to. Both are
  // null on a non-interval WOD and until the timer is started; together they
  // let a reloaded screen resume mid-interval instead of restarting the
  // sequence. `intervalIndex === intervalCount` means the last interval has
  // run out, so the sequence is done.
  intervalIndex: z.number().int().nonnegative().nullable(),
  /** Elapsed seconds (from `startedAt`) at which `intervalIndex` began. */
  intervalStartedAtSeconds: z.number().int().nonnegative().nullable(),
});
export type WorkoutSession = z.infer<typeof workoutSessionSchema>;

/** Sent on every "round complete" tap so a locked/refreshed screen never loses progress. */
export const logRoundSplitSchema = z.object({
  round: z.number().int().positive(),
  atSeconds: z.number().int().nonnegative(),
});
export type LogRoundSplit = z.infer<typeof logRoundSplitSchema>;

export const setRoundSplitRequestSchema = z.object({
  roundSplitCount: z.number().int().positive().nullable(),
});
export type SetRoundSplitRequest = z.infer<typeof setRoundSplitRequestSchema>;

/**
 * Sent as each interval rolls over, so a locked or refreshed screen picks
 * the sequence back up where it was — the interval-timer counterpart to
 * logRoundSplit's autosave.
 *
 * `intervalIndex` is the 0-based interval now starting; passing
 * `intervalCount` (one past the last) marks the sequence finished.
 */
export const advanceIntervalSchema = z.object({
  intervalIndex: z.number().int().nonnegative(),
  atSeconds: z.number().int().nonnegative(),
});
export type AdvanceInterval = z.infer<typeof advanceIntervalSchema>;
