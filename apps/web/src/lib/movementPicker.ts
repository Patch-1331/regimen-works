import {
  equipmentLabel,
  type Equipment,
  type MovementVolume,
  type Muscle,
} from "@regimen-works/shared";
import type { ApiExercise } from "./api";
import { searchExercises } from "./programDraft";

/**
 * What the movement picker shows (DN-194), apart from the page that draws it.
 *
 * Pure, and in lib, so kit-first ordering and the alternatives offered for a
 * movement the athlete can't do are tested without mounting anything. Worked
 * out here from the library already in hand rather than per row from the
 * swap endpoint: the results list says how many alternatives each kit-blocked
 * row has, and that is one count per row, before anything is tapped.
 */

/** How a muscle reads in the picker: the dataset's word, made friendly. */
export const MUSCLE_LABEL: Record<Muscle, string> = {
  abdominals: "Abs",
  abductors: "Abductors",
  adductors: "Adductors",
  biceps: "Biceps",
  calves: "Calves",
  chest: "Chest",
  forearms: "Forearms",
  glutes: "Glutes",
  hamstrings: "Hamstrings",
  lats: "Lats",
  lower_back: "Lower back",
  middle_back: "Middle back",
  neck: "Neck",
  quadriceps: "Quads",
  shoulders: "Shoulders",
  traps: "Traps",
  triceps: "Triceps",
};

/**
 * The muscle chips: the dataset's seventeen gathered into the groups an
 * athlete asks for. Every muscle is in exactly one, so a chip never hides a
 * movement that another chip would not show.
 */
export const MUSCLE_GROUPS = [
  { key: "chest", label: "Chest", muscles: ["chest"] },
  { key: "back", label: "Back", muscles: ["lats", "middle_back", "lower_back", "traps"] },
  { key: "legs", label: "Legs", muscles: ["quadriceps", "hamstrings", "glutes", "calves", "adductors", "abductors"] },
  { key: "shoulders", label: "Shoulders", muscles: ["shoulders", "neck"] },
  { key: "arms", label: "Arms", muscles: ["biceps", "triceps", "forearms"] },
  { key: "core", label: "Core", muscles: ["abdominals"] },
] as const satisfies readonly { key: string; label: string; muscles: readonly Muscle[] }[];

export type MuscleGroupKey = (typeof MUSCLE_GROUPS)[number]["key"];

/** The group a muscle belongs to -- for "see all chest movements". */
export function groupOf(m: Muscle): (typeof MUSCLE_GROUPS)[number] {
  return MUSCLE_GROUPS.find((g) => (g.muscles as readonly Muscle[]).includes(m))!;
}

/** Whether the movement works any muscle of the group as a prime mover. */
export function worksGroup(e: ApiExercise, key: MuscleGroupKey): boolean {
  const group = MUSCLE_GROUPS.find((g) => g.key === key)!;
  return e.primaryMuscles.some((m) => (group.muscles as readonly Muscle[]).includes(m));
}

/**
 * The kit the movement needs that the athlete hasn't listed. `owned` null is
 * kit not read yet: nothing is held back until it is, so a slow settings read
 * never hides the library.
 */
export function missingKit(e: ApiExercise, owned: readonly Equipment[] | null): Equipment[] {
  if (owned === null) return [];
  return (e.equipment as Equipment[]).filter((piece) => !owned.includes(piece));
}

export const kitCovers = (e: ApiExercise, owned: readonly Equipment[] | null) =>
  missingKit(e, owned).length === 0;

/** "barbell", "barbell and bench" -- the kit a row says it needs. */
export function kitPhrase(pieces: readonly Equipment[]): string {
  const names = pieces.map((p) => equipmentLabel(p).toLowerCase());
  return names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The muscles a movement works, prime mover first, without repeats. */
export const musclesOf = (e: ApiExercise): Muscle[] => [
  ...new Set([...e.primaryMuscles, ...e.secondaryMuscles]),
];

/**
 * Words that name a muscle rather than a movement: each muscle's own word and
 * its label, and each group's label. "Search by name or muscle" means typing
 * "quads" finds squats.
 */
function musclesNamed(query: string): Muscle[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [];
  const group = MUSCLE_GROUPS.find((g) => g.label.toLowerCase() === q);
  if (group) return [...group.muscles];
  const named = (Object.keys(MUSCLE_LABEL) as Muscle[]).filter(
    (m) => m.replace(/_/g, " ") === q || MUSCLE_LABEL[m].toLowerCase() === q,
  );
  return named;
}

/**
 * Everything the query finds: name matches, best first, then movements that
 * work a muscle the query names. A chip narrows either to its group.
 */
export function findMovements(
  query: string,
  library: ApiExercise[],
  group: MuscleGroupKey | null,
): ApiExercise[] {
  const inGroup = (e: ApiExercise) => group === null || worksGroup(e, group);
  if (query.trim() === "") {
    if (group === null) return [];
    return library.filter(inGroup).sort((a, b) => a.name.localeCompare(b.name));
  }
  const byName = searchExercises(query, library);
  const muscles = musclesNamed(query);
  const named = new Set(byName.map((e) => e.id));
  const byMuscle = muscles.length
    ? library
        .filter((e) => !named.has(e.id) && e.primaryMuscles.some((m) => muscles.includes(m)))
        .sort((a, b) => a.name.localeCompare(b.name))
    : [];
  return [...byName, ...byMuscle].filter(inGroup);
}

export type PickerResults = {
  /** In search order: the first of these is the best match. */
  withKit: ApiExercise[];
  /** Kit the athlete hasn't listed, collapsed beneath the rest. */
  needsKit: ApiExercise[];
};

/**
 * The results split by kit, the kit-ready ones first. Search order is kept
 * within each: a kit-blocked exact match does not outrank a near match the
 * athlete can do, which is the whole of "kit first".
 */
export function splitByKit(found: ApiExercise[], owned: readonly Equipment[] | null): PickerResults {
  return {
    withKit: found.filter((e) => kitCovers(e, owned)),
    needsKit: found.filter((e) => !kitCovers(e, owned)),
  };
}

/** The movement the query names outright, ignoring case, if there is one. */
export function exactMatch(query: string, library: ApiExercise[]): ApiExercise | null {
  const q = query.trim().toLowerCase();
  if (q === "") return null;
  return library.find((e) => e.name.toLowerCase() === q) ?? null;
}

export type Alternative = {
  exercise: ApiExercise;
  /** How many of the target's muscles it works, out of `of`. */
  shared: number;
  of: number;
};

/**
 * What to do instead of a movement the kit can't (DN-194): movements that
 * share a prime-moving muscle with it and need only the athlete's kit, ranked
 * by how many of its muscles they work. Ties go to the one with the same
 * prime mover, then the same movement group, then the name.
 *
 * A movement with no muscles on record -- every athlete-owned one -- falls
 * back to its movement group, which is the only likeness it has.
 */
export function kitAlternatives(
  target: ApiExercise,
  library: ApiExercise[],
  owned: readonly Equipment[] | null,
): Alternative[] {
  const targetMuscles = musclesOf(target);
  const candidates = library.filter((e) => e.id !== target.id && kitCovers(e, owned));
  if (target.primaryMuscles.length === 0) {
    return target.movementGroup === null
      ? []
      : candidates
          .filter((e) => e.movementGroup === target.movementGroup)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((exercise) => ({ exercise, shared: 0, of: 0 }));
  }
  return candidates
    .filter((e) => e.primaryMuscles.some((m) => target.primaryMuscles.includes(m)))
    .map((exercise) => {
      const theirs = musclesOf(exercise);
      return {
        exercise,
        shared: targetMuscles.filter((m) => theirs.includes(m)).length,
        of: targetMuscles.length,
      };
    })
    .sort(
      (a, b) =>
        b.shared - a.shared ||
        Number(b.exercise.primaryMuscles[0] === target.primaryMuscles[0]) -
          Number(a.exercise.primaryMuscles[0] === target.primaryMuscles[0]) ||
        Number(b.exercise.movementGroup === target.movementGroup) -
          Number(a.exercise.movementGroup === target.movementGroup) ||
        a.exercise.name.localeCompare(b.exercise.name),
    );
}

/** Edit distance, for "did you mean". Names are short, so the plain table is fine. */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length];
}

const wordsOf = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

/** A typo's worth of slack: none on short words, where one letter is a different word. */
const close = (typed: string, word: string) =>
  typed.length >= 4 && distance(typed, word) <= (typed.length >= 7 ? 2 : 1);

/**
 * Up to three names near a query that found nothing: the ones sharing the
 * most of its words, allowing a typo in each. Kit-ready ones first among
 * equals, since those are the ones the athlete can take.
 */
export function didYouMean(
  query: string,
  library: ApiExercise[],
  owned: readonly Equipment[] | null,
): ApiExercise[] {
  const typed = wordsOf(query);
  if (typed.length === 0) return [];
  return library
    .map((e) => {
      const theirs = wordsOf(e.name);
      const hits = typed.filter((t) => theirs.some((w) => w === t || close(t, w))).length;
      return { e, score: hits / typed.length };
    })
    .filter((x) => x.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(kitCovers(b.e, owned)) - Number(kitCovers(a.e, owned)) ||
        a.e.name.length - b.e.name.length,
    )
    .slice(0, 3)
    .map((x) => x.e);
}

/** The movements trained on the most days, most first, among those on offer. */
export function usedMost(volume: MovementVolume[], library: ApiExercise[], limit = 4): ApiExercise[] {
  const byId = new Map(library.map((e) => [e.id, e]));
  return [...volume]
    .sort((a, b) => b.sessions.length - a.sessions.length)
    .flatMap((v) => byId.get(v.exerciseId) ?? [])
    .slice(0, limit);
}

/**
 * The name cut into runs, those matching a typed word's start marked, for the
 * bold in the results list.
 */
export function highlight(name: string, query: string): { text: string; hit: boolean }[] {
  const typed = wordsOf(query);
  if (typed.length === 0) return [{ text: name, hit: false }];
  const escaped = typed.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(?<![a-z0-9])(${escaped.join("|")})`, "gi");
  const runs: { text: string; hit: boolean }[] = [];
  let at = 0;
  for (const m of name.matchAll(pattern)) {
    if (m.index > at) runs.push({ text: name.slice(at, m.index), hit: false });
    runs.push({ text: m[0], hit: true });
    at = m.index + m[0].length;
  }
  if (at < name.length) runs.push({ text: name.slice(at), hit: false });
  return runs;
}

const RECENT_KEY = "movement-picker-recent";
const RECENT_LIMIT = 5;

/**
 * The athlete's last few searches that ended in a pick. A browser-local
 * convenience, like a dismissed card: worth nothing on another device, and
 * storage that isn't there just means none to show.
 */
export function recentSearches(): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(stored) ? stored.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

export function rememberSearch(query: string): void {
  const q = query.trim();
  if (q === "") return;
  try {
    const kept = recentSearches().filter((s) => s.toLowerCase() !== q.toLowerCase());
    localStorage.setItem(RECENT_KEY, JSON.stringify([q, ...kept].slice(0, RECENT_LIMIT)));
  } catch {
    // Nothing to do — see above.
  }
}
