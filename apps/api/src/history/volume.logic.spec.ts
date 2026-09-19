import { buildMovementVolume, type RecordedSet } from './volume.logic';

/**
 * The shape of "what has this movement actually been trained at" (DN-22).
 *
 * The grouping, without a database: which rows become one session, what order
 * they come back in, and what a movement trained twice in one day counts as.
 * `history.service.db-spec.ts` covers which sessions the service hands in.
 */

function set(overrides: Partial<RecordedSet> = {}): RecordedSet {
  return {
    exerciseId: 'chin-up',
    name: 'Chin-up',
    unit: 'reps',
    date: '2026-09-14',
    assignmentId: 'assignment-1',
    movementOrder: 0,
    setNumber: 1,
    actualReps: 3,
    ...overrides,
  };
}

/** A whole session of one movement: `reps` in set order on one day. */
function session(
  reps: number[],
  overrides: Partial<RecordedSet> = {},
): RecordedSet[] {
  return reps.map((actualReps, i) =>
    set({ setNumber: i + 1, actualReps, ...overrides }),
  );
}

describe('buildMovementVolume', () => {
  it('gathers a session into the reps of each set, in the order they were done', () => {
    expect(buildMovementVolume(session([3, 3, 2]))).toEqual([
      {
        exerciseId: 'chin-up',
        name: 'Chin-up',
        unit: 'reps',
        sessions: [
          { date: '2026-09-14', assignmentId: 'assignment-1', sets: [3, 3, 2] },
        ],
      },
    ]);
  });

  it('keeps the sets in order however the rows arrive', () => {
    // The array is the whole point -- `5, 5, 3` and `3, 5, 5` are different
    // sessions, and a query with no ordering is free to hand them back either
    // way round.
    const [first, second, third] = session([5, 5, 3]);

    expect(
      buildMovementVolume([third, first, second])[0].sessions[0].sets,
    ).toEqual([5, 5, 3]);
  });

  it('reads one movement across sessions, newest first', () => {
    const volumes = buildMovementVolume([
      ...session([3, 3, 2], {
        date: '2026-09-07',
        assignmentId: 'assignment-0',
      }),
      ...session([3, 3, 3]),
    ]);

    expect(volumes[0].sessions).toEqual([
      { date: '2026-09-14', assignmentId: 'assignment-1', sets: [3, 3, 3] },
      { date: '2026-09-07', assignmentId: 'assignment-0', sets: [3, 3, 2] },
    ]);
  });

  it('counts a movement prescribed twice in a day as one session', () => {
    // Two lines can resolve to the same exercise, and eight sets of push-ups
    // across two rows of one day is one day's push-ups.
    const volumes = buildMovementVolume([
      ...session([3, 3]),
      ...session([2, 2], { movementOrder: 1 }),
    ]);

    expect(volumes[0].sessions).toEqual([
      { date: '2026-09-14', assignmentId: 'assignment-1', sets: [3, 3, 2, 2] },
    ]);
  });

  it('counts two days that share a date as the sessions they were', () => {
    // Grouped by assignment rather than by date: the same movement on two
    // assignments is two sessions, whatever the calendar says.
    const volumes = buildMovementVolume([
      ...session([3, 3]),
      ...session([2, 2], { assignmentId: 'assignment-2' }),
    ]);

    expect(volumes[0].sessions.map((s) => s.sets)).toEqual([
      [3, 3],
      [2, 2],
    ]);
  });

  it('keeps each movement its own history', () => {
    const volumes = buildMovementVolume([
      ...session([3, 3]),
      ...session([8, 8], {
        exerciseId: 'push-up',
        name: 'Push-up',
        movementOrder: 1,
      }),
    ]);

    expect(volumes.map((v) => [v.exerciseId, v.sessions[0].sets])).toEqual([
      ['chin-up', [3, 3]],
      ['push-up', [8, 8]],
    ]);
  });

  it('puts the most recently trained movement first', () => {
    const volumes = buildMovementVolume([
      ...session([8, 8], {
        exerciseId: 'push-up',
        name: 'Push-up',
        date: '2026-09-07',
        assignmentId: 'assignment-0',
      }),
      ...session([3, 3]),
    ]);

    // The movement the athlete is working on now is the one they are asking
    // about.
    expect(volumes.map((v) => v.exerciseId)).toEqual(['chin-up', 'push-up']);
  });

  it('records a set that was attempted and not made', () => {
    // Zero is an answer. Dropping it would shorten the session by a set and
    // report a day that went better than it did.
    expect(buildMovementVolume(session([3, 3, 0]))[0].sessions[0].sets).toEqual(
      [3, 3, 0],
    );
  });

  it('answers nothing for an athlete who has recorded no sets', () => {
    expect(buildMovementVolume([])).toEqual([]);
  });
});
