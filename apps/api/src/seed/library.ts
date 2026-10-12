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
  /** Display order within the group (DN-139). Nothing resolves through it. */
  sortOrder?: number;
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

/** An exercise as the import writes it: one global row. */
export type LibraryExercise = {
  key: string;
  name: string;
  /** Set on a dataset twin: the name its row had before (see `Curation`). */
  formerly?: string;
  /** Whether it came from the dataset or is one of the app's own. */
  source: 'dataset' | 'own';
  pattern: string | null;
  equipment: Equipment[];
  scalable: boolean;
  unit: 'reps' | 'seconds';
  movementGroup: string | null;
  sortOrder: number | null;
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

export type Library = {
  exercises: LibraryExercise[];
  /** Dataset entries kept out on purpose, with the reason. */
  leftOut: LeftOut[];
  /** Dataset entries nobody has decided about yet (DN-168). */
  undecided: number;
};

/**
 * Every schema identifier that is also, or contains, an ordinary English
 * word a coaching cue would want (DN-141). The library spec refuses them in
 * every step an athlete reads, and the checklist copy too.
 */
export const SCHEMA_WORDS = [
  'movementGroup',
  'sortOrder',
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

/**
 * The library: every own exercise, and every dataset entry the curation
 * lets in. In the curation's order, which is the order a person reads it in.
 */
export function buildLibrary({
  dataset,
  own,
  curation,
  leftOut,
}: {
  dataset: readonly SourceExercise[];
  own: readonly SourceExercise[];
  curation: Readonly<Record<string, Curation>>;
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

  const exercises: LibraryExercise[] = [];
  for (const [key, c] of Object.entries(curation)) {
    const source = ownByKey.get(key) ?? datasetByKey.get(key);
    if (!source) {
      problems.push(`curation names "${key}", which no file holds`);
      continue;
    }
    const isOwn = ownByKey.has(key);
    const where = `"${key}"`;

    const equipment = c.equipment ?? mapEquipment(source);
    if (!equipment) {
      problems.push(
        `${where}: equipment "${source.equipment}" needs a curation entry saying what it is`,
      );
    }
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
    const level = optional(exerciseLevel, source.level, 'level');
    const category = optional(exerciseCategory, source.category, 'category');
    if (c.pattern !== null && !movementPattern.safeParse(c.pattern).success) {
      problems.push(`${where}: unknown pattern "${c.pattern}"`);
    }
    if (
      c.movementGroup &&
      !movementGroupEnum.safeParse(c.movementGroup).success
    ) {
      problems.push(`${where}: unknown movement group "${c.movementGroup}"`);
    }
    for (const piece of c.equipment ?? []) {
      if (!equipmentEnum.safeParse(piece).success) {
        problems.push(`${where}: unknown equipment "${piece}"`);
      }
    }
    if (c.fallback !== undefined && !(c.fallback in curation)) {
      problems.push(`${where}: fallback "${c.fallback}" is not in the library`);
    }
    if (isOwn && c.formerly !== undefined) {
      problems.push(
        `${where}: an own exercise keeps its name, so no "formerly"`,
      );
    }

    const instructions = source.instructions
      .map((step) => step.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    if (instructions.length === 0) {
      // The swap panel puts moves in front of people who have never done
      // them, so the copy has to exist before the move does.
      problems.push(`${where}: no instructions`);
    }

    const entry: LibraryExercise = {
      key,
      name: isOwn ? source.name : sentenceCase(source.name),
      source: isOwn ? 'own' : 'dataset',
      pattern: c.pattern,
      equipment: equipment ?? [],
      scalable: c.scalable ?? false,
      unit: c.unit ?? 'reps',
      movementGroup: c.movementGroup ?? null,
      sortOrder: c.sortOrder ?? null,
      isGroupDefault: c.isGroupDefault ?? false,
      instructions,
      primaryMuscles: muscles(source.primaryMuscles, 'primary'),
      secondaryMuscles: muscles(source.secondaryMuscles, 'secondary'),
      force: optional(exerciseForce, source.force, 'force'),
      mechanic: optional(exerciseMechanic, source.mechanic, 'mechanic'),
      level: level ?? 'beginner',
      category: category ?? 'strength',
    };
    if (c.formerly !== undefined) entry.formerly = c.formerly;
    if (c.fallback !== undefined) entry.fallback = c.fallback;
    exercises.push(entry);
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
    undecided: dataset.filter((e) => !(e.id in curation) && !(e.id in leftOut))
      .length,
  };
}
