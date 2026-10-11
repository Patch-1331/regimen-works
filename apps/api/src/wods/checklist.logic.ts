/**
 * Pure warm-up/cool-down checklist logic (Feature #63) — no DB access. The
 * service layer queries the phase-tagged exercise pool and hands it in here.
 */

export type ExerciseForChecklist = {
  id: string;
  name: string;
  pattern: string | null;
  phase: string | null; // 'warmup' | 'cooldown' | null
  // How the movement is performed, step by step; passed straight through to
  // the checklist screens. Empty on rows nobody has written copy for.
  instructions: string[];
};

const DEFAULT_TARGET_COUNT = 4;

/**
 * Picks up to `targetCount` exercises tagged with `phase`, preferring ones
 * that match the WOD's `dominantPattern` and falling back to generic
 * (`pattern: null`) filler to round out the count. Matching exercises come
 * first in the result so the most relevant moves show up at the top of the
 * checklist.
 */
export function buildChecklist(
  pool: ExerciseForChecklist[],
  phase: 'warmup' | 'cooldown',
  dominantPattern: string,
  targetCount: number = DEFAULT_TARGET_COUNT,
): ExerciseForChecklist[] {
  const candidates = pool.filter((e) => e.phase === phase);

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
