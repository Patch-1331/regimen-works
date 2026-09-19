import type { MovementVolume } from '@regimen-works/shared';

/** One recorded set, with everything the grouping needs flattened onto it. */
export type RecordedSet = {
  exerciseId: string;
  /** The exercise's name, as it reads now. */
  name: string;
  unit: MovementVolume['unit'];
  /** The training day, from the assignment rather than from the tap. */
  date: string;
  assignmentId: string;
  /** Position in the session, which is the order the sets were done in. */
  movementOrder: number;
  setNumber: number;
  actualReps: number;
};

/**
 * Turns recorded sets into one volume history per movement (DN-22).
 *
 * The counterpart to `buildMovementHistory`, from the other source. That one
 * reads the session snapshots and so describes what each day *prescribed*;
 * this one reads `WorkoutSetLog` and so describes what came out of it.
 *
 * Keyed by exercise id rather than by name, so a renamed movement stays one
 * history. Grouped by assignment rather than by date, because a movement can
 * appear twice in one day's prescription -- two lines resolving to the same
 * exercise -- and those are one session's sets rather than two sessions.
 *
 * Pure, and given rows rather than a client: which sessions count is the
 * service's decision, and the shape of the answer is testable without one.
 */
export function buildMovementVolume(sets: RecordedSet[]): MovementVolume[] {
  // Newest day first, and within a day the order the sets were done in, so
  // every array below is built by appending and needs no later sort.
  const ordered = [...sets].sort(
    (a, b) =>
      b.date.localeCompare(a.date) ||
      // Assignment before position, so one session's rows stay together: two
      // assignments can share a date, and the grouping below reads the rows in
      // a run rather than looking a session up again once it has moved on.
      a.assignmentId.localeCompare(b.assignmentId) ||
      a.movementOrder - b.movementOrder ||
      a.setNumber - b.setNumber,
  );

  const volumes = new Map<string, MovementVolume>();

  for (const set of ordered) {
    let volume = volumes.get(set.exerciseId);
    if (!volume) {
      volume = {
        exerciseId: set.exerciseId,
        name: set.name,
        unit: set.unit,
        sessions: [],
      };
      volumes.set(set.exerciseId, volume);
    }

    // Only ever the last one, because the rows arrive day by day: a set for an
    // earlier session can never follow one for a later session.
    const session = volume.sessions[volume.sessions.length - 1];
    if (session && session.assignmentId === set.assignmentId) {
      session.sets.push(set.actualReps);
    } else {
      volume.sessions.push({
        date: set.date,
        assignmentId: set.assignmentId,
        sets: [set.actualReps],
      });
    }
  }

  // Most recently trained first: the movement the athlete is working on now is
  // the one they are asking about.
  // Already in the order the athlete wants them: the rows were sorted newest
  // first, so a movement is added to the map the first time one of its sets
  // appears -- which is its most recent session.
  return [...volumes.values()];
}
