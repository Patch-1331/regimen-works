import { addIsoDays } from '@regimen-works/shared';

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
 *
 * `candidates` is expected to have been through `applyEquipmentFloor`
 * already (DN-82). That filter deliberately sits outside this function,
 * above the relaxation ladder rather than inside it: every step below is
 * about a pool that is too small, and a filter applied between them could
 * leave an athlete with no workout at all.
 */
/**
 * The movement a WOD is identified by: the first one in its dominant pattern.
 *
 * `Wod.dominantPattern` is already what the app treats as a WOD's identity —
 * `pickWod` uses it for the cooldown rule, so two WODs sharing it are treated
 * as the same kind of day. This resolves that claim down to the movement
 * actually carrying it, which is what the equipment floor below has to look
 * at. `wod-seed.spec.ts` holds every seeded WOD to having one.
 */
export function dominantMovement<
  M extends { exercise: { pattern: string | null } },
>(movements: M[], dominantPattern: string): M | undefined {
  return movements.find((m) => m.exercise.pattern === dominantPattern);
}

/**
 * Drops WODs whose identifying movement the athlete owns nothing for (DN-82).
 *
 * Substituting movement by movement is the right default and it has a floor.
 * A cardio WOD built on double-unders, handed to someone with no rope,
 * becomes entirely high knees — technically a workout, but no longer the
 * workout it was, and the cooldown rule is now tracking it under a name that
 * describes none of what was trained.
 *
 * **This sits above `pickWod`'s relaxation ladder, never inside it.** The
 * library is small and that fallback exists because the pool empties fast; a
 * filter applied underneath it could leave an athlete with no workout at all.
 * So when the filter empties the pool it hands back the unfiltered list and
 * lets per-movement substitution carry the day: a degraded workout beats no
 * workout, and it is the obvious reading of "filter by equipment" that breaks
 * this.
 *
 * `dominantEquipment` is what the identifying movement needs *after* the
 * athlete's remembered choice has been applied, not what the library
 * prescribed. An athlete who owns no bar and has settled on Supermans as
 * their pull movement is not having anything substituted for equipment, and
 * dropping their pull WODs would be the app arguing with a choice they
 * already made.
 */
export function applyEquipmentFloor<C extends { dominantEquipment: string[] }>(
  candidates: C[],
  owned: ReadonlySet<string>,
): C[] {
  const performable = candidates.filter((c) =>
    c.dominantEquipment.every((piece) => owned.has(piece)),
  );
  return performable.length > 0 ? performable : candidates;
}

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

  const cutoff = addIsoDays(today, -cooldownDays);
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

/**
 * Monday–Sunday range (inclusive) containing the given ISO date.
 *
 * No production caller since DN-12 turned the rest-day check into a weekday
 * lookup. Kept rather than deleted because it is the written-down statement
 * that a week here runs Monday to Sunday — `docs/design/programs.md` aligns
 * program weeks to it by name, and DN-11 and DN-17 both resolve against it.
 * Deleting it to re-add the same function next issue would be churn, not
 * hygiene.
 */
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

/**
 * True when this date is not one of the athlete's training days (DN-12).
 *
 * This used to be `isRestDay(assignedDaysThisWeek, maxDaysPerWeek)` — a quota
 * check that knew how many days a week the athlete trained but never which
 * ones, so a rest day was simply whichever day the allowance ran out on. It is
 * now a calendar: the athlete says Mon/Wed/Fri, and Tuesday is a rest day
 * because it is Tuesday.
 *
 * `trainingDays` uses `getUTCDay()`'s numbering (0 = Sunday), which is why
 * there is no conversion here; see `trainingDaysSchema` in packages/shared.
 *
 * Note what this deliberately no longer knows: whether the week is short. A
 * missed Wednesday does not make Thursday a training day, and the athlete is
 * not told they are behind. Offering to make it up is DN-17's, and it belongs
 * at the point of offering rather than buried in a predicate that other
 * callers read as "is today scheduled".
 */
export function isRestDay(isoDate: string, trainingDays: number[]): boolean {
  const weekday = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  return !trainingDays.includes(weekday);
}

export type ExerciseWithLine = {
  movementGroup: string | null;
};

/**
 * Swaps each movement's exercise for the one the athlete last chose on that
 * movement's line, so they do not re-pick the same movement every session
 * (Feature #2).
 *
 * This applies a remembered preference, not a verdict (DN-88). The app holds
 * no view about what anyone is capable of: the stored rung is the last thing
 * they picked, and the group it belongs to is a grouping and a sort order, not a
 * scale they are being measured against.
 *
 * Reps are left untouched — only the exercise identity changes, matching
 * "preserve function" (source 01 in the design doc): same rep scheme, movement
 * substituted within its own pattern.
 *
 * Movements whose exercise isn't on a group (`line === null`, e.g.
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
    const movementGroup = m.exercise.movementGroup;
    if (!movementGroup) return m;

    const rung = chosenRung.get(movementGroup);
    if (rung === undefined) return m;

    const substitute = exerciseAtRung.get(`${movementGroup}:${rung}`);
    if (!substitute) return m;

    return { ...m, exercise: substitute };
  });
}

export type ExerciseWithEquipment = {
  equipment: string[];
  fallbackExerciseId: string | null;
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
        .map((m) => m.exercise.fallbackExerciseId)
        .filter((id): id is string => id !== null),
    ),
  ];
}

/**
 * Falls each movement the athlete has no equipment for back to its
 * `fallbackExerciseId` — the layer that turns "what they chose" into "what they
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

    const fallbackId = m.exercise.fallbackExerciseId;
    if (fallbackId === null) return m;

    const substitute = substituteById.get(fallbackId);
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
 * the same group twice moves only the row that was tapped.
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
