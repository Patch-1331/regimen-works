import {
  advanceInterval,
  mergeRoundSplit,
  snapshotMovements,
  snapshotPrescribedMovements,
} from './session.logic';

describe('mergeRoundSplit', () => {
  it('appends a new round to an empty list', () => {
    expect(mergeRoundSplit([], { round: 1, atSeconds: 42 })).toEqual([
      { round: 1, atSeconds: 42 },
    ]);
  });

  it('appends a new round after existing ones', () => {
    const existing = [
      { round: 1, atSeconds: 42 },
      { round: 2, atSeconds: 90 },
    ];
    expect(mergeRoundSplit(existing, { round: 3, atSeconds: 130 })).toEqual([
      { round: 1, atSeconds: 42 },
      { round: 2, atSeconds: 90 },
      { round: 3, atSeconds: 130 },
    ]);
  });

  it('replaces rather than duplicates on a resubmitted round (e.g. a retried request)', () => {
    const existing = [
      { round: 1, atSeconds: 42 },
      { round: 2, atSeconds: 90 },
    ];
    // round 2 tapped again with a slightly different timestamp — the retry, not a new round
    const result = mergeRoundSplit(existing, { round: 2, atSeconds: 91 });
    expect(result).toEqual([
      { round: 1, atSeconds: 42 },
      { round: 2, atSeconds: 91 },
    ]);
  });

  it('keeps the list sorted by round even if a tap arrives out of order', () => {
    const existing = [
      { round: 1, atSeconds: 42 },
      { round: 3, atSeconds: 130 },
    ];
    const result = mergeRoundSplit(existing, { round: 2, atSeconds: 90 });
    expect(result.map((s) => s.round)).toEqual([1, 2, 3]);
  });
});

describe('advanceInterval', () => {
  it('starting interval 0 records the anchor without closing a split', () => {
    expect(advanceInterval([], { intervalIndex: 0, atSeconds: 3 })).toEqual({
      roundSplits: [],
      intervalIndex: 0,
      intervalStartedAtSeconds: 3,
    });
  });

  it('closes the interval just finished as a round split', () => {
    const first = advanceInterval([], { intervalIndex: 0, atSeconds: 0 });
    const second = advanceInterval(first.roundSplits, {
      intervalIndex: 1,
      atSeconds: 60,
    });

    expect(second).toEqual({
      roundSplits: [{ round: 1, atSeconds: 60 }],
      intervalIndex: 1,
      intervalStartedAtSeconds: 60,
    });
  });

  it('records the last interval when the sequence runs out (index == count)', () => {
    const existing = [{ round: 1, atSeconds: 60 }];
    const result = advanceInterval(existing, {
      intervalIndex: 2,
      atSeconds: 120,
    });

    expect(result.roundSplits).toEqual([
      { round: 1, atSeconds: 60 },
      { round: 2, atSeconds: 120 },
    ]);
    expect(result.intervalIndex).toBe(2);
  });

  it('rewrites rather than duplicates a replayed rollover', () => {
    const existing = [{ round: 1, atSeconds: 60 }];
    const result = advanceInterval(existing, {
      intervalIndex: 1,
      atSeconds: 61,
    });

    expect(result.roundSplits).toEqual([{ round: 1, atSeconds: 61 }]);
  });
});

describe('snapshotMovements', () => {
  const resolved = {
    id: 'wm-1',
    order: 1,
    reps: 45,
    repScheme: [21, 15, 9],
    isSwapped: true,
    prescribedName: null,
    prescribedReason: null,
    exercise: {
      id: 'ex-ring',
      name: 'Ring row',
      unit: 'reps',
      movementGroup: 'pull',
      sortOrder: 1,
      // The rest of an Exercise row rides along on the resolved movement and
      // must not end up in the snapshot -- it describes the exercise in
      // general, not this day's training.
      instructions: 'Lean back, pull the rings to the chest.',
      equipment: [],
      fallbackExerciseId: 'ex-table',
    },
  };

  it('keeps what history needs and nothing else', () => {
    expect(snapshotMovements([resolved])).toEqual([
      {
        wodMovementId: 'wm-1',
        // A WOD day joins back to a WodMovement and has rounds rather than
        // sets, so the three straight-sets fields are absent facts (DN-20).
        planSlotMovementId: null,
        sets: null,
        restSeconds: null,
        order: 1,
        reps: 45,
        // A WOD is always the fixed shape (DN-142): a round of "as many as
        // you can" is a different format, not a rep count, and no WOD carries
        // one -- so these are written flat rather than left to a default.
        repsMax: null,
        toFailure: false,
        repScheme: [21, 15, 9],
        isSwapped: true,
        prescribedName: null,
        prescribedReason: null,
        exercise: {
          id: 'ex-ring',
          name: 'Ring row',
          unit: 'reps',
          movementGroup: 'pull',
          sortOrder: 1,
        },
      },
    ]);
  });

  it('orders by the movement order, whatever order the rows arrived in', () => {
    const first = { ...resolved, id: 'wm-0', order: 0 };
    expect(
      snapshotMovements([resolved, first]).map((m) => m.wodMovementId),
    ).toEqual(['wm-0', 'wm-1']);
  });

  // DN-88: what the library prescribed, where a remembered choice replaced it.
  // Snapshotted with the rest so history can still say what the day asked for
  // after the athlete's standing choice has moved on.
  it('keeps the prescription a remembered choice replaced', () => {
    const remembered = {
      ...resolved,
      isSwapped: false,
      prescribedName: 'Pull-up',
      prescribedReason: 'remembered_choice' as const,
    };
    const [snap] = snapshotMovements([remembered]);
    expect(snap.prescribedName).toBe('Pull-up');
    expect(snap.prescribedReason).toBe('remembered_choice');
  });

  // DN-79: and why, which history needs for the same reason the plate does --
  // "your pick" is a lie about a movement the app dropped for want of a bar.
  it('keeps why the equipment fallback replaced a movement', () => {
    const dropped = {
      ...resolved,
      isSwapped: false,
      prescribedName: 'Pull-up',
      prescribedReason: 'equipment' as const,
    };
    const [snap] = snapshotMovements([dropped]);
    expect(snap.prescribedName).toBe('Pull-up');
    expect(snap.prescribedReason).toBe('equipment');
  });

  it('copies the rep scheme rather than sharing the array', () => {
    const [snap] = snapshotMovements([resolved]);
    expect(snap.repScheme).not.toBe(resolved.repScheme);
  });
});

describe('snapshotPrescribedMovements', () => {
  const resolved = {
    id: 'psm-1',
    order: 1,
    sets: 5,
    reps: 3,
    repsMax: null,
    toFailure: false,
    restSeconds: 90,
    isSwapped: false,
    prescribedName: 'Chin-up',
    prescribedReason: 'equipment' as const,
    exercise: {
      id: 'ex-ring',
      name: 'Ring row',
      unit: 'reps',
      movementGroup: 'pull',
      sortOrder: 1,
      instructions: 'Lean back, pull the rings to the chest.',
      equipment: [],
      fallbackExerciseId: 'ex-table',
    },
  };

  it('joins back to the prescribed movement rather than a WOD one', () => {
    const [snapshot] = snapshotPrescribedMovements([resolved]);

    expect(snapshot.planSlotMovementId).toBe('psm-1');
    expect(snapshot.wodMovementId).toBeNull();
  });

  it('keeps the sets and the rest, which are what this day is', () => {
    const [snapshot] = snapshotPrescribedMovements([resolved]);

    expect(snapshot.sets).toBe(5);
    expect(snapshot.restSeconds).toBe(90);
    // One set's count, not the day's total: everything that reads a snapshot
    // asks what one set is, and 15 would be a number nobody was asked to do
    // in one go.
    expect(snapshot.reps).toBe(3);
  });

  it('records no group, because a prescribed movement has none', () => {
    // Empty rather than [3, 3, 3, 3, 3]: a repScheme means "the counts
    // descend as written", which five identical sets are not.
    expect(snapshotPrescribedMovements([resolved])[0].repScheme).toEqual([]);
  });

  it('keeps what equipment replaced, as a WOD snapshot does', () => {
    const [snapshot] = snapshotPrescribedMovements([resolved]);

    expect(snapshot.prescribedName).toBe('Chin-up');
    expect(snapshot.prescribedReason).toBe('equipment');
  });

  it('carries nothing of the Exercise row but what history needs', () => {
    expect(snapshotPrescribedMovements([resolved])[0].exercise).toEqual({
      id: 'ex-ring',
      name: 'Ring row',
      unit: 'reps',
      movementGroup: 'pull',
      sortOrder: 1,
    });
  });

  it('orders by the movement order, whatever order the rows arrived in', () => {
    // The count of completed sets indexes into this list, so the order is not
    // presentation -- a list built the other way round would resume the
    // athlete on the wrong movement.
    const first = { ...resolved, id: 'psm-0', order: 0 };

    expect(
      snapshotPrescribedMovements([resolved, first]).map(
        (m) => m.planSlotMovementId,
      ),
    ).toEqual(['psm-0', 'psm-1']);
  });
});
