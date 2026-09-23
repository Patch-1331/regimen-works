import {
  buildEnrollmentSummary,
  movementChangesOver,
  type MovementNames,
} from './enrollment-summary.logic';
import type { MovementSnapshot } from '@regimen-works/shared';

/**
 * What a finished program has to show for itself (DN-18).
 *
 * The movements here are deliberately few and named the way the design's card
 * reads -- "pull: negative → chin-up" -- so an assertion is a sentence an
 * athlete could be shown rather than a pair of ids.
 */
const NAMES: MovementNames = new Map([
  ['negative', 'Negative chin-up'],
  ['banded', 'Band-assisted chin-up'],
  ['chin-up', 'Chin-up'],
  ['box-squat', 'Box squat'],
  ['air-squat', 'Air squat'],
  ['glute-bridge', 'Glute bridge'],
]);

const current = (movements: Record<string, string>) =>
  new Map(Object.entries(movements));

describe('movementChangesOver', () => {
  it('reports a group that moved, with both names', () => {
    expect(
      movementChangesOver(
        { pull: 'negative' },
        current({ pull: 'chin-up' }),
        NAMES,
      ),
    ).toEqual([
      {
        movementGroup: 'pull',
        fromExerciseId: 'negative',
        fromName: 'Negative chin-up',
        toExerciseId: 'chin-up',
        toName: 'Chin-up',
      },
    ]);
  });

  it('reports a move to an easier movement the same way', () => {
    // A deload, or an over-ambitious first guess corrected. There is no
    // direction here to hide (DN-88): the card reports what changed, not
    // whether it improved.
    const [change] = movementChangesOver(
      { pull: 'chin-up' },
      current({ pull: 'banded' }),
      NAMES,
    );
    expect(change).toMatchObject({
      fromExerciseId: 'chin-up',
      toExerciseId: 'banded',
    });
  });

  it('says nothing about a group that did not move', () => {
    expect(
      movementChangesOver(
        { pull: 'banded' },
        current({ pull: 'banded' }),
        NAMES,
      ),
    ).toEqual([]);
  });

  // DN-139. This used to read an absent choice as rung 0 and report the
  // athlete as having climbed off a movement they were never shown.
  it('reports a group the athlete had not chosen in as a move from nothing', () => {
    // The ordinary case for a first program: DN-86 stopped provisioning a
    // SkillLevel per group, so the snapshot is empty. What they were handed
    // meanwhile is the group's default, which they did not pick and which is
    // therefore not what they moved from (ADR-0004 decision 8).
    expect(
      movementChangesOver({}, current({ pull: 'chin-up' }), NAMES),
    ).toEqual([
      {
        movementGroup: 'pull',
        fromExerciseId: null,
        fromName: null,
        toExerciseId: 'chin-up',
        toName: 'Chin-up',
      },
    ]);
  });

  it('says nothing about a group the athlete never chose in at all', () => {
    // Absent on both sides is not a change. Without this the card would
    // congratulate every athlete on every group they never touched.
    expect(movementChangesOver({}, current({}), NAMES)).toEqual([]);
  });

  it('says nothing about a group whose choice was cleared', () => {
    // No destination to name, so there is no sentence to write.
    expect(
      movementChangesOver({ pull: 'negative' }, current({}), NAMES),
    ).toEqual([]);
  });

  it('reports every group that moved, in a stable order', () => {
    const changes = movementChangesOver(
      { pull: 'negative', squat: 'box-squat' },
      current({ pull: 'banded', squat: 'air-squat' }),
      NAMES,
    );
    expect(changes.map((c) => c.movementGroup)).toEqual(['pull', 'squat']);
  });

  it('orders by group rather than by the order the entries arrived in', () => {
    const changes = movementChangesOver(
      { squat: 'box-squat', pull: 'negative' },
      current({ squat: 'air-squat', pull: 'banded' }),
      NAMES,
    );
    expect(changes.map((c) => c.movementGroup)).toEqual(['pull', 'squat']);
  });

  it('leaves out a group whose new movement cannot be named', () => {
    // A hard-deleted row. Better an unmentioned group than "pull: negative → ".
    expect(
      movementChangesOver(
        { pull: 'negative' },
        current({ pull: 'gone' }),
        NAMES,
      ),
    ).toEqual([]);
  });

  it('leaves out a group whose old movement cannot be named', () => {
    // Deliberately not reported as a move from null: telling the athlete they
    // started from scratch when they did not is worse than saying nothing.
    expect(
      movementChangesOver(
        { pull: 'gone' },
        current({ pull: 'chin-up' }),
        NAMES,
      ),
    ).toEqual([]);
  });

  it('ignores a key that is not a movement group', () => {
    // The snapshot is jsonb and `SkillLevel.movementGroup` is a text column,
    // so both sides can hold a group the app no longer has. Named at both ends
    // here on purpose: the name check would hide an unnamed one, and it is the
    // enum that has to refuse this. A change the schema cannot parse would
    // fail the write that stores the summary, on the one request an athlete
    // makes the day their program ends.
    const named: MovementNames = new Map([
      ...NAMES,
      ['wand', 'Wand'],
      ['staff', 'Staff'],
    ]);
    const snapshot = {
      pull: 'negative',
      sorcery: 'wand',
    } as unknown as MovementSnapshot;
    const changes = movementChangesOver(
      snapshot,
      current({ pull: 'chin-up', sorcery: 'staff' }),
      named,
    );
    expect(changes.map((c) => c.movementGroup)).toEqual(['pull']);
  });
});

describe('buildEnrollmentSummary', () => {
  const base = {
    weeks: 6,
    sessions: 24,
    startingMovements: { pull: 'negative' } as MovementSnapshot,
    currentMovements: current({ pull: 'chin-up' }),
    names: NAMES,
  };

  it('carries the length and the session count', () => {
    const summary = buildEnrollmentSummary(base);
    expect(summary.weeks).toBe(6);
    expect(summary.sessions).toBe(24);
  });

  it('carries what moved', () => {
    expect(buildEnrollmentSummary(base).movementChanges).toHaveLength(1);
  });

  it('reads sensibly for a program nobody trained', () => {
    // Enrolled, never opened, weeks ran out. Still a finished run, and the
    // card has to say so rather than break on it.
    const summary = buildEnrollmentSummary({
      ...base,
      sessions: 0,
      startingMovements: {},
      currentMovements: current({}),
    });
    expect(summary).toEqual({ weeks: 6, sessions: 0, movementChanges: [] });
  });

  it('keeps a null length null', () => {
    // An open-ended run that was ended some other way: there was never a
    // number of weeks to report, and 0 would be a different claim.
    expect(buildEnrollmentSummary({ ...base, weeks: null }).weeks).toBeNull();
  });
});
