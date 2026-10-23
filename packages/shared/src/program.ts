import { z } from "zod";
import { refineRepShape, repShapeFields } from "./rep-shape.js";
import {
  movementPattern,
  programPhase,
  programSlotKind,
  movementGroup,
  scheduleMode,
  wodType,
} from "./enums.js";
import { restSecondsSchema } from "./rest.js";
import { SATURDAY, SUNDAY } from "./schedule.js";

/**
 * The id of the Just WODs program (DN-13), which every athlete is enrolled in
 * unless they have chosen something else.
 *
 * Shared rather than private to the API because both sides need to recognise
 * it, and for the same reason: Just WODs is the absence of programming, so a
 * screen that names it is telling the athlete about a program they did not
 * choose. Today's program strip and its rest-day copy both key off this.
 */
export const DEFAULT_PROGRAM_ID = "plan_just_wods";

/**
 * One set of a program line (ADR 0011): its count, and the rest after it.
 *
 * A line is an ordered list of these. A uniform 3 × 8 is three identical sets,
 * stored the same way a reverse pyramid is -- there is no second format for
 * "same for every set", which would be two ways to write one fact.
 *
 * Mirrors a `ProgramSlotSet` row and its two CHECKs in
 * `20261023000000_program_slot_sets`. Strict, like the line it sits in.
 */
export const programSetSchema = z
  .strictObject({
    /**
     * The prescribed count, in one of three shapes — see `repShapeFields`,
     * which documents all three and is the only place they are defined.
     */
    ...repShapeFields,
    /**
     * The rest after this set. 0 is a prescription — "straight through" —
     * rather than an omission, and null is the omission: the source said
     * nothing about rest (ADR 0005). The two are different facts, and the
     * athlete's pace at enrollment is what fills the second — see
     * `resolveRestSeconds`.
     */
    restSeconds: restSecondsSchema,
  })
  .superRefine(refineRepShape);
export type ProgramSet = z.infer<typeof programSetSchema>;

/**
 * `count` identical sets: how a line written as "N × one shape" is stored.
 *
 * The editor and paste-import both write a line this way until DN-186 lets a
 * set differ from the one before it.
 */
export function uniformSets(count: number, set: ProgramSet): ProgramSet[] {
  return Array.from({ length: count }, () => ({ ...set }));
}

/**
 * A line's sets back as "N × one shape", or null where they differ.
 *
 * Every line is uniform until DN-186: the migration that moved sets onto rows
 * of their own wrote N identical ones, and nothing writes any other kind. The
 * readers that still think in "N × one shape" -- the day an athlete is handed,
 * the session snapshot, the editor -- go through this, so the one place that
 * would have to learn about a line that varies is easy to find.
 */
export function asUniform(
  sets: readonly ProgramSet[],
): { count: number; set: ProgramSet } | null {
  const [first] = sets;
  if (first === undefined) return null;
  const same = sets.every(
    (s) =>
      s.reps === first.reps &&
      s.repsMax === first.repsMax &&
      s.toFailure === first.toFailure &&
      s.restSeconds === first.restSeconds,
  );
  return same ? { count: sets.length, set: { ...first } } : null;
}

/** A line has at least one set: one with none prescribes nothing. */
const setsSchema = z
  .array(programSetSchema)
  .min(1, "a line has at least one set");

/**
 * One movement a `movements` day prescribes, as authored (DN-19).
 *
 * The authoring shape. What the athlete is handed is
 * `prescribedMovementSchema`, where the group has already resolved to the
 * movement this athlete performs — an author writes "pull", an athlete reads
 * "chin-up", and keeping the two shapes apart is what stops a client
 * resolving the choice for itself.
 *
 * Its sets sit here directly, one entry per set (ADR 0011): no multiplier, no
 * progression rule. An author wanting escalation writes a core block that
 * already waves (3x5 / 4x5 / 5x5), which `expandProgramWeeks` repeats as a
 * wave. A multiplier would put the same fact in two places and let them
 * disagree.
 */
export const programSlotMovementSchema = z
  .object({
    id: z.string(),
    /** Position in the session, 0-based, the way `WodMovement.order` is. */
    order: z.number().int().nonnegative(),
    /**
     * The movement groups to resolve through the athlete's choice — the one to
     * reach for, because it is what lets one program fit every athlete.
     */
    movementGroup: movementGroup.nullable(),
    /**
     * A specific exercise instead, for the cases where the variation is the
     * point: a program teaching the negative names the negative, and an
     * athlete further up the group should still train it that day.
     */
    exerciseId: z.string().nullable(),
    /** In order — see `programSetSchema`. */
    sets: setsSchema,
  })
  // Mirrors the ProgramSlotMovement_line_xor_exercise CHECK. Neither set is a
  // rep count attached to nothing; both set is two different instructions in
  // one row, and a reader picking one would be guessing at the author.
  .refine((m) => (m.movementGroup !== null) !== (m.exerciseId !== null), {
    message:
      "a prescribed movement names a movementGroup or an exercise — one of them, not both and not neither",
    path: ["movementGroup"],
  });
export type ProgramSlotMovement = z.infer<typeof programSlotMovementSchema>;

/**
 * One authored day (DN-9).
 *
 * `dayOfWeek` is a **calendar** weekday, not an offset from the enrollment's
 * start date. The two cannot coexist: a Mon/Tue/Thu/Fri program means nothing
 * if week 1 begins on a Wednesday, so program weeks align to calendar weeks
 * and `resolveSlotForDate` (DN-11) looks the day up by its weekday.
 *
 * The `wod_generated` constraints are nullable columns rather than a nested
 * object, mirroring the table: a null skips its axis, and the picker relaxes
 * them in a stated order rather than ever failing to produce a workout.
 */
export const programSlotSchema = z
  .object({
    id: z.string(),
    // 0 = Sunday … 6 = Saturday, the one numbering the app uses — see
    // `schedule.ts`, which states it for the whole app.
    dayOfWeek: z.number().int().min(SUNDAY).max(SATURDAY),
    kind: programSlotKind,
    /**
     * Which days survive when a flexible program runs at fewer days per week
     * than it was authored for: lower is kept first, so the program's main
     * session is 0. Never read for a fixed program, where every authored day
     * is trained.
     */
    priority: z.number().int().nonnegative(),
    /** The pinned WOD — see the refinement below. */
    wodId: z.string().nullable(),
    // What a generated day is allowed to be. `allowNamed` is false on most
    // slots because programs mostly program movement rather than benchmarks,
    // and a named WOD landing mid-progression is the surprise that default
    // protects against.
    pattern: movementPattern.nullable(),
    wodType: wodType.nullable(),
    allowNamed: z.boolean(),
    maxTimeCapMinutes: z.number().int().positive().nullable(),
    /**
     * The prescription, on a `movements` slot and empty on every other kind
     * — see the second refinement.
     *
     * Defaulted rather than required so a payload written before DN-19 still
     * parses as the WOD day it describes, which is every slot authored so
     * far.
     */
    movements: z.array(programSlotMovementSchema).default([]),
  })
  // Mirrors the ProgramSlot_pinned_wod_present CHECK, and mirrors it as the
  // biconditional the constraint actually is rather than as the weaker "a
  // pinned slot has a wodId". A rest day pointing at a WOD is refused for the
  // same reason a pinned day with nothing pinned is: both are rows whose
  // `kind` and `wodId` tell different stories, and whichever one a reader
  // believes, the other is a bug waiting to surface.
  .refine(
    (slot) =>
      (slot.kind === programSlotKind.enum.wod_pinned) === (slot.wodId !== null),
    {
      message:
        "a wod_pinned slot needs a wodId, and no other kind may carry one",
      path: ["wodId"],
    },
  )
  // The rule no CHECK can hold, because `kind` and the prescription rows live
  // in different tables (DN-19). Stated as the same biconditional for the same
  // reason as the one above: a rest day carrying sets and reps and a
  // `movements` day carrying none are both slots whose two halves describe
  // different days.
  //
  // The API is the other half of this. It resolves a `movements` slot with
  // nothing prescribed back to a generated WOD rather than handing the
  // athlete an empty screen — refusing to author the row here, and refusing
  // to crash on one that got in anyway.
  .refine(
    (slot) =>
      (slot.kind === programSlotKind.enum.movements) === slot.movements.length > 0,
    {
      message:
        "a movements slot needs at least one prescribed movement, and no other kind may carry any",
      path: ["movements"],
    },
  );
export type ProgramSlot = z.infer<typeof programSlotSchema>;

/**
 * One authored week.
 *
 * `order` is its position as authored, 0-indexed — **not** the week the
 * athlete is in. That is a count from their start date, and one authored core
 * week is played several times over a run.
 */
export const programWeekSchema = z.object({
  id: z.string(),
  order: z.number().int().nonnegative(),
  phase: programPhase,
  /** Shown on the calendar preview, e.g. "Deload". Null where the week has nothing to say beyond its number. */
  label: z.string().nullable(),
  slots: z.array(programSlotSchema),
});
export type ProgramWeek = z.infer<typeof programWeekSchema>;

/**
 * The program definition, without its weeks — what a picker row and the
 * Settings readout need.
 *
 * Kept separate from `programDetailSchema` because the two have genuinely
 * different costs: a picker listing eight programs does not want eight weeks
 * of seven slots each, and an endpoint handed a shape it cannot afford to
 * fill honestly is an endpoint that will return `weeks: []` and call it true.
 */
const programFields = z.object({
  id: z.string(),
  name: z.string(),
  /**
   * One line under the name in the picker. Required rather than nullable: a
   * program nobody can tell apart from the next one is not a program anyone
   * will choose.
   */
  summary: z.string(),
  /**
   * What finishing it is supposed to get you, where that is a single nameable
   * thing ("your first unassisted chin-up"). Null for programs that are a way
   * of training rather than a target — Just WODs is exactly that.
   */
  goal: z.string().nullable(),
  /**
   * Why the week is laid out the way it is, in the author's own words — "Two
   * heavy pull days, 48 hours apart." (DN-124).
   *
   * This is what lets a fixed program's locked week read as design rather
   * than as a restriction: an athlete told "the spacing is part of the
   * programming" has been given a rule, and one told why the gap is there has
   * been given a reason. Null where the program has nothing particular to
   * say, which is most of them.
   */
  scheduleNote: z.string().nullable(),
  scheduleMode,
  minDaysPerWeek: z.number().int().min(1).max(7).nullable(),
  maxDaysPerWeek: z.number().int().min(1).max(7).nullable(),
  /**
   * Which weekdays a flexible program's picker starts on. Empty for fixed,
   * where the slots already answer it — and empty is also the honest value
   * for a flexible program with no opinion about which days, which is why
   * this is not `trainingDaysSchema`: that one requires at least one day,
   * because an athlete who trains on no days has no app. A *default* with no
   * days is a program declining to suggest, which is different.
   */
  defaultDays: z.array(z.number().int().min(SUNDAY).max(SATURDAY)),
  /**
   * How many weeks the athlete may run it for, and where the picker starts.
   * All three are null for an open-ended program: Just WODs never finishes,
   * so there is no length to choose and no last day to complete on.
   *
   * `minWeeks` has to clear `minimumViableWeeks` (DN-11) or the program can
   * end mid-wave on a light week. That is a count of authored weeks, so it is
   * checked where the weeks are visible rather than here.
   */
  minWeeks: z.number().int().positive().nullable(),
  maxWeeks: z.number().int().positive().nullable(),
  defaultWeeks: z.number().int().positive().nullable(),
  /**
   * Whether it may also run with no end, as well as for a length inside the
   * bounds above (DN-154). True for every authored program, whose one
   * repeating week has nothing to finish. False for a curated bounded
   * program, and for Just WODs, where open-ended is the only length there is.
   */
  allowsNoEnd: z.boolean(),
});

/** The half of the schedule-mode CHECK that a shape with these three fields can answer. */
type ScheduleModeBounds = {
  scheduleMode: z.infer<typeof scheduleMode>;
  minDaysPerWeek: number | null;
  maxDaysPerWeek: number | null;
};

/**
 * Mirrors the Program_schedule_mode_bounds CHECK: fixed carries neither day
 * bound, flexible carries both.
 *
 * Written as a named predicate rather than inline because both program shapes
 * apply it, and a rule restated in two places is a rule that will eventually
 * be two different rules.
 */
function scheduleModeBoundsHold(program: ScheduleModeBounds): boolean {
  const bounded = program.minDaysPerWeek !== null && program.maxDaysPerWeek !== null;
  return program.scheduleMode === scheduleMode.enum.flexible
    ? bounded
    : program.minDaysPerWeek === null && program.maxDaysPerWeek === null;
}

const scheduleModeBoundsError = {
  message:
    "a flexible program needs both minDaysPerWeek and maxDaysPerWeek; a fixed program carries neither, because its slots are the schedule",
  path: ["scheduleMode"],
};

export const programSchema = programFields.refine(
  scheduleModeBoundsHold,
  scheduleModeBoundsError,
);
export type Program = z.infer<typeof programSchema>;

/** The program with everything it authors — the calendar preview's shape. */
export const programDetailSchema = programFields
  .extend({ weeks: z.array(programWeekSchema) })
  .refine(scheduleModeBoundsHold, scheduleModeBoundsError);
export type ProgramDetail = z.infer<typeof programDetailSchema>;


/**
 * What a program *is* on the way in (DN-145, ADR 0006).
 *
 * One definition for every path that writes one: the editor posts it, and the
 * export file is this same shape (decision 8), so admin create, copy and the
 * import command all hand the service the body the editor does. That is why
 * it is its own shape rather than `programDetailSchema` minus the ids -- a stored
 * program says things an author never does (weeks, phases, priority, length),
 * and a file written against the stored shape would have to say them too.
 *
 * Strict at every level. An unknown key is refused rather than dropped,
 * because a file read back later that silently loses a field it carried is
 * a program that has been edited by nobody.
 *
 * An authored program is one repeating week (DN-145), and its length is
 * chosen at enrolment, so neither appears here.
 */

/**
 * A line as it was written before its sets were a list (DN-190): `sets` a
 * count beside one rep shape and one rest. Read as that many identical sets,
 * so an export file written before then still loads -- the same courtesy
 * `fromLegacyExport` gives the envelope -- and so does a body from an editor
 * page loaded before the deploy.
 *
 * Only a line whose `sets` is a number is touched; anything else is left for
 * the line itself to accept or refuse.
 */
function fromCountedLine(line: unknown): unknown {
  if (typeof line !== "object" || line === null) return line;
  const { sets, reps, repsMax, toFailure, restSeconds, ...rest } =
    line as Record<string, unknown>;
  if (typeof sets !== "number") return line;
  // A count that is not a positive whole number becomes no sets at all, which
  // the line refuses, rather than being rounded into one it never said.
  const count = Number.isInteger(sets) && sets >= 1 ? sets : 0;
  const set = { reps, repsMax, toFailure, restSeconds };
  return { ...rest, sets: Array.from({ length: count }, () => ({ ...set })) };
}

/**
 * One line of a day: a movement, and how much of it.
 *
 * The strictness ADR 0005 took out of the columns lives here -- a row the
 * database would store is not necessarily a row an author finished writing.
 */
const programLineFields = z
  .strictObject({
    /** "Any pull, chosen by my equipment" -- resolved per athlete, per day. */
    movementGroup: movementGroup.nullable(),
    /** A specific exercise, where the variation is the point. */
    exerciseId: z.string().min(1).nullable(),
    /**
     * In order — see `programSetSchema`. A null rest on a set is "the program
     * does not say", which the pace at enrolment fills.
     */
    sets: setsSchema,
    /**
     * Named only to be refused with a reason. Sources write loads ("3x5 @
     * 80%", "135 lb") and the app does not prescribe them -- the athlete's
     * load is their own, logged rather than dictated. A file carrying one is
     * told the editor dropped it rather than told it has an unknown key,
     * which would read as a bug in the file instead of a decision in the app.
     */
    load: z
      .never({
        error:
          "the editor does not store a load — prescribe sets and reps, and the athlete logs what they lift",
      })
      .optional(),
  })
  // Every row names a group or an exercise, one of them. Neither is sets and
  // reps of nothing; both is two instructions in one row.
  .refine(
    (line) => (line.movementGroup !== null) !== (line.exerciseId !== null),
    {
      message: "each line names a movement group or an exercise — one of them",
      path: ["movementGroup"],
    },
  );

export const programLineSchema = z.preprocess(fromCountedLine, programLineFields);
export type ProgramLine = z.infer<typeof programLineSchema>;

/**
 * One day the program trains. A rest day is the absence of one: there is no
 * rest entry to write, and a day with no lines is refused rather than stored
 * as an empty session.
 */
export const programDaySchema = z.strictObject({
  // 0 = Sunday … 6 = Saturday, as everywhere in the app.
  dayOfWeek: z.number().int().min(SUNDAY).max(SATURDAY),
  /**
   * The day's own name, e.g. "Chest and Triceps" (DN-155). Optional as well
   * as nullable: this body is the export format (ADR 0006, decision 8), and
   * a file written before days had names must still load. A blank reads as
   * no name. Wording, not structure -- renaming a day never forks a program.
   */
  label: z
    .string()
    .trim()
    .max(40)
    .transform((s) => (s === "" ? null : s))
    .nullish(),
  lines: z
    .array(programLineSchema)
    .min(1, "a training day needs at least one line"),
});
export type ProgramDay = z.infer<typeof programDaySchema>;

export const createProgramSchema = z
  .strictObject({
    name: z.string().trim().min(1, "name the program").max(80),
    /**
     * The line under the name in the picker. Null lets the service write one
     * from the schedule -- a personal program needs no pitch, but the picker
     * still needs a line.
     */
    summary: z
      .string()
      .trim()
      .max(140)
      .nullable()
      .transform((s) => (s === "" ? null : s)),
    /**
     * `fixed`: on these weekdays. `flexible`: any N days a week, in this
     * order, where N is the number of days and the order is the week's.
     */
    scheduleMode,
    days: z.array(programDaySchema).min(1, "a program trains at least one day"),
  })
  .refine(
    (r) => new Set(r.days.map((d) => d.dayOfWeek)).size === r.days.length,
    { message: "each weekday appears once", path: ["days"] },
  );
export type CreateProgram = z.infer<typeof createProgramSchema>;

/** A row in "Your programs": enough to recognise it, not the whole week. */
export const programSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  summary: z.string(),
  scheduleMode,
  /** The weekdays it was written on, Monday first. */
  days: z.array(z.number().int().min(SUNDAY).max(SATURDAY)),
  archived: z.boolean(),
});
export type ProgramSummary = z.infer<typeof programSummarySchema>;

/**
 * A row of the admin's global list (DN-148). `builtIn` marks Just WODs, which
 * is listed so the library reads whole but offers no edit, archive or export.
 */
export const globalProgramSummarySchema = programSummarySchema.extend({
  builtIn: z.boolean(),
});
export type GlobalProgramSummary = z.infer<typeof globalProgramSummarySchema>;

/**
 * A program read back into the editor (DN-146): the body the editor would
 * post, so loading and saving are the same shape, plus what the editor needs
 * to say before a save.
 *
 * `program.summary` is null where the stored line is the one the service
 * wrote from the schedule, so a program whose days change gets a new line
 * rather than keeping one that describes the old week.
 */
export const editableProgramSchema = z.object({
  id: z.string(),
  program: createProgramSchema,
  /**
   * Whether anyone has ever started it, finished runs included (ADR 0006,
   * decision 6). True means a structural save becomes a new version.
   */
  hasRuns: z.boolean(),
  archived: z.boolean(),
});
export type EditableProgram = z.infer<typeof editableProgramSchema>;

/**
 * What a save did. `forked` means the program now lives under a new id and
 * the old one is archived, so the editor and the list follow `program.id`.
 */
export const programSaveResultSchema = z.object({
  program: programSummarySchema,
  forked: z.boolean(),
});
export type ProgramSaveResult = z.infer<typeof programSaveResultSchema>;

/**
 * What removing a program did (DN-147). `running` means the athlete's own
 * active run is on it: the run carries on to its end, and the list says so.
 */
export const programArchiveResultSchema = z.object({
  program: programSummarySchema,
  running: z.boolean(),
});
export type ProgramArchiveResult = z.infer<typeof programArchiveResultSchema>;

/**
 * The line under a program's name when its author left it blank.
 *
 * Here rather than in the service so the editor can show, as a placeholder,
 * the exact line that will be stored.
 */
export function defaultProgramSummary(
  mode: z.infer<typeof scheduleMode>,
  weekdays: number[],
): string {
  if (mode === "flexible") {
    const n = weekdays.length;
    return `Your program, ${n} day${n === 1 ? "" : "s"} a week`;
  }
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const mondayFirst = [...weekdays].sort(
    (a, b) => ((a + 6) % 7) - ((b + 6) % 7),
  );
  return `Your program, ${mondayFirst.map((d) => names[d]).join(" · ")}`;
}

/**
 * A file of global programs (DN-150, ADR 0006 decision 8): how the global
 * library is rebuilt on a fresh database or after a mistake. Each entry is
 * the create body itself, never database rows, so an export loads through
 * exactly the rules the editor saves by.
 *
 * `programs` is checked entry by entry when the file is loaded, so a bad
 * one can be named; the envelope only says what the file is.
 */
export const PROGRAM_EXPORT_FORMAT = "regimen-works/programs";
export const PROGRAM_EXPORT_VERSION = 1;

/**
 * What an export said it was before DN-177 renamed routines to programs, when
 * its list was under `routines`. Files written then still load: the envelope
 * reads one as the same file written today, so nothing past it knows.
 */
export const LEGACY_PROGRAM_EXPORT_FORMAT = "regimen-works/routines";

function fromLegacyExport(file: unknown): unknown {
  if (typeof file !== "object" || file === null) return file;
  const { format, routines, ...rest } = file as Record<string, unknown>;
  if (format !== LEGACY_PROGRAM_EXPORT_FORMAT) return file;
  return { ...rest, format: PROGRAM_EXPORT_FORMAT, programs: routines };
}

export const programExportEnvelopeSchema = z.preprocess(
  fromLegacyExport,
  z.object({
    format: z.literal(PROGRAM_EXPORT_FORMAT, {
      error: "this is not a Regimen Works program export",
    }),
    version: z.literal(PROGRAM_EXPORT_VERSION, {
      error: `this app reads program exports of version ${PROGRAM_EXPORT_VERSION}`,
    }),
    programs: z.array(z.unknown()).min(1, "the file holds no programs"),
  }),
);

export type ProgramExport = {
  format: typeof PROGRAM_EXPORT_FORMAT;
  version: typeof PROGRAM_EXPORT_VERSION;
  programs: CreateProgram[];
};

/** Which global programs to export: an admin's ticks on their list. */
export const exportProgramsSchema = z.strictObject({
  ids: z.array(z.string().min(1)).min(1, "tick at least one program"),
});
export type ExportPrograms = z.infer<typeof exportProgramsSchema>;
