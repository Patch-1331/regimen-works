import {
  assertSubstitutesReachable,
  assertSubstituteUnitsMatch,
  mismatchedSubstituteUnits,
  unreachableSubstitutes,
  type SubstitutableSeed,
} from './substitute-guard';

/**
 * The guard exists because the runtime cannot complain (DN-83). Every layer
 * that resolves a movement passes a gap through rather than throwing, so a
 * seed that names an unreachable substitute produces no error anywhere — just
 * an athlete holding a movement they own nothing for.
 *
 * These cases are written as the seed's own mistakes rather than as abstract
 * inputs: a movement with no alternative, a chain one step too long, a typo
 * in a name.
 */

const bodyweight: SubstitutableSeed = { name: 'Supermans' };

describe('unreachableSubstitutes', () => {
  it('passes a movement that needs nothing', () => {
    expect(unreachableSubstitutes([bodyweight])).toEqual([]);
  });

  it('passes an equipment movement that falls to bodyweight', () => {
    const seeds = [
      bodyweight,
      { name: 'Pull-up', equipment: ['bar'], fallback: 'Supermans' },
    ];
    expect(unreachableSubstitutes(seeds)).toEqual([]);
  });

  it('catches an equipment movement with no alternative at all', () => {
    const problems = unreachableSubstitutes([
      { name: 'Double-unders', equipment: ['jump_rope'] },
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('"Double-unders"');
    expect(problems[0]).toContain('no alternative');
  });

  it('catches an alternative that needs equipment of its own', () => {
    // The case the one-step rule makes dangerous: the chain would reach
    // bodyweight in two hops, and the scheduler only takes one.
    const problems = unreachableSubstitutes([
      bodyweight,
      {
        name: 'Goblet squat',
        equipment: ['kettlebell'],
        fallback: 'Box step-up',
      },
      { name: 'Box step-up', equipment: ['box'], fallback: 'Supermans' },
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('"Goblet squat"');
    expect(problems[0]).toContain('"Box step-up"');
    expect(problems[0]).toContain('box');
  });

  it('catches an alternative that is not a seeded exercise', () => {
    const problems = unreachableSubstitutes([
      {
        name: 'Kettlebell swing',
        equipment: ['kettlebell'],
        fallback: 'Hip hinge',
      },
    ]);
    expect(problems[0]).toContain('not a seeded exercise');
  });

  it('reports every gap, not just the first', () => {
    // A seeding PR adds a family at a time; finding the next gap by
    // re-running the seed is a slow way to read a list.
    const problems = unreachableSubstitutes([
      { name: 'Double-unders', equipment: ['jump_rope'] },
      { name: 'Single-unders', equipment: ['jump_rope'] },
    ]);
    expect(problems).toHaveLength(2);
  });

  it('does not ask a bodyweight movement for an alternative', () => {
    // Bodyweight is the absence of a tag (DN-77), so "needs nothing" and
    // "owns nothing" meet at the empty set — there is nothing to fall to and
    // nothing to fall from.
    expect(
      unreachableSubstitutes([{ name: 'Air squat', equipment: [] }]),
    ).toEqual([]);
  });
});

describe('assertSubstitutesReachable', () => {
  it('says nothing when the seed is sound', () => {
    expect(() =>
      assertSubstitutesReachable([
        bodyweight,
        { name: 'Pull-up', equipment: ['bar'], fallback: 'Supermans' },
      ]),
    ).not.toThrow();
  });

  it('names the count and every offender in one message', () => {
    expect(() =>
      assertSubstitutesReachable([
        { name: 'Double-unders', equipment: ['jump_rope'] },
        { name: 'Box jump', equipment: ['box'] },
      ]),
    ).toThrow(/2 equipment movement\(s\)[\s\S]*Double-unders[\s\S]*Box jump/);
  });
});

/**
 * The second way a fallback fails while looking fine (DN-113): it exists, it
 * needs nothing, and it is counted in the other unit. `WodMovement.reps`
 * carries over unchanged, so the substitution silently rewrites what the
 * number means.
 */
describe('mismatchedSubstituteUnits', () => {
  const plank: SubstitutableSeed = { name: 'Plank hold', unit: 'seconds' };

  it('passes a timed movement that falls to a timed one', () => {
    const seeds = [
      plank,
      {
        name: 'Farmer carry',
        equipment: ['dumbbell'],
        fallback: 'Plank hold',
        unit: 'seconds' as const,
      },
    ];
    expect(mismatchedSubstituteUnits(seeds)).toEqual([]);
  });

  it('catches a timed movement falling to a rep-counted one', () => {
    const problems = mismatchedSubstituteUnits([
      { name: 'Side plank' },
      {
        name: 'Suitcase carry',
        equipment: ['dumbbell'],
        fallback: 'Side plank',
        unit: 'seconds',
      },
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('"Suitcase carry"');
    expect(problems[0]).toContain('seconds');
    expect(problems[0]).toContain('reps');
  });

  it('catches the mismatch in the other direction too', () => {
    const problems = mismatchedSubstituteUnits([
      plank,
      { name: 'Dumbbell row', equipment: ['dumbbell'], fallback: 'Plank hold' },
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('"Dumbbell row"');
  });

  it('reads an unset unit as reps, the way the seed does', () => {
    // Most of the library omits the field entirely, so the two spellings of
    // "reps" have to compare equal or every untimed movement is an offender.
    const seeds = [
      { name: 'Push-up' },
      {
        name: 'Dumbbell floor press',
        equipment: ['dumbbell'],
        fallback: 'Push-up',
        unit: 'reps' as const,
      },
    ];
    expect(mismatchedSubstituteUnits(seeds)).toEqual([]);
  });

  it('leaves a missing alternative to the check that words it properly', () => {
    // Both faults at once on the same movement would otherwise be reported
    // twice, in two vocabularies, for one fix.
    const seeds: SubstitutableSeed[] = [
      { name: 'Farmer carry', equipment: ['dumbbell'], unit: 'seconds' },
      {
        name: 'Suitcase carry',
        equipment: ['dumbbell'],
        fallback: 'Nothing seeded',
        unit: 'seconds',
      },
    ];
    expect(mismatchedSubstituteUnits(seeds)).toEqual([]);
    expect(unreachableSubstitutes(seeds)).toHaveLength(2);
  });

  it('refuses the seed rather than writing a count that means something else', () => {
    expect(() =>
      assertSubstituteUnitsMatch([
        { name: 'Side plank' },
        {
          name: 'Suitcase carry',
          equipment: ['dumbbell'],
          fallback: 'Side plank',
          unit: 'seconds',
        },
      ]),
    ).toThrow(/different unit/);
  });

  it('lets a seed whose units movementGroup up through', () => {
    expect(() =>
      assertSubstituteUnitsMatch([
        plank,
        {
          name: 'Farmer carry',
          equipment: ['dumbbell'],
          fallback: 'Plank hold',
          unit: 'seconds',
        },
      ]),
    ).not.toThrow();
  });
});
