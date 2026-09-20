import {
  buildEnrollmentSummary,
  rungChangesOver,
  rungKey,
  type RungNames,
} from './enrollment-summary.logic';
import type { RungSnapshot } from '@regimen-works/shared';

/**
 * What a finished program has to show for itself (DN-18).
 *
 * The ladder here is deliberately small and named the way the design's card
 * reads -- "pull: negative → chin-up" -- so an assertion is a sentence an
 * athlete could be shown rather than a pair of numbers.
 */
const LADDER: [string, number, string][] = [
  ['pull', 0, 'Negative chin-up'],
  ['pull', 1, 'Band-assisted chin-up'],
  ['pull', 2, 'Chin-up'],
  ['squat', 0, 'Box squat'],
  ['squat', 1, 'Air squat'],
  ['hinge', 0, 'Glute bridge'],
];

const NAMES: RungNames = new Map(
  LADDER.map(([line, rung, name]) => [rungKey(line, rung), name]),
);

const current = (rungs: Record<string, number>) =>
  new Map(Object.entries(rungs));

describe('rungKey', () => {
  it('keys a name by its line and rung', () => {
    expect(rungKey('pull', 2)).toBe('pull:2');
  });
});

describe('rungChangesOver', () => {
  it('reports a line that moved up, with both names', () => {
    expect(rungChangesOver({ pull: 0 }, current({ pull: 2 }), NAMES)).toEqual([
      {
        line: 'pull',
        fromRung: 0,
        toRung: 2,
        fromName: 'Negative chin-up',
        toName: 'Chin-up',
      },
    ]);
  });

  it('reports a line that moved down', () => {
    // A deload, or an over-ambitious first guess corrected. Hiding it would
    // make the card flattering rather than accurate.
    const [change] = rungChangesOver({ pull: 2 }, current({ pull: 1 }), NAMES);
    expect(change).toMatchObject({ fromRung: 2, toRung: 1 });
  });

  it('says nothing about a line that did not move', () => {
    expect(rungChangesOver({ pull: 1 }, current({ pull: 1 }), NAMES)).toEqual(
      [],
    );
  });

  it('treats a line the athlete never had as rung 0', () => {
    // The ordinary case for a first program: DN-86 stopped provisioning a
    // SkillLevel per line, so the snapshot is empty and the athlete's first
    // ever choice is a move from the bottom of the ladder.
    expect(rungChangesOver({}, current({ pull: 2 }), NAMES)).toEqual([
      {
        line: 'pull',
        fromRung: 0,
        toRung: 2,
        fromName: 'Negative chin-up',
        toName: 'Chin-up',
      },
    ]);
  });

  it('says nothing when an untrained line is still at the bottom', () => {
    // Absent on both sides is 0 → 0, which is not a change. Without this the
    // card would congratulate every athlete on every line they never touched.
    expect(rungChangesOver({}, current({}), NAMES)).toEqual([]);
  });

  it('reports every line that moved, in a stable order', () => {
    const changes = rungChangesOver(
      { pull: 0, squat: 0 },
      current({ pull: 1, squat: 1 }),
      NAMES,
    );
    expect(changes.map((c) => c.line)).toEqual(['pull', 'squat']);
  });

  it('orders by line rather than by the order the rungs arrived in', () => {
    const changes = rungChangesOver(
      { squat: 0, pull: 0 },
      current({ squat: 1, pull: 1 }),
      NAMES,
    );
    expect(changes.map((c) => c.line)).toEqual(['pull', 'squat']);
  });

  it('leaves out a line whose new rung has no exercise to name it', () => {
    // A library hole. Better an unmentioned line than "pull: negative → ".
    expect(rungChangesOver({ pull: 0 }, current({ pull: 9 }), NAMES)).toEqual(
      [],
    );
  });

  it('leaves out a line whose old rung has no exercise to name it', () => {
    expect(rungChangesOver({ pull: 9 }, current({ pull: 0 }), NAMES)).toEqual(
      [],
    );
  });

  it('ignores a key that is not a progression line', () => {
    // The snapshot is jsonb and `SkillLevel.line` is a text column, so both
    // sides can hold a line the app no longer has. Named at both ends here on
    // purpose: the name check would hide an unnamed one, and it is the enum
    // that has to refuse this. A change the schema cannot parse would fail
    // the write that stores the summary, on the one request an athlete makes
    // the day their program ends.
    const named: RungNames = new Map([
      ...NAMES,
      [rungKey('sorcery', 0), 'Wand'],
      [rungKey('sorcery', 3), 'Staff'],
    ]);
    const snapshot = { pull: 0, sorcery: 0 } as unknown as RungSnapshot;
    const changes = rungChangesOver(
      snapshot,
      current({ pull: 1, sorcery: 3 }),
      named,
    );
    expect(changes.map((c) => c.line)).toEqual(['pull']);
  });
});

describe('buildEnrollmentSummary', () => {
  const base = {
    weeks: 6,
    sessions: 24,
    startingRungs: { pull: 0 } as RungSnapshot,
    currentRungs: current({ pull: 2 }),
    names: NAMES,
  };

  it('carries the length and the session count', () => {
    const summary = buildEnrollmentSummary(base);
    expect(summary.weeks).toBe(6);
    expect(summary.sessions).toBe(24);
  });

  it('carries what moved', () => {
    expect(buildEnrollmentSummary(base).rungChanges).toHaveLength(1);
  });

  it('reads sensibly for a program nobody trained', () => {
    // Enrolled, never opened, weeks ran out. Still a finished run, and the
    // card has to say so rather than break on it.
    const summary = buildEnrollmentSummary({
      ...base,
      sessions: 0,
      startingRungs: {},
      currentRungs: current({}),
    });
    expect(summary).toEqual({ weeks: 6, sessions: 0, rungChanges: [] });
  });

  it('keeps a null length null', () => {
    // An open-ended run that was ended some other way: there was never a
    // number of weeks to report, and 0 would be a different claim.
    expect(buildEnrollmentSummary({ ...base, weeks: null }).weeks).toBeNull();
  });
});
