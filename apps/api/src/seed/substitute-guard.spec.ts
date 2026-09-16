import {
  assertSubstitutesReachable,
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
      { name: 'Pull-up', equipment: ['bar'], alt: 'Supermans' },
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
      { name: 'Goblet squat', equipment: ['kettlebell'], alt: 'Box step-up' },
      { name: 'Box step-up', equipment: ['box'], alt: 'Supermans' },
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('"Goblet squat"');
    expect(problems[0]).toContain('"Box step-up"');
    expect(problems[0]).toContain('box');
  });

  it('catches an alternative that is not a seeded exercise', () => {
    const problems = unreachableSubstitutes([
      { name: 'Kettlebell swing', equipment: ['kettlebell'], alt: 'Hip hinge' },
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
        { name: 'Pull-up', equipment: ['bar'], alt: 'Supermans' },
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
