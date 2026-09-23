import {
  resolveIntervalConfig,
  type CreateWod,
  type MovementPattern,
  type WodType,
} from "@regimen-works/shared";
import type { ApiExercise, ApiWod, LibraryTier } from "./api";

/**
 * A movement as the editor holds it, before it is a write (DN-29).
 *
 * `mode` is what keeps the CHECK constraint `WodMovement_repScheme_sums_to_reps`
 * unreachable rather than merely unviolated. A movement is *either* a flat
 * count every round *or* a ladder whose total is derived — never both, and
 * never neither. Holding that as a mode means the two number fields cannot be
 * filled in at the same time, so the write schema's exactly-one-of rule is
 * something the form cannot express a violation of.
 *
 * Both counts are strings for the reason `ExerciseDraft.sortOrder` is: an input
 * has no number, it has "", and `Number("")` is 0.
 */
export type MovementDraft = {
  exerciseId: string;
  mode: "flat" | "ladder";
  /** The per-round count, when flat. */
  reps: string;
  /** The ladder as it is typed — "21-15-9", or "21, 15, 9". */
  repScheme: string;
};

export type WodDraft = {
  name: string;
  type: WodType;
  timeCapMinutes: string;
  rounds: string;
  workSeconds: string;
  restSeconds: string;
  intervalCount: string;
  isNamed: boolean;
  dominantPattern: MovementPattern;
  description: string;
  movements: MovementDraft[];
};

/** The formats that run an interval timer, and so have structure to set. */
const INTERVAL_TYPES: WodType[] = ["emom", "tabata"];

export function isIntervalType(type: WodType): boolean {
  return INTERVAL_TYPES.includes(type);
}

export const EMPTY_MOVEMENT: MovementDraft = {
  exerciseId: "",
  mode: "flat",
  reps: "",
  repScheme: "",
};

/** A new workout: for time, twelve minutes, one movement to fill in. */
export const EMPTY_WOD_DRAFT: WodDraft = {
  name: "",
  type: "for_time",
  timeCapMinutes: "12",
  rounds: "",
  workSeconds: "",
  restSeconds: "",
  intervalCount: "",
  isNamed: false,
  dominantPattern: "push",
  description: "",
  movements: [EMPTY_MOVEMENT],
};

/** Digits, and the three ways people separate them. Nothing else. */
const LADDER_SHAPE = /^[0-9]+(?:[\s,\-–]+[0-9]+)*$/;

/**
 * A ladder as typed, read into numbers.
 *
 * Separators are deliberately loose — "21-15-9", "21 15 9" and "21, 15, 9"
 * are the same workout written by three people, and refusing two of them
 * would be the app being particular about punctuation rather than about
 * workouts.
 *
 * What it will not do is guess. "3x10" is rejected rather than read as
 * [3, 10], because the person writing it means three rounds of ten and the
 * ladder [3, 10] is a workout of thirteen reps — a misreading the author
 * would have no reason to look for. Anything that is not the shape above
 * comes back as null and `problemsWith` says so.
 */
export function parseRepScheme(typed: string): number[] | null {
  const trimmed = typed.trim();
  if (!LADDER_SHAPE.test(trimmed)) return null;

  const parts = trimmed.split(/[\s,\-–]+/).map(Number);
  return parts.every((n) => n > 0) ? parts : null;
}

/** What a ladder adds up to — the number the database stores as `reps`. */
export function schemeTotal(scheme: number[]): number {
  return scheme.reduce((sum, n) => sum + n, 0);
}

/** An existing workout, opened for editing. */
export function toWodDraft(wod: ApiWod): WodDraft {
  return {
    name: wod.name,
    type: wod.type,
    timeCapMinutes: String(wod.timeCapMinutes),
    rounds: wod.rounds === null ? "" : String(wod.rounds),
    workSeconds: wod.workSeconds === null ? "" : String(wod.workSeconds),
    restSeconds: wod.restSeconds === null ? "" : String(wod.restSeconds),
    intervalCount:
      wod.intervalCount === null ? "" : String(wod.intervalCount),
    isNamed: wod.isNamed,
    dominantPattern: wod.dominantPattern,
    description: wod.description ?? "",
    movements: wod.movements.map((m) => ({
      exerciseId: m.exercise.id,
      mode: m.repScheme.length > 0 ? "ladder" : "flat",
      // A ladder's `reps` is its total, which is derived — carrying it into
      // the flat field would offer the author a number to edit that the next
      // save would overwrite.
      reps: m.repScheme.length > 0 ? "" : String(m.reps),
      repScheme: m.repScheme.join("-"),
    })),
  };
}

/**
 * The draft as the API takes it.
 *
 * `reps` and `repScheme` are exactly-one-of by construction: the mode decides
 * which one is sent, and the other is the schema's own default. The ladder's
 * total is never written here at all — the service derives it, which is what
 * keeps the CHECK constraint something neither layer can disagree about.
 *
 * Only ever called on a draft `problemsWith` has passed, so the numbers are
 * known to parse.
 */
export function toWodWriteBody(draft: WodDraft): CreateWod {
  const interval = isIntervalType(draft.type);
  const optional = (typed: string) => (typed === "" ? null : Number(typed));

  return {
    name: draft.name.trim(),
    type: draft.type,
    timeCapMinutes: Number(draft.timeCapMinutes),
    rounds: optional(draft.rounds),
    // Null on a format with no intervals, whatever is in the fields: the
    // author may have typed them, switched format, and never looked back, and
    // the service refuses values it would never read.
    workSeconds: interval ? optional(draft.workSeconds) : null,
    restSeconds: interval ? optional(draft.restSeconds) : null,
    intervalCount: interval ? optional(draft.intervalCount) : null,
    isNamed: draft.isNamed,
    dominantPattern: draft.dominantPattern,
    description:
      draft.description.trim() === "" ? null : draft.description.trim(),
    movements: draft.movements.map((m) =>
      m.mode === "ladder"
        ? {
            exerciseId: m.exerciseId,
            reps: null,
            repScheme: parseRepScheme(m.repScheme) ?? [],
          }
        : { exerciseId: m.exerciseId, reps: Number(m.reps), repScheme: [] },
    ),
  };
}

/**
 * The movements this WOD may be built from.
 *
 * The same rule `referenceableBy` enforces: a global WOD is the scheduler's
 * candidate pool for every athlete, so it may name only global, live content
 * — one athlete's own exercise would break everyone's scheduler the day they
 * retired it. An athlete's own WOD may name either tier.
 */
export function movementChoicesFor(
  exercises: ApiExercise[],
  tier: LibraryTier,
): ApiExercise[] {
  return exercises.filter(
    (e) =>
      e.archivedAt === null && (tier === "own" || e.ownerId === null),
  );
}

/**
 * What the interval fields will mean if they are left empty.
 *
 * `resolveIntervalConfig` fills the format's classic structure in for nulls —
 * EMOM's 60/0, Tabata's 20/10 × 8 — and the editor shows that rather than
 * writing it into the row. A stored 60 is a decision that stops following the
 * helper; an empty field is a workout that still says "an EMOM is an EMOM".
 */
export function intervalFallback(draft: WodDraft) {
  return resolveIntervalConfig({
    type: draft.type,
    timeCapMinutes: Number(draft.timeCapMinutes) || 0,
    rounds: draft.rounds === "" ? null : Number(draft.rounds),
    workSeconds: null,
    restSeconds: null,
    intervalCount: null,
  });
}

/** A positive whole number, as every count on this form has to be. */
function positiveInt(typed: string): boolean {
  const n = Number(typed);
  return typed.trim() !== "" && Number.isInteger(n) && n > 0;
}

/**
 * Everything the API would refuse this draft for, said before it is sent.
 *
 * As with `exerciseDraft.problemsWith`, these are not the client's own rules.
 * `WodsService` enforces every one of them and the write is refused without
 * them; they are here because the refusal arrives as one sentence about a
 * form with a dozen fields and a movement list, and the author is mid-edit
 * with the answer in front of them.
 *
 * Returns every problem rather than the first, so fixing one does not reveal
 * the next.
 */
export function problemsWith(
  draft: WodDraft,
  choices: ApiExercise[],
): string[] {
  const problems: string[] = [];

  if (draft.name.trim() === "") problems.push("A workout needs a name.");

  if (!positiveInt(draft.timeCapMinutes)) {
    problems.push("The time cap has to be a whole number of minutes.");
  }
  if (draft.rounds !== "" && !positiveInt(draft.rounds)) {
    problems.push("Rounds has to be a whole number, or empty.");
  }

  if (isIntervalType(draft.type)) {
    // Each may be left empty — `resolveIntervalConfig` fills the format's
    // classic structure in. What it may not be is nonsense.
    if (draft.workSeconds !== "" && !positiveInt(draft.workSeconds)) {
      problems.push("Work seconds has to be a whole number, or empty.");
    }
    if (
      draft.restSeconds !== "" &&
      !(Number.isInteger(Number(draft.restSeconds)) &&
        Number(draft.restSeconds) >= 0)
    ) {
      // Zero is the EMOM case: work runs straight into the next interval.
      problems.push("Rest seconds has to be zero or more, or empty.");
    }
    if (draft.intervalCount !== "" && !positiveInt(draft.intervalCount)) {
      problems.push("Interval count has to be a whole number, or empty.");
    }
  }

  if (draft.movements.length === 0) {
    problems.push(
      "A workout needs at least one movement, or it hands the athlete an empty screen at the moment they meant to train.",
    );
  }

  const offered = new Set(choices.map((e) => e.id));
  const schemeLengths = new Set<number>();

  draft.movements.forEach((m, index) => {
    const where = `Movement ${index + 1}`;

    if (m.exerciseId === "") {
      problems.push(`${where} has no movement chosen.`);
    } else if (!offered.has(m.exerciseId)) {
      // The pool moved under the form, or the author switched the workout to
      // the shared library after picking one of their own.
      problems.push(
        `${where} names a movement this workout cannot point at — not in the library, retired, or another athlete's own.`,
      );
    }

    if (m.mode === "flat") {
      if (!positiveInt(m.reps)) {
        problems.push(`${where} needs a rep count of at least one.`);
      }
      return;
    }

    const scheme = parseRepScheme(m.repScheme);
    if (!scheme) {
      problems.push(
        `${where}'s ladder has to be whole numbers above zero — "21-15-9".`,
      );
      return;
    }
    schemeLengths.add(scheme.length);
  });

  // A ladder is one shape for the whole workout: 21-15-9 of push-ups and jump
  // squats is three rounds for both. Schemes of different lengths leave no
  // single answer to "what round is this?".
  if (schemeLengths.size > 1) {
    problems.push(
      "Every ladder in a workout has to have the same number of rounds — these have " +
        [...schemeLengths].sort((a, b) => a - b).join(" and ") +
        ".",
    );
  }

  return problems;
}
