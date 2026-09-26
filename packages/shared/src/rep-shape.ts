import { z } from "zod";
import type { ExerciseUnit } from "./enums.js";

/**
 * The prescribed count, in the three shapes a source actually writes (DN-142).
 *
 * A single `reps: number` assumed one author: the seed, written in TypeScript
 * with a compiler watching, which always knows the number because it invented
 * it. Measured against a routine written outside this app, 12 of 25
 * prescriptions are ranges and 1 is "until failure" -- so the column was not
 * expressive enough to write most of a real routine down, and storing a range
 * as its floor is a silent edit of what the source said. ADR 0005 has the
 * argument in full.
 *
 * Three shapes, and no fourth:
 *
 * | shape | `reps` | `repsMax` | `toFailure` |
 * | --- | --- | --- | --- |
 * | fixed | set | null | false |
 * | range | set | set, `> reps` | false |
 * | failure | null | null | true |
 *
 * Held by a CHECK in `20260929000000_prescribed_rep_shapes`, because Prisma
 * cannot say it in the schema, and mirrored by `refineRepShape` below so a
 * malformed shape is refused at the edge rather than by the database.
 *
 * **Not a discriminated union**, tempting as one is. These are three columns on
 * a row that already exists, and a union would have to be flattened on the way
 * into the database and rebuilt on the way out -- two conversions, two places
 * to disagree, on a shape whose whole job is to be stored.
 */
export const repShapeFields = {
  /**
   * The count, or the **bottom** of a range. Null only on a set prescribed to
   * failure, which names no number at all.
   *
   * Counted in whatever unit the exercise uses: `exercise.unit` is what makes a
   * hold's "reps" seconds, which is why a 60-second plank needs nothing here.
   */
  reps: z.number().int().positive().nullable(),
  /** The top of a range, strictly above `reps`. Null on the other two shapes. */
  repsMax: z.number().int().positive().nullable(),
  /** No prescribed count: work the set until it cannot continue. */
  toFailure: z.boolean(),
};

/** The three fields as a plain object, for callers that hold them loose. */
export type RepShape = {
  reps: number | null;
  repsMax: number | null;
  toFailure: boolean;
};

/**
 * Which of the three shapes this is, resolved once so no caller has to work it
 * out from a combination of nulls.
 */
export function repShapeKind(shape: RepShape): "fixed" | "range" | "failure" {
  if (shape.toFailure) return "failure";
  return shape.repsMax === null ? "fixed" : "range";
}

/**
 * The CHECK, in Zod. Applied with `.superRefine` so an object schema keeps its
 * other fields' errors rather than collapsing to one message.
 *
 * A range is `repsMax > reps` and never `>=`: 8-8 is a fixed prescription
 * written the long way, and admitting both spellings would mean two rows that
 * say the same thing.
 */
export function refineRepShape(shape: RepShape, ctx: z.RefinementCtx): void {
  if (shape.toFailure) {
    if (shape.reps !== null || shape.repsMax !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["toFailure"],
        message:
          "a set prescribed to failure names no count — leave reps and repsMax null",
      });
    }
    return;
  }
  if (shape.reps === null) {
    ctx.addIssue({
      code: "custom",
      path: ["reps"],
      message:
        "a prescribed count is a number, a range, or to failure — this is none of them",
    });
    return;
  }
  if (shape.repsMax !== null && shape.repsMax <= shape.reps) {
    ctx.addIssue({
      code: "custom",
      path: ["repsMax"],
      message: "the top of a range is above its bottom",
    });
  }
}

/**
 * How a prescribed count reads to the athlete.
 *
 * Lives here rather than in either screen because two of them render it -- the
 * runner's current-movement plate and the log screen's "of N" -- and a
 * prescription that reads "8-10" on one and "8" on the other would be the
 * silent approximation this whole change exists to remove.
 *
 * `unit` is the exercise's own: a hold counts in seconds, so its fixed shape
 * reads "60s" and its range reads "45-60s".
 */
export function repsLabel(shape: RepShape, unit: ExerciseUnit): string {
  const suffix = unit === "seconds" ? "s" : "";
  switch (repShapeKind(shape)) {
    case "failure":
      // Spelled out rather than abbreviated to "AMRAP" or "max": this is the
      // instruction the source gave, and the runner is where an athlete reads
      // it mid-session.
      return "to failure";
    case "range":
      return `${shape.reps}-${shape.repsMax}${suffix}`;
    case "fixed":
      return `${shape.reps}${suffix}`;
  }
}
