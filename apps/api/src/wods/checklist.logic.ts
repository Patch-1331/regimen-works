/**
 * Pure warm-up/cool-down checklist logic (Feature #63) — no DB access. The
 * service layer reads the checklist entries, resolves each to the exercise it
 * points at, and hands them in here (DN-172, ADR-0008).
 */

export type ExerciseForChecklist = {
  /** The exercise's id, not the entry's: the screens link to the movement. */
  id: string;
  name: string;
  /** The pattern the *entry* serves, which is what the WOD is matched on. */
  pattern: string | null;
  kind: string; // 'warmup' | 'cooldown'
  // How the movement is performed, step by step; passed straight through to
  // the checklist screens. Empty when neither the entry nor the exercise has
  // copy.
  instructions: string[];
};

const DEFAULT_TARGET_COUNT = 4;

/**
 * Picks up to `targetCount` entries on the `kind` checklist, preferring ones
 * that match the WOD's `dominantPattern` and falling back to generic
 * (`pattern: null`) filler to round out the count. Matching exercises come
 * first in the result so the most relevant moves show up at the top of the
 * checklist.
 */
export function buildChecklist(
  pool: ExerciseForChecklist[],
  kind: 'warmup' | 'cooldown',
  dominantPattern: string,
  targetCount: number = DEFAULT_TARGET_COUNT,
): ExerciseForChecklist[] {
  const candidates = pool.filter((e) => e.kind === kind);

  const matching = candidates.filter((e) => e.pattern === dominantPattern);
  const generic = candidates.filter((e) => e.pattern === null);

  return [...matching, ...generic].slice(0, targetCount);
}

export function buildWarmupChecklist(
  pool: ExerciseForChecklist[],
  dominantPattern: string,
  targetCount?: number,
): ExerciseForChecklist[] {
  return buildChecklist(pool, 'warmup', dominantPattern, targetCount);
}

export function buildCooldownChecklist(
  pool: ExerciseForChecklist[],
  dominantPattern: string,
  targetCount?: number,
): ExerciseForChecklist[] {
  return buildChecklist(pool, 'cooldown', dominantPattern, targetCount);
}
