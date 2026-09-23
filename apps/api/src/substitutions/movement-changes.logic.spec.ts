import {
  proposeMovementChanges,
  TrainedMovement,
} from './movement-changes.logic';

/**
 * The offer made on the completion screen. It exists because a swap applies
 * to today only — this is what turns one day's choice into the athlete's
 * standing one, and it asks rather than assumes.
 */

const chinUp: TrainedMovement = {
  movementGroup: 'pull',
  exerciseId: 'chin-up',
  exerciseName: 'Chin-up',
};
const negative: TrainedMovement = {
  movementGroup: 'pull',
  exerciseId: 'negative',
  exerciseName: 'Negative chin-up',
};
const pushUp: TrainedMovement = {
  movementGroup: 'push_horizontal',
  exerciseId: 'push-up',
  exerciseName: 'Push-up',
};

/** What is on record, in the shape the service reads out of `SkillLevel`. */
const onRecord = (entries: Record<string, [string, string]>) =>
  new Map(
    Object.entries(entries).map(([group, [exerciseId, exerciseName]]) => [
      group,
      { exerciseId, exerciseName },
    ]),
  );

describe('proposeMovementChanges', () => {
  it('offers the movement the athlete actually trained', () => {
    const proposals = proposeMovementChanges(
      [chinUp],
      onRecord({ pull: ['negative', 'Negative chin-up'] }),
    );
    expect(proposals).toEqual([
      {
        movementGroup: 'pull',
        fromExerciseId: 'negative',
        fromExerciseName: 'Negative chin-up',
        toExerciseId: 'chin-up',
        toExerciseName: 'Chin-up',
      },
    ]);
  });

  it('says nothing when the movement trained is already the one on record', () => {
    expect(
      proposeMovementChanges(
        [chinUp],
        onRecord({ pull: ['chin-up', 'Chin-up'] }),
      ),
    ).toEqual([]);
  });

  it('offers an easier movement, because the athlete chose it', () => {
    // Swapping to something easier is a choice like any other. Confirming it
    // is the athlete's call — what the app never does is change it on its own.
    const proposals = proposeMovementChanges(
      [negative],
      onRecord({ pull: ['chin-up', 'Chin-up'] }),
    );
    expect(proposals).toEqual([
      expect.objectContaining({
        fromExerciseId: 'chin-up',
        toExerciseId: 'negative',
      }),
    ]);
  });

  // DN-88. Two pull movements swapped differently in one session. This used
  // to take the higher rung — "someone who did both chin-ups and negatives did
  // chin-ups" — which is an inference about ability. The app has no way to
  // know which they meant to keep, so it takes the one they reached for last.
  // Since DN-139 there is no ordering it could prefer along even if it wanted
  // to: the group's members are a set.
  it('asks once per group, taking the choice made most recently', () => {
    const proposals = proposeMovementChanges(
      [negative, chinUp],
      onRecord({ pull: ['pull-up', 'Pull-up'] }),
    );
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ toExerciseId: 'chin-up' });
  });

  it('takes the later choice even when it is the easier movement', () => {
    const proposals = proposeMovementChanges(
      [chinUp, negative],
      onRecord({ pull: ['pull-up', 'Pull-up'] }),
    );
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ toExerciseId: 'negative' });
  });

  // DN-86. This used to propose nothing, which made sense only while everyone
  // was provisioned onto a starting movement — with no provisioning, every
  // group looks like this on a new athlete's first session, and the first
  // choice is the one most worth remembering.
  it('proposes a group with no choice on record, as a change from null', () => {
    const proposals = proposeMovementChanges([chinUp], new Map());
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({
      movementGroup: 'pull',
      fromExerciseId: null,
      fromExerciseName: null,
      toExerciseId: 'chin-up',
    });
  });

  it('handles several groups in one session', () => {
    const proposals = proposeMovementChanges(
      [chinUp, pushUp],
      onRecord({
        pull: ['negative', 'Negative chin-up'],
        push_horizontal: ['knee-push-up', 'Knee push-up'],
      }),
    );
    expect(proposals.map((p) => p.movementGroup)).toEqual([
      'pull',
      'push_horizontal',
    ]);
  });

  it('returns a stable order, so the card does not reshuffle', () => {
    const levels = onRecord({
      pull: ['negative', 'Negative chin-up'],
      push_horizontal: ['knee-push-up', 'Knee push-up'],
    });
    const one = proposeMovementChanges([chinUp, pushUp], levels);
    const two = proposeMovementChanges([pushUp, chinUp], levels);
    expect(one).toEqual(two);
  });

  it('proposes nothing when nothing was swapped', () => {
    expect(
      proposeMovementChanges(
        [],
        onRecord({ pull: ['negative', 'Negative chin-up'] }),
      ),
    ).toEqual([]);
  });
});
