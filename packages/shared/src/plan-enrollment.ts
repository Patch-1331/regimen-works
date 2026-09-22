import { z } from "zod";
import { enrollmentStatus, movementGroup } from "./enums.js";
import { planSchema } from "./plan.js";

/**
 * Every group's rung on a date, as `{ line: rung }`.
 *
 * `partialRecord` rather than `record`: in Zod 4 a record keyed by an enum is
 * **exhaustive**, so `z.record(movementGroup, …)` would demand a rung for
 * every group in the app. An athlete has rungs only on the groups they have
 * actually trained — a new athlete has none at all (DN-86) — so the exhaustive
 * shape would reject exactly the athletes this snapshot exists to describe.
 */
export const rungSnapshotSchema = z.partialRecord(
  movementGroup,
  z.number().int().nonnegative(),
);
export type RungSnapshot = z.infer<typeof rungSnapshotSchema>;

/**
 * One group's movement over a completed program, for the completion card's
 * "pull: negative → chin-up".
 *
 * Carries names as well as rungs because a rung is meaningless to the athlete
 * on its own, and the exercise that was at rung 3 when the program started
 * can be a different one by the time it finishes — the group grows. A card
 * that renders today's group against a stored number would quietly rewrite
 * the athlete's own history.
 */
export const rungChangeSchema = z.object({
  movementGroup: movementGroup,
  fromRung: z.number().int().nonnegative(),
  toRung: z.number().int().nonnegative(),
  fromName: z.string(),
  toName: z.string(),
});
export type RungChange = z.infer<typeof rungChangeSchema>;

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
  rungChanges: z.array(rungChangeSchema),
});
export type EnrollmentSummary = z.infer<typeof enrollmentSummarySchema>;

/**
 * The athlete's run at a program (DN-9). At most one is `active`, held by a
 * partial unique index rather than by a check in application code, so two
 * tabs racing on "Start program" cannot both succeed.
 */
export const planEnrollmentSchema = z.object({
  id: z.string(),
  plan: planSchema,
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
  /** How many weeks this run lasts, chosen within the plan's bounds. Null for an open-ended program, which never completes. */
  weeks: z.number().int().positive().nullable(),
  status: enrollmentStatus,
  completedAt: z.string().datetime().nullable(),
  /**
   * Where every group stood on the start date. `SkillLevel` keeps only
   * the current value, so without this a finished program can count sessions
   * but cannot say what changed — the interesting half of the completion card.
   */
  startingRungs: rungSnapshotSchema,
  /** Null while the program is still running, which is also how "has this been completed" reads without a join. */
  summary: enrollmentSummarySchema.nullable(),
});
export type PlanEnrollment = z.infer<typeof planEnrollmentSchema>;

/**
 * What starting a program asks for.
 *
 * `planId` and a start date, and nothing else that can be derived: the
 * starting rungs are read from the athlete's own `SkillLevel` rows at the
 * moment of enrolling, and a client that could send them could misreport what
 * the program is measured against.
 *
 * The bounds on `startDate` — no earlier than today, no later than a few
 * weeks out — are not expressible here, because "today" is not a constant.
 * They belong to the service that has a clock (DN-13).
 */
export const createEnrollmentSchema = z.object({
  planId: z.string().min(1),
  startDate: z.string().date(),
  /**
   * Null enrolls for the plan's own length, which for an open-ended program
   * is no length at all. A number must fall within the plan's min/max, which
   * is checked where the plan is loaded rather than here.
   */
  weeks: z.number().int().positive().nullable().default(null),
});
export type CreateEnrollment = z.infer<typeof createEnrollmentSchema>;

/**
 * A program the athlete finished, as the completion card and the Completed
 * list both render it (DN-18).
 *
 * The plan's name is carried rather than the plan, for the same reason
 * `todayPlanSchema` carries a heading rather than a program definition: both
 * screens want a line of text, and a program that was edited or archived since
 * should still name what the athlete actually ran.
 *
 * The figures come from `summary`, which is non-null by construction here --
 * an enrollment with no summary is one that was retired before this issue
 * existed, and there is nothing to show for it.
 */
export const completedProgramSchema = z.object({
  enrollmentId: z.string(),
  planId: z.string(),
  planName: z.string(),
  completedAt: z.string().datetime(),
  summary: enrollmentSummarySchema,
});
export type CompletedProgram = z.infer<typeof completedProgramSchema>;
