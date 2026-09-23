/**
 * The seed-time check that every movement needing equipment can still be
 * performed by an athlete who owns none (DN-83).
 *
 * Every runtime layer here degrades quietly rather than throwing, and each
 * says why in the same words: the athlete is about to train, so a data gap
 * must not leave a hole in the movement list. `applyRememberedChoice` passes
 * a movement through when its group has no member to resolve to,
 * `applySubstitutions`
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

/** The fields of a seeded exercise these checks read. */
export type SubstitutableSeed = {
  name: string;
  equipment?: string[];
  fallback?: string;
  /** Defaults to reps, as it does in the seed itself. */
  unit?: 'reps' | 'seconds';
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

    if (!exercise.fallback) {
      return [
        `"${exercise.name}" needs ${needs.join(', ')} and has no alternative — an athlete without it gets a movement they cannot do.`,
      ];
    }

    const fallback = byName.get(exercise.fallback);
    if (!fallback) {
      return [
        `"${exercise.name}" names "${exercise.fallback}" as its alternative, which is not a seeded exercise.`,
      ];
    }

    const fallbackNeeds = requirements(fallback);
    if (fallbackNeeds.length > 0) {
      return [
        `"${exercise.name}" falls back to "${fallback.name}", which itself needs ${fallbackNeeds.join(', ')} — the fallback is one step, so this is where it stops.`,
      ];
    }

    return [];
  });
}

/**
 * Every equipment fallback that would arrive counted in the wrong unit
 * (DN-113).
 *
 * `applyEquipmentAvailability` replaces the exercise and leaves
 * `WodMovement.reps` exactly as prescribed -- deliberately, since the count
 * is the workout's and not the movement's. That makes the count meaningless
 * the moment the substitute is measured differently: a forty-second farmer
 * carry handed to an athlete with no dumbbells becomes forty side planks,
 * and nothing anywhere says so. It is the reachability gap again in a form
 * the first check cannot see, because the way out exists -- it just lies.
 *
 * Carries are what made this reachable at all: until DN-113 no
 * equipment movement was timed, so every fallback matched by accident.
 */
export function mismatchedSubstituteUnits(
  exercises: readonly SubstitutableSeed[],
): string[] {
  const byName = new Map(exercises.map((e) => [e.name, e]));
  const unitOf = (e: SubstitutableSeed) => e.unit ?? 'reps';

  return exercises.flatMap((exercise) => {
    if (requirements(exercise).length === 0 || !exercise.fallback) return [];

    const fallback = byName.get(exercise.fallback);
    // A missing alternative is the other check's to report, in its words.
    if (!fallback || unitOf(fallback) === unitOf(exercise)) return [];

    return [
      `"${exercise.name}" is counted in ${unitOf(exercise)} and falls back to "${fallback.name}", counted in ${unitOf(fallback)} — the prescribed count carries over unchanged, so it would arrive meaning something else.`,
    ];
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

/**
 * Fails the seed when a fallback would change what the prescribed count
 * means (DN-113). Its own assertion rather than part of the one above,
 * because it is a different fault with a different fix: the way down exists,
 * and it is the wrong shape.
 */
export function assertSubstituteUnitsMatch(
  exercises: readonly SubstitutableSeed[],
): void {
  const problems = mismatchedSubstituteUnits(exercises);
  if (problems.length === 0) return;

  throw new Error(
    [
      `Seed refused: ${problems.length} equipment movement(s) fall back to a different unit.`,
      ...problems.map((p) => `  - ${p}`),
    ].join('\n'),
  );
}
