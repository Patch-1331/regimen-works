import { progressionLine } from '@regimen-works/shared';
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

  it('puts every movement on a line the rest of the app knows', () => {
    // `ExerciseSeed.line` is a bare string, so a typo here reaches the
    // database and then the athlete: the row lands on a line nothing else
    // recognises, `SkillLevelsService` refuses to write a choice for it, and
    // the Stats panel labels it with the raw slug. Adding a real line means
    // adding it to the enum too (DN-84 added squat_loaded and hinge_loaded);
    // this is what says so out loud.
    const lines = [...new Set(exercises.map((e) => e.line).filter(Boolean))];
    const unknown = lines.filter(
      (line) => !progressionLine.safeParse(line).success,
    );
    expect(unknown).toEqual([]);
  });

  it('numbers each line from zero with no gaps and no ties', () => {
    // `applyRememberedChoice` looks an exercise up by (line, rung), so a
    // duplicate rung makes which movement an athlete gets depend on row
    // order, and a gap makes a stored rung resolve to nothing at all.
    const byLine = new Map<string, number[]>();
    for (const e of exercises) {
      if (!e.line || e.rung === undefined) continue;
      byLine.set(e.line, [...(byLine.get(e.line) ?? []), e.rung]);
    }

    for (const [line, rungs] of byLine) {
      const sorted = [...rungs].sort((a, b) => a - b);
      expect({ line, rungs: sorted }).toEqual({
        line,
        rungs: sorted.map((_, i) => i),
      });
    }
  });

  it('is actually being read — the guard is not passing an empty list', () => {
    // Without this, deleting the import above would leave a green test that
    // asserts nothing about anything.
    expect(exercises.length).toBeGreaterThan(40);
    expect(exercises.some((e) => (e.equipment ?? []).length > 0)).toBe(true);
  });
});
