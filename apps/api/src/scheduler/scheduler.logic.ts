/**
 * Pure scheduling logic — no DB, no Date.now(), no Math.random() calls
 * baked in. Everything the algorithm needs comes in as arguments so it's
 * deterministic and unit-testable given a seed and a history.
 */

export type WodCandidate = {
  id: string;
  name: string;
  type: string;
  dominantPattern: string;
};

export type RecentAssignment = {
  date: string; // ISO date, YYYY-MM-DD
  wod: WodCandidate;
};

/**
 * Picks the next WOD given the library and recent history.
 *
 * Rules, in order:
 * 1. Prefer WODs whose name AND dominant pattern were not used within
 *    `cooldownDays` of `today`.
 * 2. If that empties the pool (a small library exhausts fast), relax to
 *    just excluding an exact repeat of the most recent WOD.
 * 3. If that's still empty (a one-WOD library), any candidate is fair
 *    game.
 * 4. Within whatever pool survives, softly prefer a different WOD type
 *    than yesterday's, to alternate formats — but never let that rule
 *    empty the pool.
 *
 * `history` does not need to be pre-filtered — this function does its
 * own date-window filtering — but must be sorted most-recent-first.
 */
export function pickWod(
  candidates: WodCandidate[],
  history: RecentAssignment[],
  today: string,
  cooldownDays: number,
  rng: () => number,
): WodCandidate {
  if (candidates.length === 0) {
    throw new Error('pickWod: no candidates to choose from');
  }

  const cutoff = addDays(today, -cooldownDays);
  const recent = history.filter((r) => r.date >= cutoff && r.date < today);

  const usedNames = new Set(recent.map((r) => r.wod.name));
  const usedPatterns = new Set(recent.map((r) => r.wod.dominantPattern));

  let pool = candidates.filter(
    (c) => !usedNames.has(c.name) && !usedPatterns.has(c.dominantPattern),
  );

  if (pool.length === 0) {
    const lastName = history[0]?.wod.name;
    pool = candidates.filter((c) => c.name !== lastName);
  }

  if (pool.length === 0) {
    pool = candidates;
  }

  const lastType = history[0]?.wod.type;
  if (lastType) {
    const alternated = pool.filter((c) => c.type !== lastType);
    if (alternated.length > 0) {
      pool = alternated;
    }
  }

  const index = Math.floor(rng() * pool.length);
  return pool[Math.min(index, pool.length - 1)];
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return toIsoDate(d);
}

/** Monday–Sunday range (inclusive) containing the given ISO date. */
export function getWeekRange(isoDate: string): { start: string; end: string } {
  const d = new Date(`${isoDate}T00:00:00Z`);
  const day = d.getUTCDay(); // 0 = Sunday
  const diffToMonday = day === 0 ? -6 : 1 - day;

  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() + diffToMonday);

  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);

  return { start: toIsoDate(monday), end: toIsoDate(sunday) };
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** True once the week already has `maxDaysPerWeek` workout-day assignments. */
export function isRestDay(
  assignedDaysThisWeek: number,
  maxDaysPerWeek: number,
): boolean {
  return assignedDaysThisWeek >= maxDaysPerWeek;
}

export type ExerciseWithLine = {
  line: string | null;
};

/**
 * Swaps each movement's exercise for the one the athlete last chose on that
 * movement's line, so they do not re-pick the same movement every session
 * (Feature #2).
 *
 * This applies a remembered preference, not a verdict (DN-88). The app holds
 * no view about what anyone is capable of: the stored rung is the last thing
 * they picked, and the ladder it sits on is a grouping and a sort order, not a
 * scale they are being measured against.
 *
 * Reps are left untouched — only the exercise identity changes, matching
 * "preserve function" (source 01 in the design doc): same rep scheme, movement
 * substituted within its own pattern.
 *
 * Movements whose exercise isn't on a tracked line (`line === null`, e.g.
 * cardio) pass through unchanged, as does any movement where the athlete has
 * chosen nothing or no exercise exists at that line+rung — a curated WOD
 * should never end up with a hole in its movement list because of a data gap.
 */
export function applyRememberedChoice<
  M extends { exercise: E },
  E extends ExerciseWithLine,
>(
  movements: M[],
  chosenRung: Map<string, number>,
  exerciseAtRung: Map<string, E>, // key: `${line}:${rung}`
): M[] {
  return movements.map((m) => {
    const line = m.exercise.line;
    if (!line) return m;

    const rung = chosenRung.get(line);
    if (rung === undefined) return m;

    const substitute = exerciseAtRung.get(`${line}:${rung}`);
    if (!substitute) return m;

    return { ...m, exercise: substitute };
  });
}

export type ExerciseWithEquipment = {
  equipment: string[];
  altExerciseId: string | null;
};

/**
 * Whether the athlete can perform the movement at all, given what they own.
 *
 * A movement needs *every* piece it is tagged with. An untagged exercise is
 * the baseline and always passes: bodyweight is the absence of a tag rather
 * than a member of the catalog (DN-77), so "needs nothing" and "owns nothing"
 * meet at the empty set.
 */
function isPerformable(
  exercise: ExerciseWithEquipment,
  owned: ReadonlySet<string>,
): boolean {
  return exercise.equipment.every((piece) => owned.has(piece));
}

/**
 * The substitutes `applyEquipmentAvailability` would reach for, so a caller
 * can load exactly those rows and no others.
 *
 * Split out rather than folded into the layer below because the two run
 * either side of a database read, and this keeps "what counts as performable"
 * written once. The common day -- an athlete on the baseline, a WOD that is
 * mostly bodyweight -- returns nothing here, which is what lets the resolver
 * skip the query entirely.
 */
export function unperformableSubstituteIds<E extends ExerciseWithEquipment>(
  movements: { exercise: E }[],
  owned: ReadonlySet<string>,
): string[] {
  return [
    ...new Set(
      movements
        .filter((m) => !isPerformable(m.exercise, owned))
        .map((m) => m.exercise.altExerciseId)
        .filter((id): id is string => id !== null),
    ),
  ];
}

/**
 * Falls each movement the athlete has no equipment for back to its
 * `altExerciseId` — the layer that turns "what they chose" into "what they
 * can actually perform" (DN-79).
 *
 * Runs *after* the remembered choice, because the choice itself lands on
 * equipment: the pull group's harder variants all want a bar, so checking the
 * prescription rather than the resolved exercise would hand an athlete a
 * movement their own standing choice had already made impossible.
 *
 * Runs *before* the day's swap, because the athlete wins. Someone who owns no
 * rope and taps into double-unders anyway has said something ownership should
 * not argue with — no rope at home is not no rope in a hotel gym.
 *
 * **One step down the chain, not a walk.** The substitute is taken as given
 * rather than re-checked against what the athlete owns, which makes "every
 * alternative is performable on the baseline" a property the seed owes
 * (DN-83) rather than something recomputed per athlete, per day.
 *
 * A movement with no substitute, or one whose substitute is missing from
 * `substituteById`, passes through unchanged rather than throwing — the same
 * discipline the layers either side keep. The athlete is about to train, and
 * a data gap must not leave a hole in the movement list.
 */
export function applyEquipmentAvailability<
  M extends { exercise: E },
  E extends ExerciseWithEquipment,
>(
  movements: M[],
  owned: ReadonlySet<string>,
  substituteById: ReadonlyMap<string, E>,
): M[] {
  return movements.map((m) => {
    if (isPerformable(m.exercise, owned)) return m;

    const altId = m.exercise.altExerciseId;
    if (altId === null) return m;

    const substitute = substituteById.get(altId);
    if (!substitute) return m;

    return { ...m, exercise: substitute };
  });
}

/**
 * Overlays the athlete's own swaps for this day on top of the remembered
 * choice (WOD-5). Runs last, and deliberately so: the remembered choice is
 * what they picked some time ago, the swap is what they want today, and today
 * wins.
 *
 * Keyed by WodMovement id rather than by exercise or line, so a WOD naming
 * the same line twice moves only the row that was tapped.
 *
 * A swap whose exercise is missing from `exerciseById` passes through
 * unchanged rather than throwing, for the same reason a missing rung does:
 * the athlete is about to train, and a data gap must not leave a hole in the
 * movement list.
 */
export function applySubstitutions<M extends { id: string; exercise: E }, E>(
  movements: M[],
  substitutionByMovementId: Map<string, string>, // wodMovementId -> exerciseId
  exerciseById: Map<string, E>,
): M[] {
  if (substitutionByMovementId.size === 0) return movements;

  return movements.map((m) => {
    const exerciseId = substitutionByMovementId.get(m.id);
    if (exerciseId === undefined) return m;

    const substitute = exerciseById.get(exerciseId);
    if (!substitute) return m;

    return { ...m, exercise: substitute };
  });
}
