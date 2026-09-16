import { exercises } from '../../prisma/exercise-seed';
import { unreachableSubstitutes } from './substitute-guard';

/**
 * The guard (DN-83) run against the library that actually ships, rather than
 * against hand-written stand-ins (DN-112).
 *
 * `substitute-guard.spec.ts` pins what the rule *is*; this pins that the seed
 * obeys it. Until the array was extracted from `seed.ts` this could not be
 * written at all, so the only thing that ever checked the real data was a
 * deploy — a seeding PR could go green and fail at release.
 */

describe('the seeded exercise library', () => {
  it('gives every equipment movement a one-step fall to bodyweight', () => {
    // Failure prints the offenders, so the message is the fix: which movement,
    // what it needs, and where its fallback stops short.
    expect(unreachableSubstitutes(exercises)).toEqual([]);
  });

  it('is actually being read — the guard is not passing an empty list', () => {
    // Without this, deleting the import above would leave a green test that
    // asserts nothing about anything.
    expect(exercises.length).toBeGreaterThan(40);
    expect(exercises.some((e) => (e.equipment ?? []).length > 0)).toBe(true);
  });
});
