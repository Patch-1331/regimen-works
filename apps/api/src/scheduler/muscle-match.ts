import { equipment as equipmentEnum } from '@regimen-works/shared';

/**
 * The muscle-match substitute (DN-169): what `applyEquipmentAvailability`
 * reaches for when a movement the athlete cannot perform has no hand-written
 * fallback. Pure, like the layer that calls it; the service loads the
 * candidates through `muscleMatchWhere` first.
 *
 * Third in line, never ahead of a person: the remembered choice, then the
 * fallback someone wrote, then this. And it may answer nothing -- a barbell
 * deadlift has no honest bodyweight stand-in, and a loose match would put a
 * different workout on the plate under the prescribed rep count.
 */

/** The fields the matcher reads. A Prisma `Exercise` has all of them. */
export type MatchableExercise = {
  id: string;
  key: string | null;
  equipment: string[];
  unit: string;
  category: string | null;
  level: string | null;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  force: string | null;
  mechanic: string | null;
  movementGroup: string | null;
  curated: boolean;
  /**
   * Never offered on muscles alone (DN-174): a person has said this one is a
   * poor stand-in for whatever happens to share its muscles. Its own group
   * and a hand-written fallback still reach it.
   */
  excludeFromMuscleMatch: boolean;
  archivedAt: Date | null;
};

/**
 * What a match is worth, out of 1. The prime mover carries most of it: a
 * substitute that works something else first is a different movement
 * however much else overlaps. Then how much of the rest overlaps, then how
 * it loads. Tuned against the real library (DN-169): at these weights a
 * barbell bench press finds the push-up, and a military press the pike
 * push-up.
 */
export const MATCH_WEIGHTS = {
  primeMover: 0.45,
  overlap: 0.35,
  force: 0.1,
  mechanic: 0.1,
} as const;

/**
 * Below this, no substitute. Needs the prime mover and real overlap besides:
 * the same prime mover with nothing else in common scores 0.45 plus at most
 * 0.2 for force and mechanic, which falls short.
 *
 * Must stay above `force + mechanic`, or a candidate sharing no muscle at all
 * could clear it -- and `muscleMatchWhere` loads only candidates sharing one.
 */
export const MATCH_THRESHOLD = 0.7;

const LEVELS = ['beginner', 'intermediate', 'expert'];

/**
 * The dataset's categories, in the classes a swap may not cross: strength
 * never becomes a stretch or a jump. The lifting categories are all
 * strength.
 */
function categoryClass(category: string | null): string | null {
  switch (category) {
    case null:
      return null;
    case 'stretching':
    case 'plyometrics':
    case 'cardio':
      return category;
    default:
      return 'strength';
  }
}

function performable(e: { equipment: string[] }, owned: ReadonlySet<string>) {
  return e.equipment.every((piece) => owned.has(piece));
}

/**
 * How `candidate` compares to `target` in difficulty, or null where it may
 * not stand in at all -- whatever the athlete owns, and before anything is
 * scored. The rules the automatic swap and the swap panel (DN-170) share.
 */
function comparable(
  target: MatchableExercise,
  candidate: MatchableExercise,
): 'same_or_easier' | 'harder' | null {
  const targetLevel = LEVELS.indexOf(target.level ?? '');
  const level = LEVELS.indexOf(candidate.level ?? '');
  const ok =
    candidate.id !== target.id &&
    candidate.archivedAt === null &&
    candidate.primaryMuscles.length > 0 &&
    candidate.unit === target.unit &&
    categoryClass(candidate.category) !== null &&
    categoryClass(candidate.category) === categoryClass(target.category) &&
    // Unknown difficulty on either side proves nothing, so it does not pass.
    level !== -1 &&
    targetLevel !== -1;
  if (!ok) return null;
  return level <= targetLevel ? 'same_or_easier' : 'harder';
}

const inTargetGroup = (target: MatchableExercise, e: MatchableExercise) =>
  target.movementGroup !== null && e.movementGroup === target.movementGroup;

/**
 * Whether the muscles may put `candidate` forward at all. Not where a person
 * has kept it off (DN-174): a glute-ham raise shares a clean's prime mover,
 * force and mechanic, and is no clean. The data cannot tell them apart, so
 * nothing short of saying so does -- unless the movement's own group, which
 * a person wrote too, vouches for it.
 */
const matchable = (target: MatchableExercise, candidate: MatchableExercise) =>
  !candidate.excludeFromMuscleMatch || inTargetGroup(target, candidate);

/**
 * Whether `candidate` may be swapped in automatically: performable, and
 * never harder (ADR-0007).
 */
function eligible(
  target: MatchableExercise,
  candidate: MatchableExercise,
  owned: ReadonlySet<string>,
): boolean {
  return (
    matchable(target, candidate) &&
    comparable(target, candidate) === 'same_or_easier' &&
    performable(candidate, owned)
  );
}

const muscles = (e: MatchableExercise) =>
  new Set([...e.primaryMuscles, ...e.secondaryMuscles]);

/** How well `candidate` stands in for `target`, out of 1. */
export function matchScore(
  target: MatchableExercise,
  candidate: MatchableExercise,
): number {
  const a = muscles(target);
  const b = muscles(candidate);
  const shared = [...a].filter((m) => b.has(m)).length;
  const overlap = shared / new Set([...a, ...b]).size;
  const same = (x: string | null, y: string | null) => x !== null && x === y;

  return (
    MATCH_WEIGHTS.primeMover *
      Number(target.primaryMuscles[0] === candidate.primaryMuscles[0]) +
    MATCH_WEIGHTS.overlap * overlap +
    MATCH_WEIGHTS.force * Number(same(target.force, candidate.force)) +
    MATCH_WEIGHTS.mechanic * Number(same(target.mechanic, candidate.mechanic))
  );
}

/**
 * Orders two candidates that scored the same: the movement's own group
 * first, then the one keeping more of the prescribed kit, then the curated,
 * then by key -- so the pick never depends on the order the rows came back
 * in. An athlete's own row has no key, and falls back to its id.
 *
 * Kit before curation because muscles alone cannot tell a push-up from a
 * dumbbell bench press: both score a perfect match for a barbell bench
 * press, and an athlete who owns dumbbells and a bench should keep a loaded
 * press rather than drop to bodyweight.
 */
function tieBreak(
  target: MatchableExercise,
  a: MatchableExercise,
  b: MatchableExercise,
): number {
  const inGroup = (e: MatchableExercise) => inTargetGroup(target, e);
  if (inGroup(a) !== inGroup(b)) return inGroup(a) ? -1 : 1;
  const kept = (e: MatchableExercise) =>
    e.equipment.filter((piece) => target.equipment.includes(piece)).length;
  if (kept(a) !== kept(b)) return kept(b) - kept(a);
  if (a.curated !== b.curated) return a.curated ? -1 : 1;
  const ka = a.key ?? `~${a.id}`;
  const kb = b.key ?? `~${b.id}`;
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

/**
 * The best substitute for `target` the athlete can perform, or null where
 * nothing clears `MATCH_THRESHOLD`. A target with no muscles has nothing to
 * match on and gets null, never "anything goes".
 */
export function muscleMatch<E extends MatchableExercise>(
  target: MatchableExercise,
  candidates: readonly E[],
  owned: ReadonlySet<string>,
): E | null {
  if (target.primaryMuscles.length === 0) return null;

  let best: { exercise: E; score: number } | null = null;
  for (const candidate of candidates) {
    if (!eligible(target, candidate, owned)) continue;
    const score = matchScore(target, candidate);
    if (score < MATCH_THRESHOLD) continue;
    if (
      !best ||
      score > best.score ||
      (score === best.score && tieBreak(target, candidate, best.exercise) < 0)
    ) {
      best = { exercise: candidate, score };
    }
  }
  return best?.exercise ?? null;
}

/**
 * The swap panel's three sections for `target` (DN-170): what the athlete
 * can do at the same level or easier, what they can do that is harder, and
 * what matches but needs kit they have not listed. A harder move needing
 * unlisted kit is in none of them.
 *
 * Two ways in. The movement's own group, whatever the score: the group is a
 * hand-curated set of interchangeable movements, any member for any other
 * (ADR-0004), and muscles alone would split it -- a glute bridge and a
 * Romanian deadlift share a group and not a prime mover. Everything else
 * passes the automatic swap's hard filters, clears `MATCH_THRESHOLD`, and is
 * not kept off the muscle match (DN-174).
 *
 * Uncapped and in display order: curated first, then by score, then the
 * automatic swap's own tie-break. The cap is the caller's, because legality
 * reads the whole of each section and the panel only its head.
 *
 * Only the athlete ever takes a harder option. The automatic swap reads
 * `muscleMatch`, which never looks past the first section.
 */
export function swapSections<E extends MatchableExercise>(
  target: MatchableExercise,
  candidates: readonly E[],
  owned: ReadonlySet<string>,
): SwapSections<E> {
  const sections: Record<
    keyof SwapSections<E>,
    { exercise: E; score: number }[]
  > = { main: [], harder: [], needsEquipment: [] };

  for (const candidate of candidates) {
    const mate = inTargetGroup(target, candidate);
    if (!matchable(target, candidate)) continue;
    const difficulty = mate
      ? groupMateDifficulty(target, candidate)
      : comparable(target, candidate);
    if (difficulty === null) continue;
    const score = matchScore(target, candidate);
    if (!mate && score < MATCH_THRESHOLD) continue;
    const canDo = performable(candidate, owned);
    if (canDo && difficulty === 'same_or_easier') {
      sections.main.push({ exercise: candidate, score });
    } else if (canDo) {
      sections.harder.push({ exercise: candidate, score });
    } else if (difficulty === 'same_or_easier') {
      sections.needsEquipment.push({ exercise: candidate, score });
    }
  }

  const order = (
    a: { exercise: E; score: number },
    b: { exercise: E; score: number },
  ) =>
    a.exercise.curated !== b.exercise.curated
      ? a.exercise.curated
        ? -1
        : 1
      : b.score - a.score || tieBreak(target, a.exercise, b.exercise);
  const sorted = (rows: { exercise: E; score: number }[]) =>
    rows.sort(order).map((r) => r.exercise);
  return {
    main: sorted(sections.main),
    harder: sorted(sections.harder),
    needsEquipment: sorted(sections.needsEquipment),
  };
}

/**
 * Where a member of the movement's own group sits: harder only where both
 * levels are known and say so. An undescribed member is the athlete's own,
 * or older content, and the group already vouches for it.
 */
function groupMateDifficulty(
  target: MatchableExercise,
  candidate: MatchableExercise,
): 'same_or_easier' | 'harder' | null {
  if (candidate.id === target.id || candidate.archivedAt !== null) return null;
  const targetLevel = LEVELS.indexOf(target.level ?? '');
  const level = LEVELS.indexOf(candidate.level ?? '');
  return targetLevel !== -1 && level > targetLevel
    ? 'harder'
    : 'same_or_easier';
}

export type SwapSections<E> = {
  main: E[];
  harder: E[];
  needsEquipment: E[];
};

/**
 * The movements the muscle match will be asked about: those the athlete
 * cannot perform, with no hand-written fallback, and with muscles to match
 * on. The common day returns none, and the service skips the query.
 */
export function muscleMatchTargets<
  E extends MatchableExercise & {
    fallbackExerciseId: string | null;
  },
>(movements: { exercise: E }[], owned: ReadonlySet<string>): E[] {
  return movements
    .map((m) => m.exercise)
    .filter(
      (e) =>
        !performable(e, owned) &&
        e.fallbackExerciseId === null &&
        e.primaryMuscles.length > 0,
    );
}

/**
 * A `where` for the candidates `targets` could match, so the service loads
 * those and not the library (DN-169): the right units, kit the athlete owns,
 * and at least one muscle in common with some target. Sound because a
 * candidate sharing no muscle cannot clear `MATCH_THRESHOLD`; the rest of the
 * rules are the matcher's to apply.
 */
export function muscleMatchWhere(
  targets: readonly MatchableExercise[],
  owned: ReadonlySet<string>,
) {
  return {
    ...sharesAMuscle(targets),
    NOT: {
      equipment: {
        hasSome: equipmentEnum.options.filter((piece) => !owned.has(piece)),
      },
    },
  };
}

/**
 * The candidates `swapSections` could offer for `target` (DN-170):
 * `muscleMatchWhere` without the kit, because the panel offers what needs
 * equipment the athlete has not listed too, under its own heading -- and
 * the movement's own group, which it offers whatever the muscles say.
 */
export function swapCandidatesWhere(target: MatchableExercise) {
  return {
    OR: [
      sharesAMuscle([target]),
      ...(target.movementGroup === null
        ? []
        : [{ movementGroup: target.movementGroup }]),
    ],
  };
}

function sharesAMuscle(targets: readonly MatchableExercise[]) {
  const wanted = [...new Set(targets.flatMap((t) => [...muscles(t)]))];
  return {
    unit: { in: [...new Set(targets.map((t) => t.unit))] },
    primaryMuscles: { isEmpty: false },
    OR: [
      { primaryMuscles: { hasSome: wanted } },
      { secondaryMuscles: { hasSome: wanted } },
    ],
  };
}
