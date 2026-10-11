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
    phase: 'warmup',
    instructions: [
      'Arms out at shoulder height, small circles forward then back.',
    ],
  };
  const legSwings: ExerciseForChecklist = {
    id: '2',
    name: 'Leg swings',
    pattern: 'hinge',
    phase: 'warmup',
    instructions: [
      'Hold a wall, swing one leg front to back, then side to side.',
    ],
  };
  const jogging: ExerciseForChecklist = {
    id: '3',
    name: 'Light jogging in place',
    pattern: null,
    phase: 'warmup',
    instructions: ['Easy jog on the spot, feet barely leaving the floor.'],
  };
  const catCow: ExerciseForChecklist = {
    id: '4',
    name: 'Cat-cow',
    pattern: 'core',
    phase: 'cooldown',
    instructions: [
      'On hands and knees, alternate arching and rounding the spine.',
    ],
  };
  const pushUp: ExerciseForChecklist = {
    id: '5',
    name: 'Push-up',
    pattern: 'push',
    phase: null, // regular pool exercise, not checklist content
    instructions: [
      'Plank position, lower until the chest grazes the floor, press back up.',
    ],
  };

  const pool = [armCircles, legSwings, jogging, catCow, pushUp];

  it('only considers exercises tagged with the requested phase', () => {
    const result = buildChecklist(pool, 'warmup', 'hinge', 4);
    expect(result).not.toContainEqual(catCow);
    expect(result).not.toContainEqual(pushUp);
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

  it('returns an empty list when the pool has nothing for that phase', () => {
    expect(buildChecklist([pushUp], 'warmup', 'push', 4)).toEqual([]);
  });

  it('buildWarmupChecklist and buildCooldownChecklist delegate to the right phase', () => {
    expect(buildWarmupChecklist(pool, 'push')).toEqual(
      buildChecklist(pool, 'warmup', 'push'),
    );
    expect(buildCooldownChecklist(pool, 'core')).toEqual(
      buildChecklist(pool, 'cooldown', 'core'),
    );
  });
});
