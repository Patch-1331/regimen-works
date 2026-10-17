import { createHash } from 'node:crypto';

import {
  equipment as equipmentEnum,
  exerciseCategory,
  exerciseForce,
  exerciseLevel,
  exerciseMechanic,
  movementGroup as movementGroupEnum,
  movementPattern,
  muscle,
  type Equipment,
  type MovementPattern,
  type ExerciseCategory,
  type ExerciseForce,
  type ExerciseLevel,
  type ExerciseMechanic,
  type Muscle,
} from '@regimen-works/shared';
import { z } from 'zod';

/**
 * Building the exercise library from its three committed files (DN-167,
 * ADR-0007 decision 3).
 *
 * - the dataset, free-exercise-db pinned by checksum;
 * - the app's own exercises, written in the dataset's shape;
 * - the curation, keyed by exercise key: which dataset entries are in, what
 *   the scheduler needs to know about each one, and what stays out and why.
 *
 * Pure, like `substitute-guard.ts` beside it: nothing is read and nothing is
 * written. `prisma/library/index.ts` reads the files and `import-library.ts`
 * writes the rows. Everything it refuses, it refuses with every offender
 * named, so one run says the whole of what is wrong.
 */

/** free-exercise-db at the commit the library is pinned to. */
export const PINNED_COMMIT = 'f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5';
/** sha256 of `dist/exercises.json` at `PINNED_COMMIT`. */
export const PINNED_SHA256 =
  '5bb747e3fc658f095a60dcbf6d53c96627acdcc6ffb6fffde86f7e26995d40bf';

/**
 * Refuses any dataset file but the pinned one. Refused rather than warned:
 * the library claims a provenance, and a different file would make the claim
 * false. Moving the pin means changing the commit and the checksum together,
 * in a change of its own.
 */
export function assertPinned(raw: Buffer): void {
  const sha256 = createHash('sha256').update(raw).digest('hex');
  if (sha256 !== PINNED_SHA256) {
    throw new Error(
      `free-exercise-db.json is not free-exercise-db at ${PINNED_COMMIT} (sha256 ${sha256}).`,
    );
  }
}

/**
 * One entry of free-exercise-db's `dist/exercises.json`, as far as we read
 * it, and the shape the app's own exercises are written in. `images` is not
 * here on purpose: the photographs' provenance is unstated, so nothing reads
 * the field (ADR-0007 decision 2).
 */
export const sourceExercise = z.object({
  id: z.string(),
  name: z.string(),
  force: z.string().nullable(),
  level: z.string(),
  mechanic: z.string().nullable(),
  equipment: z.string().nullable(),
  primaryMuscles: z.array(z.string()),
  secondaryMuscles: z.array(z.string()),
  instructions: z.array(z.string()),
  category: z.string(),
});
export type SourceExercise = z.infer<typeof sourceExercise>;

/** What the scheduler needs to know about an exercise, which no dataset says. */
export type Curation = {
  /** Null only for a movement no pattern describes (light jogging, deep breathing). */
  pattern: string | null;
  /**
   * The name the row had before the import, for a dataset twin renamed in
   * place (ADR-0007 decision 5). Read once, to find the row that has no key
   * yet; from then on the key finds it.
   */
  formerly?: string;
  /** Defaults to reps. */
  unit?: 'reps' | 'seconds';
  /**
   * The group this belongs to (ADR-0004): movements that accomplish the same
   * thing in a program. Membership is a statement about role, not difficulty.
   */
  movementGroup?: string;
  /**
   * The member prescribed to an athlete who has not chosen in this group
   * (ADR-0004 decision 7). Exactly one per group, and declared rather than
   * inferred so it is an opinion someone can argue with.
   */
  isGroupDefault?: true;
  scalable?: true;
  /** The key of the no-equipment substitute (DN-83). */
  fallback?: string;
  /**
   * What the movement needs, in our catalog's words, where the dataset's one
   * equipment word gets it wrong or has no word for it ("other").
   */
  equipment?: Equipment[];
};

/**
 * A hand fix to a dataset entry nobody has curated (DN-168): what its derived
 * values get wrong. Everything left out is derived -- the pattern suggested,
 * the unit from the force, the equipment from the word and the hidden-kit
 * rules.
 */
export type Correction = {
  /** Null for a movement no pattern describes. */
  pattern?: string | null;
  unit?: 'reps' | 'seconds';
  /** Replaces the derived equipment outright, rules and all. */
  equipment?: Equipment[];
  /** Where the dataset's name collides with another's under `nameKey`. */
  name?: string;
};

/** An exercise as the import writes it: one global row. */
export type LibraryExercise = {
  key: string;
  name: string;
  /** Set on a dataset twin: the name its row had before (see `Curation`). */
  formerly?: string;
  /** Whether it came from the dataset or is one of the app's own. */
  source: 'dataset' | 'own';
  /**
   * Whether a person has curated it: an own exercise, or a twin with a
   * curation entry. Only these can be prescribed by the seeded WODs, groups
   * and checklists, so only these owe a hand-written fallback (DN-83).
   */
  curated: boolean;
  pattern: string | null;
  equipment: Equipment[];
  scalable: boolean;
  unit: 'reps' | 'seconds';
  movementGroup: string | null;
  isGroupDefault: boolean;
  /** A key, like everything else that points at an exercise here. */
  fallback?: string;
  instructions: string[];
  primaryMuscles: Muscle[];
  secondaryMuscles: Muscle[];
  force: ExerciseForce | null;
  mechanic: ExerciseMechanic | null;
  level: ExerciseLevel;
  category: ExerciseCategory;
};

export type LeftOut = { key: string; name: string; reason: string };

/** Kit a hidden-kit rule added to an uncurated entry, for a person to check. */
export type HiddenKitTag = { key: string; added: Equipment[] };

export type Library = {
  exercises: LibraryExercise[];
  /** Dataset entries kept out on purpose, with the reason. */
  leftOut: LeftOut[];
  /** What the hidden-kit rules added, entry by entry. */
  hiddenKit: HiddenKitTag[];
};

/**
 * Every schema identifier that is also, or contains, an ordinary English
 * word a coaching cue would want (DN-141). The library spec refuses them in
 * every step an athlete reads, and the checklist copy too.
 */
export const SCHEMA_WORDS = [
  'movementGroup',
  'exerciseId',
  'fallbackExerciseId',
  'isGroupDefault',
];

/**
 * The dataset's equipment words in our catalog's (DN-166). One word per
 * exercise in the source, so one piece at most here; what it hides -- the
 * bench under a bench press, the bar a pull-up hangs from -- is added by rule
 * or by the curation.
 *
 * "other" is deliberately absent: it names nothing, so an entry that says it
 * needs a curation `equipment` saying what it is.
 */
const EQUIPMENT: Record<string, Equipment[]> = {
  'body only': [],
  dumbbell: ['dumbbell'],
  kettlebells: ['kettlebell'],
  barbell: ['barbell'],
  'e-z curl bar': ['barbell'],
  cable: ['gym_machines'],
  machine: ['gym_machines'],
  bands: ['bands'],
  'medicine ball': ['medicine_ball'],
  'exercise ball': ['stability_ball'],
  'foam roll': ['foam_roller'],
};

/**
 * Bodyweight movements the source files under "body only" that still need
 * something to hang from.
 */
const HANGS =
  /\b(pull-?ups?|chin-?ups?|hanging|muscle[- ]?ups?|toes[- ]to[- ]bar)\b/i;

/**
 * What an exercise needs, read from its one equipment word. Null when the
 * word names nothing our catalog has, which only a curation entry can settle.
 */
export function mapEquipment(
  exercise: Pick<SourceExercise, 'name' | 'equipment'>,
): Equipment[] | null {
  const mapped = EQUIPMENT[exercise.equipment ?? 'body only'];
  if (!mapped) return null;
  if (mapped.length === 0 && HANGS.test(exercise.name)) return ['bar'];
  return mapped;
}

/** "Hang from a pull-up bar", in an entry whose name does not say so. */
const HANGS_FROM = /\b(pull-?up|chin-?up) bar\b/i;
/** Dips, bar the ones on a bench, a machine or the rings. */
const DIPS = /\bdips?\b/i;
const NOT_DIP_BARS = /\b(bench|machine|rings?)\b/i;
const PARALLEL_BARS = /\bparallel bars\b/i;
const BENCH = /\bbench\b/i;
const BOX = /\bbox(es)?\b/i;

/**
 * The kit the dataset's one equipment word hides (DN-168): the bench under a
 * dumbbell press, the box a jump lands on, the bars a dip is done between,
 * the bar a bodyweight hang needs. Read from the name and the instructions,
 * so it proposes rather than knows -- every tag it adds is listed for a
 * person to check, and a correction overrides it.
 *
 * Only for entries nobody has curated: the curated ones already say what
 * they need.
 */
export function hiddenKit(
  exercise: Pick<SourceExercise, 'name' | 'instructions'>,
  word: readonly Equipment[],
): Equipment[] {
  const text = `${exercise.name} ${exercise.instructions.join(' ')}`;
  const added: Equipment[] = [];
  if (word.length === 0 && HANGS_FROM.test(text)) {
    added.push('bar');
  }
  if (
    (DIPS.test(exercise.name) && !NOT_DIP_BARS.test(exercise.name)) ||
    PARALLEL_BARS.test(text)
  ) {
    added.push('dip_bars');
  }
  if (BENCH.test(text)) added.push('bench');
  if (BOX.test(text)) added.push('box');
  return added.filter((piece) => !word.includes(piece));
}

/**
 * The first matching rule wins, read against the *first* primary muscle --
 * the source lists the prime mover first (DN-157).
 */
const PATTERN_BY_MUSCLE: [MovementPattern, string[]][] = [
  ['core', ['abdominals']],
  ['squat', ['quadriceps', 'adductors', 'abductors', 'calves']],
  ['hinge', ['hamstrings', 'glutes', 'lower back']],
  ['push', ['chest', 'shoulders', 'triceps']],
  ['pull', ['lats', 'middle back', 'biceps', 'traps']],
];

/**
 * A guess at `pattern` for an entry nobody has curated. Null when nothing
 * points anywhere -- forearms, neck -- which is a real answer: the pattern
 * is null for a movement no pattern describes.
 */
export function suggestPattern(
  exercise: Pick<SourceExercise, 'category' | 'primaryMuscles' | 'force'>,
): MovementPattern | null {
  if (exercise.category === 'cardio') return 'cardio';
  const prime = exercise.primaryMuscles[0];
  for (const [pattern, muscles] of PATTERN_BY_MUSCLE) {
    if (prime && muscles.includes(prime)) return pattern;
  }
  if (exercise.force === 'push') return 'push';
  if (exercise.force === 'pull') return 'pull';
  return null;
}

/**
 * What two names have to share to be the same movement: case, spacing,
 * hyphens and a trailing plural all ignored, so the source's "Pushups" meets
 * "Push-up". The library spec holds every name apart by it.
 */
export function nameKey(name: string): string {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((word) => (word.length > 3 ? word.replace(/s$/, '') : word))
    .join('');
}

/** "Decline Push-Up" -> "Decline push-up", the library's house style. */
export function sentenceCase(name: string): string {
  const lower = name.trim().replace(/\s+/g, ' ').toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** The dataset writes "lower back"; our enum, like every enum here, "lower_back". */
function word(value: string): string {
  return value.trim().replace(/ /g, '_');
}

/** The fields every exercise reads from its source entry, curated or not. */
type Described = Pick<
  LibraryExercise,
  | 'instructions'
  | 'primaryMuscles'
  | 'secondaryMuscles'
  | 'force'
  | 'mechanic'
  | 'level'
  | 'category'
>;

/**
 * The library: every own exercise and curated twin first, in the curation's
 * order, which is the order a person reads it in; then every other dataset
 * entry not left out (DN-168), in the dataset's order.
 */
export function buildLibrary({
  dataset,
  own,
  curation,
  corrections,
  leftOut,
}: {
  dataset: readonly SourceExercise[];
  own: readonly SourceExercise[];
  curation: Readonly<Record<string, Curation>>;
  corrections: Readonly<Record<string, Correction>>;
  leftOut: Readonly<Record<string, string>>;
}): Library {
  const problems: string[] = [];
  const datasetByKey = new Map(dataset.map((e) => [e.id, e]));
  const ownByKey = new Map(own.map((e) => [e.id, e]));

  for (const e of own) {
    if (!e.id.startsWith('rw-')) {
      problems.push(`own exercise "${e.id}" needs an rw- key`);
    }
    if (datasetByKey.has(e.id)) {
      problems.push(`own exercise "${e.id}" shadows a dataset entry`);
    }
    if (!(e.id in curation)) {
      problems.push(`own exercise "${e.id}" has no curation entry`);
    }
  }
  for (const key of Object.keys(leftOut)) {
    if (!datasetByKey.has(key)) {
      problems.push(`left out "${key}" is not in the dataset`);
    }
    if (key in curation) {
      problems.push(`"${key}" is both curated in and left out`);
    }
  }
  for (const key of Object.keys(corrections)) {
    if (!datasetByKey.has(key)) {
      problems.push(`correction "${key}" is not in the dataset`);
    }
    if (key in curation) {
      problems.push(`"${key}" is curated, so its curation entry says it all`);
    }
    if (key in leftOut) {
      problems.push(`"${key}" is both corrected and left out`);
    }
  }

  /** What the source entry says, in our enums, with every unknown word reported. */
  const describe = (source: SourceExercise, where: string): Described => {
    const muscles = (list: string[], which: string): Muscle[] =>
      list.map(word).filter((m): m is Muscle => {
        if (muscle.safeParse(m).success) return true;
        problems.push(`${where}: unknown ${which} muscle "${m}"`);
        return false;
      });
    const optional = <T>(
      schema: z.ZodType<T>,
      value: string | null,
      field: string,
    ): T | null => {
      if (value === null) return null;
      const parsed = schema.safeParse(word(value));
      if (parsed.success) return parsed.data;
      problems.push(`${where}: unknown ${field} "${value}"`);
      return null;
    };

    const instructions = source.instructions
      .map((step) => step.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    if (instructions.length === 0) {
      // The swap panel puts moves in front of people who have never done
      // them, so the copy has to exist before the move does.
      problems.push(`${where}: no instructions`);
    }

    return {
      instructions,
      primaryMuscles: muscles(source.primaryMuscles, 'primary'),
      secondaryMuscles: muscles(source.secondaryMuscles, 'secondary'),
      force: optional(exerciseForce, source.force, 'force'),
      mechanic: optional(exerciseMechanic, source.mechanic, 'mechanic'),
      level: optional(exerciseLevel, source.level, 'level') ?? 'beginner',
      category:
        optional(exerciseCategory, source.category, 'category') ?? 'strength',
    };
  };
  const checkPattern = (pattern: string | null | undefined, where: string) => {
    if (pattern && !movementPattern.safeParse(pattern).success) {
      problems.push(`${where}: unknown pattern "${pattern}"`);
    }
  };
  const checkEquipment = (pieces: string[] | undefined, where: string) => {
    for (const piece of pieces ?? []) {
      if (!equipmentEnum.safeParse(piece).success) {
        problems.push(`${where}: unknown equipment "${piece}"`);
      }
    }
  };

  const exercises: LibraryExercise[] = [];
  for (const [key, c] of Object.entries(curation)) {
    const source = ownByKey.get(key) ?? datasetByKey.get(key);
    if (!source) {
      problems.push(`curation names "${key}", which no file holds`);
      continue;
    }
    const isOwn = ownByKey.has(key);
    const where = `"${key}"`;

    // Hand-curated, so the word and the bar rule only: a person has already
    // said what these need, and the hidden-kit rules are for entries nobody
    // has looked at.
    const equipment = c.equipment ?? mapEquipment(source);
    if (!equipment) {
      problems.push(
        `${where}: equipment "${source.equipment}" needs a curation entry saying what it is`,
      );
    }
    checkPattern(c.pattern, where);
    if (
      c.movementGroup &&
      !movementGroupEnum.safeParse(c.movementGroup).success
    ) {
      problems.push(`${where}: unknown movement group "${c.movementGroup}"`);
    }
    checkEquipment(c.equipment, where);
    if (c.fallback !== undefined && !(c.fallback in curation)) {
      problems.push(`${where}: fallback "${c.fallback}" is not in the library`);
    }
    if (isOwn && c.formerly !== undefined) {
      problems.push(
        `${where}: an own exercise keeps its name, so no "formerly"`,
      );
    }

    const entry: LibraryExercise = {
      key,
      name: isOwn ? source.name : sentenceCase(source.name),
      source: isOwn ? 'own' : 'dataset',
      curated: true,
      pattern: c.pattern,
      equipment: equipment ?? [],
      scalable: c.scalable ?? false,
      unit: c.unit ?? 'reps',
      movementGroup: c.movementGroup ?? null,
      isGroupDefault: c.isGroupDefault ?? false,
      ...describe(source, where),
    };
    if (c.formerly !== undefined) entry.formerly = c.formerly;
    if (c.fallback !== undefined) entry.fallback = c.fallback;
    exercises.push(entry);
  }

  const hiddenKitTags: HiddenKitTag[] = [];
  for (const source of dataset) {
    const key = source.id;
    if (key in curation || key in leftOut) continue;
    const c = corrections[key] ?? {};
    const where = `"${key}"`;

    let equipment = c.equipment;
    if (equipment) {
      checkEquipment(equipment, where);
    } else {
      const word = mapEquipment(source);
      if (!word) {
        problems.push(
          `${where}: equipment "${source.equipment}" needs a correction saying what it is`,
        );
      } else {
        const added = hiddenKit(source, word);
        if (added.length > 0) hiddenKitTags.push({ key, added });
        equipment = [...word, ...added];
      }
    }
    checkPattern(c.pattern, where);

    exercises.push({
      key,
      name: c.name ?? sentenceCase(source.name),
      source: 'dataset',
      curated: false,
      pattern: c.pattern !== undefined ? c.pattern : suggestPattern(source),
      equipment: equipment ?? [],
      scalable: false,
      unit: c.unit ?? (source.force === 'static' ? 'seconds' : 'reps'),
      // Groups stay hand-curated (ADR-0007): an entry nobody has looked at
      // is in no group, so no program slot can resolve to it.
      movementGroup: null,
      isGroupDefault: false,
      ...describe(source, where),
    });
  }

  if (problems.length > 0) {
    throw new Error(
      `The exercise library does not build:\n  ${problems.join('\n  ')}`,
    );
  }

  return {
    exercises,
    leftOut: Object.entries(leftOut).map(([key, reason]) => ({
      key,
      name: datasetByKey.get(key)!.name,
      reason,
    })),
    hiddenKit: hiddenKitTags,
  };
}
