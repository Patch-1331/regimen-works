/**
 * The seed-time check that every movement needing equipment can still be
 * performed by an athlete who owns none (DN-83).
 *
 * Every runtime layer here degrades quietly rather than throwing, and each
 * says why in the same words: the athlete is about to train, so a data gap
 * must not leave a hole in the movement list. `applyRememberedChoice` passes
 * a movement through when no exercise sits at that rung, `applySubstitutions`
 * when the substitute is missing, and `applyEquipmentAvailability` when there
 * is no alternative to fall to.
 *
 * That is right at runtime, and it means a missing substitute is invisible in
 * production: the athlete is simply handed a movement they cannot do, and
 * nothing anywhere reports it. The only place the gap can be caught is where
 * the data is written, which is here.
 *
 * The seed runs at deploy time, not in CI, so a gap in the real `exercises`
 * array surfaces on a deploy rather than on the PR that wrote it — the array
 * cannot be imported by a spec while it lives inside a self-executing
 * `seed.ts`. That is DN-112.
 */

/** The fields of a seeded exercise this check reads. */
export type SubstitutableSeed = {
  name: string;
  equipment?: string[];
  alt?: string;
};

/**
 * Why "owns nothing" and not "owns the baseline".
 *
 * `DEFAULT_EQUIPMENT` is `['bar']`, but that is what an athlete owns before
 * they have said anything — not a floor. `SettingsService.update` takes an
 * empty array as a real answer ("I own nothing") and stores it as one, so an
 * athlete who owns no bar is a state the app can actually be in. An
 * alternative tagged with equipment is therefore not a guaranteed way out,
 * and the only tag set that is, is none.
 */
function requirements(exercise: SubstitutableSeed): string[] {
  return exercise.equipment ?? [];
}

/**
 * Every way the seed's equipment fallbacks fail to be a way out, in the words
 * a person fixing the seed needs.
 *
 * **One step down the chain, not a walk**, matching what
 * `applyEquipmentAvailability` does at runtime: it takes the substitute as
 * given rather than re-checking it against what the athlete owns. An
 * assertion that followed a chain the scheduler will not follow would pass
 * seeds the app then mishandles, which is worse than no assertion.
 *
 * Returns all of them rather than throwing on the first, because these
 * arrive in batches -- a seeding PR adds a family of movements at once, and
 * finding the next gap by re-running the seed is a slow way to read a list.
 */
export function unreachableSubstitutes(
  exercises: readonly SubstitutableSeed[],
): string[] {
  const byName = new Map(exercises.map((e) => [e.name, e]));

  return exercises.flatMap((exercise) => {
    const needs = requirements(exercise);
    if (needs.length === 0) return [];

    if (!exercise.alt) {
      return [
        `"${exercise.name}" needs ${needs.join(', ')} and has no alternative — an athlete without it gets a movement they cannot do.`,
      ];
    }

    const alt = byName.get(exercise.alt);
    if (!alt) {
      return [
        `"${exercise.name}" names "${exercise.alt}" as its alternative, which is not a seeded exercise.`,
      ];
    }

    const altNeeds = requirements(alt);
    if (altNeeds.length > 0) {
      return [
        `"${exercise.name}" falls back to "${alt.name}", which itself needs ${altNeeds.join(', ')} — the fallback is one step, so this is where it stops.`,
      ];
    }

    return [];
  });
}

/**
 * Fails the seed, loudly and before anything is written, when any equipment
 * movement has no way down to bodyweight.
 */
export function assertSubstitutesReachable(
  exercises: readonly SubstitutableSeed[],
): void {
  const problems = unreachableSubstitutes(exercises);
  if (problems.length === 0) return;

  throw new Error(
    [
      `Seed refused: ${problems.length} equipment movement(s) have no bodyweight way out.`,
      ...problems.map((p) => `  - ${p}`),
    ].join('\n'),
  );
}
