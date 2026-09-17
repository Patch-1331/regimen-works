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
  /**
   * What the library asked for, where an automatic layer replaced it (DN-110).
   * Labelled for the same reason the alternative is: the athlete is choosing
   * between movements, and which one the workout named is part of the choice.
   */
  isPrescribed: boolean;
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
 * Whatever the ladder yields, the movement the library prescribed is added
 * back if an automatic layer replaced it and it isn't already listed (DN-110):
 * an athlete handed high knees for want of a rope, in a gym that has one,
 * should be able to take the workout as written.
 *
 * Still empty when a single option is all there is — one unmarked row reads as
 * an instruction, not a choice, and a control that opens onto the movement
 * already showing is worse than no control.
 */
export function buildSwapOptions(
  exercises: ApiExercise[],
  line: string | null,
  currentExerciseId: string,
  prescribedId: string | null = null,
): SwapOption[] {
  const options = line
    ? ladderOptions(exercises, line, currentExerciseId)
    : offLadderOptions(exercises, currentExerciseId);
  const withPrescribed = addPrescribed(options, exercises, prescribedId);
  return withPrescribed.length > 1 ? withPrescribed : [];
}

function ladderOptions(
  exercises: ApiExercise[],
  line: string,
  currentExerciseId: string,
): SwapOption[] {
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
    isPrescribed: false,
  }));

  const alt = exercises.find((e) => e.id === currentExerciseId)?.altExercise;
  if (alt && !options.some((o) => o.exerciseId === alt.id)) {
    options.push({
      exerciseId: alt.id,
      name: alt.name,
      rung: null,
      isCurrent: alt.id === currentExerciseId,
      isAlternative: true,
      isPrescribed: false,
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
 * The other direction — from the alternative back to the movement it stands in
 * for — is `addPrescribed`'s job rather than this one's. It cannot be derived
 * here: an alternative is shared between movements (high knees stands in for
 * several rope movements), so reading backwards from one is ambiguous.
 *
 * The current exercise alone is returned where there is no alternative, and
 * dropped by the caller unless the prescribed movement joins it.
 */
function offLadderOptions(
  exercises: ApiExercise[],
  currentExerciseId: string,
): SwapOption[] {
  const current = exercises.find((e) => e.id === currentExerciseId);
  if (!current) return [];

  const options: SwapOption[] = [
    {
      exerciseId: current.id,
      name: current.name,
      rung: null,
      isCurrent: true,
      isAlternative: false,
      isPrescribed: false,
    },
  ];
  if (current.altExercise) {
    options.push({
      exerciseId: current.altExercise.id,
      name: current.altExercise.name,
      rung: null,
      isCurrent: false,
      isAlternative: true,
      isPrescribed: false,
    });
  }
  return options;
}

/**
 * Marks the movement the library prescribed, adding it to the list if the
 * ladder doesn't already hold it (DN-110).
 *
 * `prescribedId` is non-null only where an automatic layer replaced the
 * movement — the athlete's remembered choice on this line, or equipment they
 * don't own. It is null on a row they swapped themselves: putting the
 * prescription back there is what the panel's revert does, and offering it
 * twice, once as a swap that leaves the substitution in place, would be two
 * controls for one intention.
 *
 * A prescribed id the library doesn't hold is passed over rather than
 * offered — the same quiet degrading the resolution layers do, and the
 * alternative is a swap the athlete taps and the API rejects.
 */
function addPrescribed(
  options: SwapOption[],
  exercises: ApiExercise[],
  prescribedId: string | null,
): SwapOption[] {
  if (!prescribedId) return options;

  const listed = options.some((o) => o.exerciseId === prescribedId);
  if (listed) {
    return options.map((o) =>
      o.exerciseId === prescribedId ? { ...o, isPrescribed: true } : o,
    );
  }

  const prescribed = exercises.find((e) => e.id === prescribedId);
  if (!prescribed) return options;

  return [
    ...options,
    {
      exerciseId: prescribed.id,
      name: prescribed.name,
      rung: prescribed.rung,
      isCurrent: false,
      isAlternative: false,
      isPrescribed: true,
    },
  ];
}
