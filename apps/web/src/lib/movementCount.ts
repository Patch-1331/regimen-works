/**
 * What a WOD movement's count reads as: the ladder as prescribed ("21-15-9")
 * where there is one, otherwise the flat count. `reps` is the ladder's total,
 * which is the one number that would tell the athlete nothing.
 *
 * Shared by the Today plate and the workout library, so a workout reads the
 * same in the list as it does on the day it is served.
 */
export function movementCount(m: {
  reps: number;
  repScheme: number[];
  exercise: { unit: string };
}): string {
  const suffix = m.exercise.unit === "seconds" ? "s" : "";
  if (m.repScheme.length > 0) return `${m.repScheme.join("-")}${suffix}`;
  return `${m.reps}${suffix}`;
}
