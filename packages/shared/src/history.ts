import { z } from "zod";
import { exerciseUnit, movementGroup, substitutionReason } from "./enums.js";

/**
 * Per-movement history (DN-89): what the athlete has actually trained, movement
 * by movement, drawn from the session snapshots rather than from a stored
 * choice.
 *
 * Read as a narrative rather than a score. "Chin-ups for the last six weeks,
 * negatives before that" is a fact about their training; "you are at rung 3"
 * was the app's guess at it, and the app no longer holds opinions about what
 * an athlete is capable of.
 */

/** One day this movement was trained. */
export const movementHistoryDaySchema = z.object({
  /** The assignment's date, not the session's timestamp — history is by training day. */
  date: z.string(),
  /** The WOD's name, or what the day was — `"Strength"` on a prescribed one (DN-126). */
  name: z.string(),
  /**
   * Count in the movement's own unit, as prescribed that day — in all three of
   * its shapes (DN-142). Carried whole rather than flattened, so a day that
   * asked for 8-10 does not read back as a day that asked for 8.
   *
   * `repsMax` and `toFailure` default, because every day trained before ranges
   * existed was the fixed shape.
   */
  reps: z.number().int().positive().nullable(),
  repsMax: z.number().int().positive().nullable().default(null),
  toFailure: z.boolean().default(false),
  /** True where the athlete swapped into this movement themselves that day. */
  isSwapped: z.boolean(),
  /**
   * What the library had prescribed, where an automatic layer replaced it —
   * their remembered choice (DN-88) or their equipment (DN-79). Null when
   * nothing replaced it, on a row they swapped themselves, and on sessions
   * snapshotted before the field existed.
   */
  prescribedName: z.string().nullable(),
  prescribedReason: substitutionReason.nullable(),
});
export type MovementHistoryDay = z.infer<typeof movementHistoryDaySchema>;

/** Every day one movement was trained, newest first. */
export const movementHistorySchema = z.object({
  exerciseId: z.string(),
  /** The name as it stood when it was trained — a rename must not rewrite history. */
  name: z.string(),
  movementGroup: movementGroup.nullable(),
  unit: exerciseUnit,
  /** How many sessions it appeared in — `days.length`, carried so a caller need not count. */
  sessions: z.number().int().positive(),
  /**
   * Everything prescribed across those days, in `unit` — **the floor of what
   * was prescribed**, never an estimate of what was done. A range contributes
   * its bottom and a day worked to failure contributes nothing, because
   * neither names a number that can be added without inventing one (DN-142).
   *
   * Deliberately not normalised across movements: seconds of plank and reps of
   * pull-up are not the same quantity, and adding them would invent one.
   */
  total: z.number().int().nonnegative(),
  firstTrained: z.string(),
  lastTrained: z.string(),
  days: z.array(movementHistoryDaySchema),
});
export type MovementHistory = z.infer<typeof movementHistorySchema>;

/**
 * One session a movement was trained in, as it was actually done (DN-22).
 *
 * `sets` is the reps of each set in order, from `WorkoutSetLog` -- what
 * happened, not what was asked for. The array rather than its sum, because
 * `5, 5, 3` and `4, 4, 4` are different sessions with the same total, and the
 * difference between them is the whole reason per-set rows exist.
 */
export const movementSessionSchema = z.object({
  /** The training day, from the assignment -- not the tap's timestamp. */
  date: z.string(),
  /** Carried so a caller can tell today's session from the ones before it. */
  assignmentId: z.string(),
  sets: z.array(z.number().int().nonnegative()).min(1),
});
export type MovementSession = z.infer<typeof movementSessionSchema>;

/**
 * What one movement has actually been trained at, session by session (DN-22).
 *
 * The counterpart to `movementHistorySchema`, and deliberately a second shape
 * rather than a field on it: that one reads the session *snapshots*, so it
 * describes what the program asked for on each day. This one reads the set
 * rows, so it describes what came out. A screen asking "am I doing more than
 * I was" needs the second, and a screen asking "what have I been prescribed"
 * needs the first.
 *
 * Volumes are in `unit` and are never summed across movements: seconds of
 * plank and reps of pull-up are not the same quantity, and adding them would
 * invent one.
 */
export const movementVolumeSchema = z.object({
  exerciseId: z.string(),
  /** The name as it stood when it was trained -- a rename must not rewrite history. */
  name: z.string(),
  unit: exerciseUnit,
  /** Newest first, the order the athlete reads them in. */
  sessions: z.array(movementSessionSchema).min(1),
});
export type MovementVolume = z.infer<typeof movementVolumeSchema>;
