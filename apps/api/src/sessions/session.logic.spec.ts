import {
  advanceInterval,
  mergeRoundSplit,
  snapshotMovements,
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
    exercise: {
      id: 'ex-ring',
      name: 'Ring row',
      unit: 'reps',
      line: 'pull',
      rung: 1,
      // The rest of an Exercise row rides along on the resolved movement and
      // must not end up in the snapshot -- it describes the exercise in
      // general, not this day's training.
      instructions: 'Lean back, pull the rings to the chest.',
      needsBar: false,
      altExerciseId: 'ex-table',
    },
  };

  it('keeps what history needs and nothing else', () => {
    expect(snapshotMovements([resolved])).toEqual([
      {
        wodMovementId: 'wm-1',
        order: 1,
        reps: 45,
        repScheme: [21, 15, 9],
        isSwapped: true,
        prescribedName: null,
        exercise: {
          id: 'ex-ring',
          name: 'Ring row',
          unit: 'reps',
          line: 'pull',
          rung: 1,
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
    };
    const [snap] = snapshotMovements([remembered]);
    expect(snap.prescribedName).toBe('Pull-up');
  });

  it('copies the rep scheme rather than sharing the array', () => {
    const [snap] = snapshotMovements([resolved]);
    expect(snap.repScheme).not.toBe(resolved.repScheme);
  });
});
