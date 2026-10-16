import { z } from "zod";
import { enrollmentStatus, movementGroup } from "./enums.js";
import { programSchema } from "./program.js";
import { restSecondsSchema } from "./rest.js";

/**
 * What the athlete had chosen in each group on a date, as
 * `{ movementGroup: exerciseId }`.
 *
 * `partialRecord` rather than `record`: in Zod 4 a record keyed by an enum is
 * **exhaustive**, so `z.record(movementGroup, …)` would demand an entry for
 * every group in the app. An athlete has chosen in only the groups they have
 * actually trained — a new athlete has none at all (DN-86) — so the exhaustive
 * shape would reject exactly the athletes this snapshot exists to describe.
 *
 * An absent group means they had chosen nothing, and that is the honest shape:
 * it is *not* the same as having been handed the group's default, which is
 * resolved per prescription and never stored (ADR-0004 decision 8).
 */
export const movementSnapshotSchema = z.partialRecord(
  movementGroup,
  z.string(),
);
export type MovementSnapshot = z.infer<typeof movementSnapshotSchema>;

/**
 * One group's movement over a completed program, for the completion card's
 * "pull: negative → chin-up".
 *
 * Carries the names as well as the ids because an id is meaningless to the
 * athlete, and because a movement can be renamed or retired between the start
 * of a program and its end. The names are resolved once, at completion, and
 * frozen into the summary — a card that re-read them later would quietly
 * rewrite the athlete's own history.
 */
export const movementChangeSchema = z.object({
  movementGroup: movementGroup,
  /** Null where the athlete had chosen nothing in this group when the run began. */
  fromExerciseId: z.string().nullable(),
  fromName: z.string().nullable(),
  toExerciseId: z.string(),
  toName: z.string(),
});
export type MovementChange = z.infer<typeof movementChangeSchema>;

/**
 * The completion card's figures, snapshotted when the enrollment completes
 * rather than recomputed on every read of the Completed list.
 *
 * Snapshotted because the inputs move: exercises get added to a group,
 * assignments can be deleted with a user, and a record of what an athlete
 * finished should not change afterwards because the library did.
 *
 * The shape follows docs/design/programs.md's card directly. The card itself
 * is not built yet, so treat this as the contract the completion work is
 * written against rather than as a shape already in use.
 */
export const enrollmentSummarySchema = z.object({
  /** Null for a program that had no length to run — an open-ended run that was ended by hand. */
  weeks: z.number().int().positive().nullable(),
  sessions: z.number().int().nonnegative(),
  /** Empty when nothing moved, which is a real outcome and not a missing figure. */
  movementChanges: z.array(movementChangeSchema),
});
export type EnrollmentSummary = z.infer<typeof enrollmentSummarySchema>;

/**
 * The athlete's run at a program (DN-9). At most one is `active`, held by a
 * partial unique index rather than by a check in application code, so two
 * tabs racing on "Start program" cannot both succeed.
 */
export const programEnrollmentSchema = z.object({
  id: z.string(),
  program: programSchema,
  /**
   * ISO date, as text — the same representation `DailyAssignment.date` uses,
   * so the two compare directly and `date < startDate` is the whole
   * before-the-program rule (DN-11, DN-16).
   *
   * May be in the future. Enrolling on Thursday to start Monday is supported
   * outright, and the days in between fall back to Just WODs, which is why a
   * future start needs no second enrollment and no status-flipping job.
   */
  startDate: z.string().date(),
  /** How many weeks this run lasts, chosen within the program's bounds. Null for an open-ended program, which never completes. */
  weeks: z.number().int().positive().nullable(),
  status: enrollmentStatus,
  completedAt: z.string().datetime().nullable(),
  /** When the athlete left the run for another program. Null unless `ended`. */
  endedAt: z.string().datetime().nullable(),
  /**
   * Where every group stood on the start date. `SkillLevel` keeps only
   * the current value, so without this a finished program can count sessions
   * but cannot say what changed — the interesting half of the completion card.
   */
  startingMovements: movementSnapshotSchema,
  /**
   * The athlete's rest pace for this run, set when they committed to the
   * program and editable while it runs (ADR 0005). Overrides every
   * per-movement rest; null leaves the program's own in charge. See
   * `resolveRestSeconds`.
   */
  defaultRestSeconds: restSecondsSchema,
  /** Null while the program is still running, which is also how "has this been completed" reads without a join. */
  summary: enrollmentSummarySchema.nullable(),
});
export type ProgramEnrollment = z.infer<typeof programEnrollmentSchema>;

/**
 * What starting a program asks for.
 *
 * `programId` and a start date, and nothing else that can be derived: the
 * starting movements are read from the athlete's own `SkillLevel` rows at the
 * moment of enrolling, and a client that could send them could misreport what
 * the program is measured against.
 *
 * The bounds on `startDate` — no earlier than today, no later than a few
 * weeks out — are not expressible here, because "today" is not a constant.
 * They belong to the service that has a clock (DN-13).
 */
export const createEnrollmentSchema = z.object({
  programId: z.string().min(1),
  startDate: z.string().date(),
  /**
   * Null enrolls for the program's own length, which for an open-ended program
   * is no length at all. A number must fall within the program's min/max, which
   * is checked where the program is loaded rather than here.
   */
  weeks: z.number().int().positive().nullable().default(null),
});
export type CreateEnrollment = z.infer<typeof createEnrollmentSchema>;

/**
 * A program the athlete finished, as the completion card and the Completed
 * list both render it (DN-18).
 *
 * The program's name is carried rather than the program, for the same reason
 * `todayProgramSchema` carries a heading rather than a program definition: both
 * screens want a line of text, and a program that was edited or archived since
 * should still name what the athlete actually ran.
 *
 * The figures come from `summary`, which is non-null by construction here --
 * an enrollment with no summary is one that was retired before this issue
 * existed, and there is nothing to show for it.
 */
export const completedProgramSchema = z.object({
  enrollmentId: z.string(),
  programId: z.string(),
  programName: z.string(),
  completedAt: z.string().datetime(),
  // False once the program has been archived: the API refuses to run it again
  // (DN-144), so the card does not offer to (DN-153). A flag rather than the
  // archive timestamp, which stays server-side.
  canRunAgain: z.boolean(),
  summary: enrollmentSummarySchema,
});
export type CompletedProgram = z.infer<typeof completedProgramSchema>;

/**
 * One run as the Programs tab lists it (DN-179): the current run at the top,
 * and every finished or ended one under "Past runs".
 *
 * Carries the program's name and summary rather than the program, the way
 * `completedProgramSchema` does, so a program edited or archived since still
 * reads as what the athlete ran.
 */
export const programRunSchema = z.object({
  enrollmentId: z.string(),
  programId: z.string(),
  programName: z.string(),
  programSummary: z.string(),
  status: enrollmentStatus,
  startDate: z.string().date(),
  /** How many weeks the run was chosen to last. Null for an open-ended program. */
  totalWeeks: z.number().int().positive().nullable(),
  /**
   * The week the run is in, or reached before it finished or ended --
   * 1-based, counted by calendar week the way Today's `week` is. Null only
   * for a current run whose start date has not arrived yet.
   */
  week: z.number().int().positive().nullable(),
  /** When a past run finished or ended. Null for the current run. */
  finishedAt: z.string().datetime().nullable(),
});
export type ProgramRun = z.infer<typeof programRunSchema>;

/**
 * `GET /programs/runs`. `current` is null only for an athlete between runs --
 * one who finished a program and has started nothing since. `past` is newest
 * first and never holds a Just WODs run: it is the "no program" choice, and a
 * list of the stretches somebody trained without one would be noise.
 */
export const programRunsSchema = z.object({
  current: programRunSchema.nullable(),
  past: z.array(programRunSchema),
});
export type ProgramRuns = z.infer<typeof programRunsSchema>;
