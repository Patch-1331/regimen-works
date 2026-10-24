import {
  loadStepLabel,
  repsLabel,
  type ExerciseUnit,
  type RepShape,
} from "@regimen-works/shared";

/**
 * How a line's sets read, wherever a prescription is shown (ADR 0011): Today's
 * plate and a past day in a movement's history (DN-192) say it the same way,
 * so a day reads back the way it was handed out.
 */

/** The fields of a set these labels read -- a count and a load step, never a weight. */
type SetShape = RepShape & { loadStepPercent: number | null };

/**
 * The line's count when every set is alike -- the same count and no load step
 * -- or null where they differ. A uniform line reads "5 × 3"; one that varies
 * has no single count to put after the ×.
 */
export function uniformCount(
  sets: readonly SetShape[],
  unit: ExerciseUnit,
): string | null {
  const [first, ...more] = sets;
  const alike = more.every(
    (s) =>
      s.reps === first.reps &&
      s.repsMax === first.repsMax &&
      s.toFailure === first.toFailure &&
      s.loadStepPercent === null,
  );
  return alike ? repsLabel(first, unit) : null;
}

/** Each set in order with its load step: "6-8 · 8-10 −10% · 10-12 −10%". */
export function setByStep(sets: readonly SetShape[], unit: ExerciseUnit): string {
  return sets
    .map((s) => {
      const step = loadStepLabel(s.loadStepPercent);
      const reps = repsLabel(s, unit);
      return step ? `${reps} ${step}` : reps;
    })
    .join(" · ");
}
