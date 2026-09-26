import type {
  MovementHistory,
  MovementHistoryDay,
  SessionMovement,
} from '@regimen-works/shared';

/** One training day as the service loads it: the snapshot plus what it belongs to. */
export type TrainedDay = {
  date: string;
  /** The WOD's name, or `PRESCRIBED_DAY_NAME` on a strength day (DN-126). */
  name: string;
  movements: SessionMovement[];
};

/**
 * Turns training days into one history per movement (DN-89).
 *
 * Built from the session snapshots (DN-90) rather than from
 * `AssignmentSubstitution`, which is what this issue originally proposed
 * reading. A substitution row exists only where the athlete *changed*
 * something, so that source has holes on exactly the days nothing changed --
 * which is most days. The snapshot records every session, including the
 * ordinary ones, and records it as it stood rather than as today's settings
 * would re-derive it.
 *
 * Keyed by exercise id rather than by name, so a renamed movement stays one
 * history -- while the name shown is the one the snapshot carries, because a
 * rename must not rewrite what August says.
 *
 * Pure, and given days rather than a client: what counts as a training day is
 * the service's decision, and the shape of the answer is testable without one.
 */
export function buildMovementHistory(days: TrainedDay[]): MovementHistory[] {
  const histories = new Map<string, MovementHistory>();

  // Newest first, so the name and unit a history carries are the ones from the
  // most recent day it was trained -- and `days` comes out in the order the
  // athlete reads it.
  const ordered = [...days].sort((a, b) => b.date.localeCompare(a.date));

  for (const day of ordered) {
    for (const movement of day.movements) {
      const entry: MovementHistoryDay = {
        date: day.date,
        name: day.name,
        reps: movement.reps,
        repsMax: movement.repsMax,
        toFailure: movement.toFailure,
        isSwapped: movement.isSwapped,
        prescribedName: movement.prescribedName,
        prescribedReason: movement.prescribedReason,
      };

      const existing = histories.get(movement.exercise.id);
      if (!existing) {
        histories.set(movement.exercise.id, {
          exerciseId: movement.exercise.id,
          name: movement.exercise.name,
          movementGroup: movement.exercise.movementGroup,
          unit: movement.exercise.unit,
          sessions: 1,
          total: movement.reps ?? 0,
          firstTrained: day.date,
          lastTrained: day.date,
          days: [entry],
        });
        continue;
      }

      // Two rows of one WOD can resolve to the same movement -- two rope
      // movements both falling to high knees, say -- so a repeat within a day
      // is volume, not a second session.
      const sameDay = existing.days.some((d) => d.date === day.date);
      if (!sameDay) existing.sessions += 1;
      // The floor of what was prescribed. A range adds its bottom, and a set
      // worked to failure adds nothing -- it named no number, and the only
      // other options are to invent one or to stop reporting volume at all
      // (DN-142).
      existing.total += movement.reps ?? 0;
      // Days arrive newest first, so every later one is older than what is
      // already there. Only the first day sets `lastTrained`.
      existing.firstTrained = day.date;
      existing.days.push(entry);
    }
  }

  // Most recently trained first: the movement the athlete is working on now is
  // the one they are asking about.
  return [...histories.values()].sort((a, b) =>
    b.lastTrained.localeCompare(a.lastTrained),
  );
}
