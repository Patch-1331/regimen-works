import {
  buildChecklist,
  buildCooldownChecklist,
  buildWarmupChecklist,
  ExerciseForChecklist,
} from './checklist.logic';

describe('buildChecklist', () => {
  const armCircles: ExerciseForChecklist = {
    id: '1',
    name: 'Arm circles',
    pattern: 'push',
    kind: 'warmup',
    instructions: [
      'Arms out at shoulder height, small circles forward then back.',
    ],
  };
  const legSwings: ExerciseForChecklist = {
    id: '2',
    name: 'Leg swings',
    pattern: 'hinge',
    kind: 'warmup',
    instructions: [
      'Hold a wall, swing one leg front to back, then side to side.',
    ],
  };
  const jogging: ExerciseForChecklist = {
    id: '3',
    name: 'Light jogging in place',
    pattern: null,
    kind: 'warmup',
    instructions: ['Easy jog on the spot, feet barely leaving the floor.'],
  };
  const catCow: ExerciseForChecklist = {
    id: '4',
    name: 'Cat-cow',
    pattern: 'core',
    kind: 'cooldown',
    instructions: [
      'On hands and knees, alternate arching and rounding the spine.',
    ],
  };
  const chestStretch: ExerciseForChecklist = {
    id: '5',
    name: 'Doorway chest stretch',
    pattern: 'push',
    kind: 'cooldown',
    instructions: [
      'Forearm on a doorframe, step through until the chest opens.',
    ],
  };

  const pool = [armCircles, legSwings, jogging, catCow, chestStretch];

  it('only considers entries on the requested checklist', () => {
    const result = buildChecklist(pool, 'warmup', 'push', 4);
    expect(result).not.toContainEqual(catCow);
    expect(result).not.toContainEqual(chestStretch);
  });

  it('lets one exercise be on both checklists, each under its own entry', () => {
    // An entry, not the exercise, says which list it is on (DN-172), so the
    // same movement can open a session and close it.
    const rehearsal: ExerciseForChecklist = {
      ...armCircles,
      kind: 'cooldown',
      instructions: ['Slow, wide circles to let the shoulders settle.'],
    };
    const both = [armCircles, rehearsal];

    expect(buildChecklist(both, 'warmup', 'push', 4)).toEqual([armCircles]);
    expect(buildChecklist(both, 'cooldown', 'push', 4)).toEqual([rehearsal]);
  });

  it('puts pattern-matching exercises ahead of generic filler', () => {
    const result = buildChecklist(pool, 'warmup', 'push', 4);
    expect(result[0]).toEqual(armCircles);
  });

  it('falls back to pattern: null exercises to fill out the target count', () => {
    const result = buildChecklist(pool, 'warmup', 'push', 4);
    expect(result).toEqual([armCircles, jogging]);
  });

  it('does not include exercises tagged with an unrelated pattern', () => {
    // legSwings is tagged "hinge" — irrelevant when the WOD's dominant
    // pattern is "push", so it's skipped in favor of the generic filler.
    const result = buildChecklist(pool, 'warmup', 'push', 4);
    expect(result).not.toContainEqual(legSwings);
  });

  it('caps the result at targetCount', () => {
    const result = buildChecklist(pool, 'warmup', 'hinge', 1);
    expect(result).toHaveLength(1);
    expect(result).toEqual([legSwings]);
  });

  it('returns an empty list when the pool has nothing on that checklist', () => {
    expect(buildChecklist([chestStretch], 'warmup', 'push', 4)).toEqual([]);
  });

  it('buildWarmupChecklist and buildCooldownChecklist delegate to the right checklist', () => {
    expect(buildWarmupChecklist(pool, 'push')).toEqual(
      buildChecklist(pool, 'warmup', 'push'),
    );
    expect(buildCooldownChecklist(pool, 'core')).toEqual(
      buildChecklist(pool, 'cooldown', 'core'),
    );
  });
});
