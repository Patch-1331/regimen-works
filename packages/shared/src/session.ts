import { z } from "zod";
import {
  exerciseUnit,
  movementGroup,
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
 * time through several layers -- the athlete's standing choice, then today's
 * swap -- and every one of those inputs keeps moving afterwards. This is the
 * output of that resolution, written onto the session when it starts, so
 * history can say what was done rather than re-deriving what today's settings
 * would have done.
 *
 * The exercise fields are copied, not referenced, for the same reason: a
 * renamed exercise or a re-ordered group must not rewrite August.
 */
export const sessionMovementSchema = z
  .object({
    /**
     * The WodMovement this row stood in for -- the join back to the template.
     * Null on a straight-sets session (DN-20), where the day was prescribed by
     * a program slot and there is no WOD; `planSlotMovementId` names the row
     * instead. Exactly one of the two, the same xor `AssignmentSubstitution`
     * carries for the same reason.
     */
    wodMovementId: z.string().nullable().default(null),
    /** The PlanSlotMovement this row stood in for, on a prescribed day (DN-20). */
    planSlotMovementId: z.string().nullable().default(null),
    /**
     * How many working sets this movement prescribes, on a straight-sets
     * session. Null on a WOD day, which has rounds rather than sets -- not zero,
     * which would read as a movement nobody was asked to do.
     */
    sets: z.number().int().positive().nullable().default(null),
    /** Seconds of rest between those sets; 0 means straight through. */
    restSeconds: z.number().int().nonnegative().nullable().default(null),
    order: z.number().int().nonnegative(),
    /**
     * Total count, in the exercise's own unit; with a repScheme this is the
     * ladder's sum, and on a range it is the **bottom** of the range.
     *
     * Null only on a straight-sets row prescribed to failure (DN-142). A WOD
     * movement is always the fixed shape: a round of "as many as you can" is a
     * different format, not a rep count, and no WOD carries one.
     */
    reps: z.number().int().positive().nullable(),
    /**
     * The top of a prescribed range, and null everywhere else -- including on
     * every session snapshotted before ranges existed, which is why it
     * defaults rather than being required.
     */
    repsMax: z.number().int().positive().nullable().default(null),
    /** True where the day prescribed no count at all. Defaults for the same reason. */
    toFailure: z.boolean().default(false),
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
      movementGroup: movementGroup.nullable(),
      sortOrder: z.number().int().nonnegative().nullable(),
    }),
  })
  .refine(
    (m) => (m.wodMovementId !== null) !== (m.planSlotMovementId !== null),
    {
      message:
        "a snapshotted movement joins back to a WOD movement or a prescribed one — one of them, not both and not neither",
      path: ["wodMovementId"],
    },
  );
export type SessionMovement = z.infer<typeof sessionMovementSchema>;

export const workoutSessionSchema = z.object({
  id: z.string(),
  assignmentId: z.string(),
  startedAt: z.string().datetime(),
  /**
   * Where this session's clock stops, copied from the WOD's cap when it
   * started. Null on a straight-sets session (DN-20), which is untimed on
   * purpose -- the athlete works at their own pace, and the only clock on
   * that screen is the rest between sets.
   *
   * Null rather than zero. A zero cap is a cap that has already been reached,
   * so `wasCappedFinish` would call every prescribed session capped and the
   * log screen would report a clock that stopped at 0:00.
   */
  capSeconds: z.number().int().positive().nullable(),
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
  // DN-20 -- how far a straight-sets session has got. Both are null on a WOD,
  // and `setsCompleted` is 0 rather than null on a prescribed session that
  // has started but has no set behind it yet: the athlete is on set 1, which
  // is a different fact from a session that is not this kind at all.
  //
  // One counter, resolved to "movement 2, set 3 of 5" against the session's
  // own `movements` by `straightSetsStateAt`. See that function for why the
  // position is derived rather than stored.
  setsCompleted: z.number().int().nonnegative().nullable(),
  /**
   * Elapsed seconds at which the rest after the last set began, or null while
   * the athlete is working. Stored as when it started rather than how much is
   * left so a locked phone resumes the countdown at the right second -- see
   * `restStateAt`.
   */
  restStartedAtSeconds: z.number().int().nonnegative().nullable(),
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

/**
 * Sent on every completed set, so a locked or refreshed screen picks the
 * session back up where it was -- the straight-sets counterpart to
 * `logRoundSplit` and `advanceInterval` (DN-20).
 *
 * `setsCompleted` is the absolute count behind the athlete, not an increment.
 * A tap replayed after a flaky connection then writes the same number rather
 * than counting the set twice.
 */
export const logSetSchema = z.object({
  setsCompleted: z.number().int().nonnegative(),
  /** When the rest after that set began, or null where it needs no rest. */
  restStartedAtSeconds: z.number().int().nonnegative().nullable(),
});
export type LogSet = z.infer<typeof logSetSchema>;

/**
 * One working set, as it was actually done (DN-21).
 *
 * `prescribedReps` is carried beside `actualReps` rather than looked up,
 * because the two answer different questions and the first one moves: the
 * prescription lives on a slot a program can edit, so a set recorded as "2"
 * with nothing beside it would be scored next year against whatever that day
 * says then. Together they say "2 of a prescribed 3", which stays true.
 */
export const workoutSetLogSchema = z.object({
  id: z.string(),
  /** Position in the session's own snapshot, 0-based — see `straightSetsStateAt`. */
  movementOrder: z.number().int().nonnegative(),
  /** 1-based within that movement, the way `straightSetsStateAt` counts. */
  setNumber: z.number().int().positive(),
  exerciseId: z.string(),
  /**
   * What the day asked for, in the same three shapes the prescription carries
   * (DN-142) -- copied whole, because recording a range as its floor would make
   * the log claim the day asked for something it did not.
   *
   * Both extra fields default, so sets written before ranges existed still
   * parse as the fixed shape they were.
   */
  prescribedReps: z.number().int().positive().nullable(),
  prescribedRepsMax: z.number().int().positive().nullable().default(null),
  prescribedToFailure: z.boolean().default(false),
  /**
   * What the athlete actually did. 0 is a real answer: a set attempted and not
   * made is a fact about the session.
   *
   * **Null is a different answer** -- nobody has said yet. It is what a set
   * prescribed to failure records until the athlete supplies the number at log
   * time, because the runner cannot witness a count it never asked for.
   */
  actualReps: z.number().int().nonnegative().nullable(),
});
export type WorkoutSetLog = z.infer<typeof workoutSetLogSchema>;

/**
 * Corrections to sets already recorded, made at log time (DN-21).
 *
 * Updates only — every row named here must already exist. The runner is what
 * creates them, and a correction that could conjure a set would let the log
 * screen claim work that no session ever recorded.
 */
export const editSetLogsSchema = z.object({
  sets: z
    .array(
      z.object({
        movementOrder: z.number().int().nonnegative(),
        setNumber: z.number().int().positive(),
        actualReps: z.number().int().nonnegative(),
      }),
    )
    .min(1),
});
export type EditSetLogs = z.infer<typeof editSetLogsSchema>;
