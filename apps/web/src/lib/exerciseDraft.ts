import type {
  AlternativeSuggestionsRequest,
  CreateExercise,
  Equipment,
  ExerciseCategory,
  ExerciseForce,
  ExerciseLevel,
  ExerciseMechanic,
  ExerciseUnit,
  MovementPattern,
  MovementGroup,
  Muscle,
} from "@regimen-works/shared";
import type { ApiExercise, LibraryTier } from "./api";

/**
 * A movement as the library form holds it, before it is a write (DN-28).
 *
 * Every optional field is a string here rather than `T | null`, because a
 * `<select>` and an `<input>` have no null — they have "". Converting at the
 * edge, in `toWriteBody`, keeps the "" in one place instead of at each field.
 */
export type ExerciseDraft = {
  name: string;
  pattern: MovementPattern | "";
  equipment: Equipment[];
  scalable: boolean;
  unit: ExerciseUnit;
  /** One step per line, as the textarea holds them; see `toSteps`. */
  instructions: string;
  movementGroup: MovementGroup | "";
  fallbackExerciseId: string;
  /** In the order they were ticked: the first is the prime mover. */
  primaryMuscles: Muscle[];
  secondaryMuscles: Muscle[];
  force: ExerciseForce | "";
  mechanic: ExerciseMechanic | "";
  level: ExerciseLevel | "";
  category: ExerciseCategory | "";
};

/** What a new movement starts as: the bodyweight baseline, in no group. */
export const EMPTY_DRAFT: ExerciseDraft = {
  name: "",
  pattern: "",
  equipment: [],
  scalable: false,
  unit: "reps",
  instructions: "",
  movementGroup: "",
  fallbackExerciseId: "",
  primaryMuscles: [],
  secondaryMuscles: [],
  force: "",
  mechanic: "",
  level: "",
  category: "",
};

/** An existing movement, opened for editing. */
export function toDraft(exercise: ApiExercise): ExerciseDraft {
  return {
    name: exercise.name,
    pattern: (exercise.pattern ?? "") as MovementPattern | "",
    equipment: exercise.equipment as Equipment[],
    scalable: exercise.scalable,
    unit: exercise.unit,
    instructions: exercise.instructions.join("\n"),
    movementGroup: (exercise.movementGroup ?? "") as MovementGroup | "",
    fallbackExerciseId: exercise.fallbackExerciseId ?? "",
    primaryMuscles: exercise.primaryMuscles as Muscle[],
    secondaryMuscles: exercise.secondaryMuscles as Muscle[],
    force: (exercise.force ?? "") as ExerciseForce | "",
    mechanic: (exercise.mechanic ?? "") as ExerciseMechanic | "",
    level: (exercise.level ?? "") as ExerciseLevel | "",
    category: (exercise.category ?? "") as ExerciseCategory | "",
  };
}

/**
 * The textarea's lines as steps (DN-165): one per line, trimmed, blank lines
 * dropped. The schema refuses a blank step, and a line left empty between two
 * steps for breathing room is not a step anyone wrote.
 */
export function toSteps(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/** The draft as the API takes it — "" back to null. */
export function toWriteBody(draft: ExerciseDraft): CreateExercise {
  return {
    name: draft.name.trim(),
    pattern: draft.pattern === "" ? null : draft.pattern,
    equipment: draft.equipment,
    scalable: draft.scalable,
    unit: draft.unit,
    instructions: toSteps(draft.instructions),
    movementGroup: draft.movementGroup === "" ? null : draft.movementGroup,
    fallbackExerciseId: draft.fallbackExerciseId === "" ? null : draft.fallbackExerciseId,
    primaryMuscles: draft.primaryMuscles,
    secondaryMuscles: draft.secondaryMuscles,
    force: draft.force === "" ? null : draft.force,
    mechanic: draft.mechanic === "" ? null : draft.mechanic,
    level: draft.level === "" ? null : draft.level,
    category: draft.category === "" ? null : draft.category,
  };
}

/**
 * What to ask the API for alternative suggestions with (DN-205), or null
 * while the draft names no prime mover: there is nothing to match on yet.
 */
export function suggestionRequest(
  draft: ExerciseDraft,
  selfId: string | null,
): AlternativeSuggestionsRequest | null {
  if (draft.primaryMuscles.length === 0) return null;
  const body = toWriteBody(draft);
  return {
    selfId,
    unit: body.unit,
    equipment: body.equipment,
    movementGroup: body.movementGroup,
    primaryMuscles: body.primaryMuscles,
    secondaryMuscles: body.secondaryMuscles,
    force: body.force,
    mechanic: body.mechanic,
    level: body.level,
    category: body.category,
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
 *
 * Bodyweight only (DN-205): the alternative is what an athlete without the
 * kit is given, and one needing kit of its own is refused. Before this the
 * picker offered the whole library, most of which the save then turned down.
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
      e.equipment.length === 0 &&
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

  if (draft.primaryMuscles.length === 0) {
    problems.push("Choose the muscle it works — at least one primary muscle.");
  }

  const fallback =
    draft.fallbackExerciseId === ""
      ? null
      : alternatives.find((e) => e.id === draft.fallbackExerciseId);

  // The picker only offers alternatives the API would accept, so a missing one
  // means the list moved under the form — someone retired it in another tab.
  if (draft.fallbackExerciseId !== "" && !fallback) {
    problems.push(
      "The alternative is no longer one this movement can point at — choose another.",
    );
  }

  // With no alternative, the muscle match finds one for an athlete without the
  // kit (DN-205) — and it needs a category and a level to do it. The muscle is
  // already reported above.
  if (draft.equipment.length > 0) {
    if (!fallback) {
      const missing = [
        draft.category === "" && "a category",
        draft.level === "" && "a level",
      ].filter((m): m is string => m !== false);
      if (missing.length > 0) {
        problems.push(
          `With no alternative chosen, give it ${missing.join(" and ")} so one can be found for an athlete without the equipment.`,
        );
      }
    } else if (fallback.equipment.length > 0) {
      problems.push(
        `"${fallback.name}" needs equipment of its own — the fallback is one step, so the alternative has to need nothing.`,
      );
    }
  }

  // The prescribed count carries over unchanged when a movement is swapped, so
  // a forty-second carry falling back to a reps movement arrives as forty of
  // them.
  if (fallback && fallback.unit !== draft.unit) {
    problems.push(
      `This is counted in ${draft.unit} and "${fallback.name}" is counted in ${fallback.unit} — the prescribed count carries over unchanged, so it would arrive meaning something else.`,
    );
  }

  return problems;
}
