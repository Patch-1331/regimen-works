import type { ApiExercise } from "./api";

/**
 * The movements a swap can move between (WOD-5).
 *
 * Pure, and in lib rather than beside the panel that renders it, so the
 * choice the athlete is offered can be tested without mounting anything —
 * the same split scheduler.logic.ts makes on the API side.
 */

export type SwapOption = {
  exerciseId: string;
  name: string;
  /** Null on the no-equipment fallback, which is not a group member. */
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
 * The group as the athlete should see it: every member of the movement's
 * group in list order, then the current exercise's no-equipment fallback if
 * it has one and it isn't already a member.
 *
 * The order is display only. The set is what matters — any member can be
 * swapped for any other, in either direction (ADR-0004).
 *
 * Outside a group there is nothing to move between, but there can still be
 * somewhere to go: cardio movements carry no group and a `fallbackExercise`
 * all the same, and a rope the athlete doesn't have today is exactly the case
 * the swap exists for (DN-80). So the pair is offered instead of nothing.
 *
 * Whatever the group yields, the movement the library prescribed is added
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
  movementGroup: string | null,
  currentExerciseId: string,
  prescribedId: string | null = null,
): SwapOption[] {
  const options = movementGroup
    ? groupOptions(exercises, movementGroup, currentExerciseId)
    : offGroupOptions(exercises, currentExerciseId);
  const withPrescribed = addPrescribed(options, exercises, prescribedId);
  return withPrescribed.length > 1 ? withPrescribed : [];
}

function groupOptions(
  exercises: ApiExercise[],
  movementGroup: string,
  currentExerciseId: string,
): SwapOption[] {
  const rungs = exercises
    .filter((e) => e.movementGroup === movementGroup && e.rung !== null)
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

  const fallback = exercises.find((e) => e.id === currentExerciseId)?.fallbackExercise;
  if (fallback && !options.some((o) => o.exerciseId === fallback.id)) {
    options.push({
      exerciseId: fallback.id,
      name: fallback.name,
      rung: null,
      isCurrent: fallback.id === currentExerciseId,
      isAlternative: true,
      isPrescribed: false,
    });
  }

  return options;
}

/**
 * What a movement in no group can be swapped to: itself and its no-equipment
 * fallback, or nothing at all.
 *
 * The group gate used to refuse these rows outright, and that was right while
 * equipment meant the bar — cardio had nowhere to go, so the row got no
 * control rather than one that opened onto nothing. Equipment made it wrong:
 * once a WOD can name a jump rope, an athlete can be handed a movement they
 * own nothing for, on a row that is the one row in the app with no way out.
 *
 * The current exercise is listed alongside the alternative rather than the
 * alternative being offered alone, for the reason the group lists every
 * member with the current one marked: a single unmarked row reads as an instruction,
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
function offGroupOptions(
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
  if (current.fallbackExercise) {
    options.push({
      exerciseId: current.fallbackExercise.id,
      name: current.fallbackExercise.name,
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
 * group doesn't already hold it (DN-110).
 *
 * `prescribedId` is non-null only where an automatic layer replaced the
 * movement — the athlete's remembered choice in this group, or equipment they
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
