import type {
  CreateExercise,
  Equipment,
  ExercisePhase,
  ExerciseUnit,
  MovementPattern,
  ProgressionLine,
} from "@regimen-works/shared";
import type { ApiExercise, LibraryTier } from "./api";

/**
 * A movement as the library form holds it, before it is a write (DN-28).
 *
 * Every optional field is a string here rather than `T | null`, because a
 * `<select>` and an `<input>` have no null — they have "". Converting at the
 * edge, in `toWriteBody`, keeps the "" in one place instead of at each field.
 *
 * `rung` is the reason this matters rather than being a detail. It is a
 * number the schema allows to be 0, and `Number("")` is also 0 — so a form
 * holding it as a number cannot tell an empty box from the bottom of a
 * ladder, and would write rung 0 onto every movement that has no rung at all.
 */
export type ExerciseDraft = {
  name: string;
  pattern: MovementPattern | "";
  equipment: Equipment[];
  scalable: boolean;
  unit: ExerciseUnit;
  instructions: string;
  line: ProgressionLine | "";
  rung: string;
  altExerciseId: string;
  phase: ExercisePhase | "";
};

/** What a new movement starts as: the bodyweight baseline, off every ladder. */
export const EMPTY_DRAFT: ExerciseDraft = {
  name: "",
  pattern: "",
  equipment: [],
  scalable: false,
  unit: "reps",
  instructions: "",
  line: "",
  rung: "",
  altExerciseId: "",
  phase: "",
};

/** An existing movement, opened for editing. */
export function toDraft(exercise: ApiExercise): ExerciseDraft {
  return {
    name: exercise.name,
    pattern: (exercise.pattern ?? "") as MovementPattern | "",
    equipment: exercise.equipment as Equipment[],
    scalable: exercise.scalable,
    unit: exercise.unit,
    instructions: exercise.instructions ?? "",
    line: (exercise.line ?? "") as ProgressionLine | "",
    rung: exercise.rung === null ? "" : String(exercise.rung),
    altExerciseId: exercise.altExerciseId ?? "",
    phase: (exercise.phase ?? "") as ExercisePhase | "",
  };
}

/** The draft as the API takes it — "" back to null, `rung` back to a number. */
export function toWriteBody(draft: ExerciseDraft): CreateExercise {
  return {
    name: draft.name.trim(),
    pattern: draft.pattern === "" ? null : draft.pattern,
    equipment: draft.equipment,
    scalable: draft.scalable,
    unit: draft.unit,
    instructions:
      draft.instructions.trim() === "" ? null : draft.instructions.trim(),
    line: draft.line === "" ? null : draft.line,
    rung: draft.rung === "" ? null : Number(draft.rung),
    altExerciseId: draft.altExerciseId === "" ? null : draft.altExerciseId,
    phase: draft.phase === "" ? null : draft.phase,
  };
}

/**
 * The movements this draft's alternative may be chosen from.
 *
 * The same rule the API enforces with `referenceableBy`, asked of the list the
 * page already has: a global write may only point at global content, an
 * athlete's own may point at either, and neither may point at a retired row or
 * at itself. Offering one the API would refuse is the difference between a
 * picker and a guess.
 */
export function alternativesFor(
  all: ApiExercise[],
  tier: LibraryTier,
  selfId: string | null,
): ApiExercise[] {
  return all.filter(
    (e) =>
      e.archivedAt === null &&
      e.id !== selfId &&
      (tier === "own" || e.ownerId === null),
  );
}

/**
 * Everything the API would refuse this draft for, said before it is sent.
 *
 * These are not the client's own rules — every one of them is enforced in
 * `ExercisesService.assertCoherent`, and the write is refused without them.
 * They are here because the refusal arrives as one sentence about a form with
 * ten fields in it, and the author is mid-edit with the answer in front of
 * them. The API stays the authority; this is the same thing said sooner.
 *
 * Returns every problem rather than the first, so fixing one does not reveal
 * the next.
 */
export function problemsWith(
  draft: ExerciseDraft,
  alternatives: ApiExercise[],
): string[] {
  const problems: string[] = [];

  if (draft.name.trim() === "") {
    problems.push("A movement needs a name.");
  }

  // Half a ladder is not a position on it: the remembered-choice lookup keys
  // on `line:rung`, so a movement with one and not the other sits on a line it
  // can never be selected from.
  if ((draft.line === "") !== (draft.rung === "")) {
    problems.push(
      "A movement on a progression line needs its position on it — set both the line and the rung, or neither.",
    );
  }

  const alt =
    draft.altExerciseId === ""
      ? null
      : alternatives.find((e) => e.id === draft.altExerciseId);

  // The picker only offers alternatives the API would accept, so a missing one
  // means the list moved under the form — someone retired it in another tab.
  if (draft.altExerciseId !== "" && !alt) {
    problems.push(
      "The alternative is no longer one this movement can point at — choose another.",
    );
  }

  if (draft.equipment.length > 0) {
    if (!alt) {
      problems.push(
        "A movement that needs equipment has to name an alternative, or an athlete without it gets a movement they cannot do.",
      );
    } else if (alt.equipment.length > 0) {
      problems.push(
        `"${alt.name}" needs equipment of its own — the fallback is one step, so the alternative has to need nothing.`,
      );
    }
  }

  // The prescribed count carries over unchanged when a movement is swapped, so
  // a forty-second carry falling back to a reps movement arrives as forty of
  // them.
  if (alt && alt.unit !== draft.unit) {
    problems.push(
      `This is counted in ${draft.unit} and "${alt.name}" is counted in ${alt.unit} — the prescribed count carries over unchanged, so it would arrive meaning something else.`,
    );
  }

  return problems;
}
