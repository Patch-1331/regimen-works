import type { ExerciseUnit, SwapOptionsResponse } from "@regimen-works/shared";

/**
 * The rows the swap panel shows (WOD-5, DN-170).
 *
 * Pure, and in lib rather than beside the panel that renders it, so the
 * choice the athlete is offered can be tested without mounting anything —
 * the same split scheduler.logic.ts makes on the API side.
 *
 * What is on offer is the API's to decide: the movement's group and its
 * muscle matches across the whole library, in three sections. What this adds
 * is where the athlete is — the movement they hold, and the one the workout
 * named — which only the plate knows.
 */

export type SwapRow = {
  exerciseId: string;
  name: string;
  isCurrent: boolean;
  /** The alternative is offered for equipment, not difficulty — labelled, not ranked. */
  isAlternative: boolean;
  /**
   * What the library asked for, where an automatic layer replaced it (DN-110).
   * Labelled for the same reason the alternative is: the athlete is choosing
   * between movements, and which one the workout named is part of the choice.
   */
  isPrescribed: boolean;
  /**
   * Set where the movement is counted in a different unit from the one it
   * would replace (DN-185): the program editor keeps a line's numbers across
   * a swap, so ten reps becoming a ten-second hold is said before the tap.
   */
  unitNote?: "HELD" | "REPS";
};

export type SwapRows = {
  main: SwapRow[];
  /** Under their own heading: the automatic swap never picks these. */
  harder: SwapRow[];
  /** Collapsed by default: kit the athlete hasn't listed in Settings. */
  needsEquipment: SwapRow[];
};

type Named = { id: string; name: string };

/**
 * The panel's rows: the three sections with the current movement marked, and
 * the current and prescribed movements added at the head of the main list
 * where no section holds them.
 *
 * The current movement is always listed, marked rather than filtered away —
 * seeing where you are is half of what makes the choice meaningful. The
 * prescribed movement is added back where an automatic layer replaced it
 * (DN-110): an athlete handed push-ups for want of a bar, in a gym that has
 * one, should be able to take the workout as written.
 *
 * `prescribed` is null on a row the athlete swapped themselves: putting the
 * prescription back there is what the panel's revert does, and offering it
 * twice would be two controls for one intention.
 */
export function buildSwapRows(
  sections: SwapOptionsResponse,
  current: Named,
  prescribed: Named | null,
): SwapRows {
  const row = (o: { exerciseId: string; name: string; isFallback: boolean }): SwapRow => ({
    exerciseId: o.exerciseId,
    name: o.name,
    isCurrent: o.exerciseId === current.id,
    isAlternative: o.isFallback,
    isPrescribed: o.exerciseId === prescribed?.id,
  });
  const main = sections.main.map(row);
  const harder = sections.harder.map(row);
  const needsEquipment = sections.needsEquipment.map(row);

  const listed = new Set([...main, ...harder, ...needsEquipment].map((r) => r.exerciseId));
  const pinned: SwapRow[] = [];
  for (const [movement, isCurrent] of [
    [current, true],
    [prescribed, false],
  ] as const) {
    if (!movement || listed.has(movement.id)) continue;
    listed.add(movement.id);
    pinned.push({
      exerciseId: movement.id,
      name: movement.name,
      isCurrent,
      isAlternative: false,
      isPrescribed: movement.id === prescribed?.id,
    });
  }

  return { main: [...pinned, ...main], harder, needsEquipment };
}

/**
 * The program editor's rows for one line's movement (DN-185): Today's
 * sections with the movement marked, narrowed to what the program's tier may
 * name -- a curated program cannot save an athlete's own movement, so it is
 * not offered one -- and with a change of unit said on the row.
 *
 * No prescription to pin: a program line is the prescription being written.
 */
export function buildAlternativeRows(
  sections: SwapOptionsResponse,
  current: Named & { unit: ExerciseUnit },
  pickable: { id: string; unit: ExerciseUnit }[],
): SwapRows {
  const units = new Map(pickable.map((e) => [e.id, e.unit]));
  const narrow = (rows: SwapRow[]) =>
    rows.flatMap((r): SwapRow[] => {
      if (r.isCurrent) return [r];
      const unit = units.get(r.exerciseId);
      if (unit === undefined) return [];
      if (unit === current.unit) return [r];
      return [{ ...r, unitNote: unit === "seconds" ? "HELD" : "REPS" }];
    });
  const rows = buildSwapRows(sections, current, null);
  return {
    main: narrow(rows.main),
    harder: narrow(rows.harder),
    needsEquipment: narrow(rows.needsEquipment),
  };
}

/**
 * Whether the rows offer anything to move to. One marked row is the movement
 * already showing — an instruction, not a choice — so it reads as nothing.
 */
export function offersAChoice(rows: SwapRows): boolean {
  return [...rows.main, ...rows.harder, ...rows.needsEquipment].some((r) => !r.isCurrent);
}

/**
 * Whether a movement row gets the swap control at all, before its options are
 * read: something to match on — muscles, a group, a written alternative — or
 * a row an automatic layer or the athlete already moved, which always has a
 * way back. A movement with none of these opens onto nothing, and a control
 * that does that is worse than no control.
 */
export function canSwap(
  exercise: {
    primaryMuscles: unknown[];
    movementGroup: string | null;
    fallbackExerciseId: string | null;
  },
  movement: { isSwapped: boolean; prescribedId: string | null },
): boolean {
  return (
    movement.isSwapped ||
    movement.prescribedId !== null ||
    exercise.primaryMuscles.length > 0 ||
    exercise.movementGroup !== null ||
    exercise.fallbackExerciseId !== null
  );
}
