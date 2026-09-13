import { proposeRungChanges, TrainedRung } from './rung-changes.logic';

/**
 * The offer made on the completion screen. It exists because a swap applies
 * to today only — this is what turns one day's choice into the athlete's
 * standing level, and it asks rather than assumes.
 */

const chinUp: TrainedRung = {
  line: 'pull',
  rung: 2,
  exerciseId: 'chin-up',
  exerciseName: 'Chin-up',
};
const negative: TrainedRung = {
  line: 'pull',
  rung: 1,
  exerciseId: 'negative',
  exerciseName: 'Negative chin-up',
};
const pushUp: TrainedRung = {
  line: 'push_horizontal',
  rung: 1,
  exerciseId: 'push-up',
  exerciseName: 'Push-up',
};

describe('proposeRungChanges', () => {
  it('offers the rung the athlete actually trained', () => {
    const proposals = proposeRungChanges([chinUp], new Map([['pull', 0]]));
    expect(proposals).toEqual([
      {
        line: 'pull',
        fromRung: 0,
        toRung: 2,
        exerciseId: 'chin-up',
        exerciseName: 'Chin-up',
      },
    ]);
  });

  it('says nothing when the rung trained is already the one on record', () => {
    expect(proposeRungChanges([chinUp], new Map([['pull', 2]]))).toEqual([]);
  });

  it('offers a move down, because the athlete chose it', () => {
    // Swapping down is how struggling is answered. Confirming it is the
    // athlete's call — what the app never does is lower anyone on its own.
    const proposals = proposeRungChanges([negative], new Map([['pull', 3]]));
    expect(proposals).toEqual([
      expect.objectContaining({ fromRung: 3, toRung: 1 }),
    ]);
  });

  it('asks once per line, taking the highest rung trained', () => {
    // Two pull movements swapped differently. Recording the easier one would
    // propose a demotion off a session that demonstrated the opposite.
    const proposals = proposeRungChanges(
      [negative, chinUp],
      new Map([['pull', 0]]),
    );
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ toRung: 2, exerciseId: 'chin-up' });
  });

  it('is not fooled by the order the movements arrive in', () => {
    const proposals = proposeRungChanges(
      [chinUp, negative],
      new Map([['pull', 0]]),
    );
    expect(proposals[0]).toMatchObject({ toRung: 2 });
  });

  // DN-86. This used to propose nothing, which made sense only while everyone
  // was provisioned at rung 0 — with no provisioning, every line looks like
  // this on a new athlete's first session, and the first choice is the one
  // most worth remembering.
  it('proposes a line with no rung on record, as a change from null', () => {
    const proposals = proposeRungChanges([chinUp], new Map());
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({
      line: 'pull',
      fromRung: null,
      toRung: 2,
    });
  });

  it('handles several lines in one session', () => {
    const proposals = proposeRungChanges(
      [chinUp, pushUp],
      new Map([
        ['pull', 0],
        ['push_horizontal', 0],
      ]),
    );
    expect(proposals.map((p) => p.line)).toEqual(['pull', 'push_horizontal']);
  });

  it('returns a stable order, so the card does not reshuffle', () => {
    const levels = new Map([
      ['pull', 0],
      ['push_horizontal', 0],
    ]);
    const one = proposeRungChanges([chinUp, pushUp], levels);
    const two = proposeRungChanges([pushUp, chinUp], levels);
    expect(one).toEqual(two);
  });

  it('proposes nothing when nothing was swapped', () => {
    expect(proposeRungChanges([], new Map([['pull', 0]]))).toEqual([]);
  });
});
