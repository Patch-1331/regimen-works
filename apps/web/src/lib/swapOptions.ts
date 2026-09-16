import type { ApiExercise } from "./api";

/**
 * The ladder a swap can move along (WOD-5).
 *
 * Pure, and in lib rather than beside the panel that renders it, so the
 * choice the athlete is offered can be tested without mounting anything —
 * the same split scheduler.logic.ts makes on the API side.
 */

export type SwapOption = {
  exerciseId: string;
  name: string;
  /** Null on the no-equipment alternative, which sits off the ladder. */
  rung: number | null;
  isCurrent: boolean;
  /** The alternative is offered for equipment, not difficulty — labelled, not ranked. */
  isAlternative: boolean;
};

/**
 * The ladder as the athlete should see it: every rung on the movement's line
 * in order, then the current exercise's no-equipment alternative if it has
 * one and it isn't already a rung.
 *
 * Off a tracked line there is no ladder, but there can still be somewhere to
 * go: cardio movements carry `line: null` and an `altExercise` all the same,
 * and a rope the athlete doesn't have today is exactly the case the swap
 * exists for (DN-80). So the pair is offered instead of nothing.
 *
 * Still empty when there is no line *and* no alternative — that really is a
 * control that opens onto nothing.
 */
export function buildSwapOptions(
  exercises: ApiExercise[],
  line: string | null,
  currentExerciseId: string,
): SwapOption[] {
  if (!line) return offLadderOptions(exercises, currentExerciseId);

  const rungs = exercises
    .filter((e) => e.line === line && e.rung !== null)
    .sort((a, b) => (a.rung ?? 0) - (b.rung ?? 0));
  if (rungs.length === 0) return [];

  const options: SwapOption[] = rungs.map((e) => ({
    exerciseId: e.id,
    name: e.name,
    rung: e.rung,
    isCurrent: e.id === currentExerciseId,
    isAlternative: false,
  }));

  const alt = exercises.find((e) => e.id === currentExerciseId)?.altExercise;
  if (alt && !options.some((o) => o.exerciseId === alt.id)) {
    options.push({
      exerciseId: alt.id,
      name: alt.name,
      rung: null,
      isCurrent: alt.id === currentExerciseId,
      isAlternative: true,
    });
  }

  return options;
}

/**
 * What a movement off any progression line can be swapped to: itself and its
 * no-equipment alternative, or nothing at all.
 *
 * The line gate used to refuse these rows outright, and that was right while
 * equipment meant the bar — cardio had no ladder to climb, so the row got no
 * control rather than one that opened onto nothing. Equipment made it wrong:
 * once a WOD can name a jump rope, an athlete can be handed a movement they
 * own nothing for, on a row that is the one row in the app with no way out.
 *
 * The current exercise is listed alongside the alternative rather than the
 * alternative being offered alone, for the reason the ladder lists every rung
 * with the current one marked: a single unmarked row reads as an instruction,
 * not as a choice between two things.
 *
 * Nothing is offered in the other direction — from the alternative back to the
 * movement it stands in for. That is what the panel's revert is for on a row
 * the athlete swapped themselves, and on a row the equipment layer moved it
 * needs the prescribed exercise's id, which the payload does not carry (DN-110).
 */
function offLadderOptions(
  exercises: ApiExercise[],
  currentExerciseId: string,
): SwapOption[] {
  const current = exercises.find((e) => e.id === currentExerciseId);
  const alt = current?.altExercise;
  if (!current || !alt) return [];

  return [
    {
      exerciseId: current.id,
      name: current.name,
      rung: null,
      isCurrent: true,
      isAlternative: false,
    },
    {
      exerciseId: alt.id,
      name: alt.name,
      rung: null,
      isCurrent: false,
      isAlternative: true,
    },
  ];
}
