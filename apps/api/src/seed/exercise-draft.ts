import type { Equipment, MovementPattern } from '@regimen-works/shared';
import type { ExerciseSeed } from '../../prisma/exercise-seed';

/**
 * Drafting `ExerciseSeed` entries from free-exercise-db (DN-157).
 *
 * The dataset is raw material, not a library. It describes a movement by its
 * muscles and the gym kit it needs; the scheduler reads a movement by its
 * group, its declared default and its way out for an athlete without the
 * kit (ADR-0004), and none of those can be derived from muscles. So what
 * comes out of here is a draft for a person: name, prose and equipment
 * carried over, a pattern *suggested*, and the grouping left blank on
 * purpose so `exercise-seed.spec.ts` names what is still missing once an
 * entry is pasted in.
 *
 * Pure, like `substitute-guard.ts` beside it: no file is read and nothing is
 * fetched. `prisma/draft-exercises.ts` does the I/O.
 */

/** One entry of free-exercise-db's `dist/exercises.json`, as far as we read it. */
export type SourceExercise = {
  name: string;
  force: string | null;
  level: string;
  mechanic: string | null;
  equipment: string | null;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  instructions: string[];
  category: string;
};

/**
 * The seed fields a draft fills. A subset of `ExerciseSeed` by construction,
 * so a draft pasted into `exercises` type-checks as far as it goes.
 */
export type DraftSeed = Pick<
  ExerciseSeed,
  'name' | 'pattern' | 'instructions' | 'equipment' | 'unit'
>;

export type Draft = {
  seed: DraftSeed;
  /** What the curator should check: every value here that is a guess. */
  notes: string[];
};

export type Skipped = { name: string; reason: string };

export type DraftResult = { drafts: Draft[]; skipped: Skipped[] };

/**
 * Every schema identifier that is also, or contains, an ordinary English
 * word a coaching cue would want (DN-141). `exercise-seed.spec.ts` refuses
 * them in the shipped library; this refuses them on the way in, and the spec
 * reads this list so the two cannot drift.
 */
export const SCHEMA_WORDS = [
  'movementGroup',
  'sortOrder',
  'exerciseId',
  'fallbackExerciseId',
  'isGroupDefault',
];

/**
 * The source's equipment words that mean something in our catalog.
 *
 * "barbell" is deliberately absent. Our `bar` is a pull-up bar -- something
 * to hang from -- and a barbell is a different object. The catalog has had
 * words for it and for most of the rest the source lists (machine, cable,
 * bands, ...) since DN-166, but this draft predates them and skips those
 * movements rather than prescribing them to someone who cannot do them. The
 * import that replaces this draft (DN-167) maps them.
 */
const EQUIPMENT: Record<string, Equipment[]> = {
  'body only': [],
  dumbbell: ['dumbbell'],
  kettlebells: ['kettlebell'],
};

/**
 * Bodyweight movements the source files under "body only" that still need
 * something to hang from.
 */
const HANGS =
  /\b(pull-?ups?|chin-?ups?|hanging|muscle[- ]?ups?|toes[- ]to[- ]bar)\b/i;

export function mapEquipment(
  exercise: SourceExercise,
):
  | { ok: true; equipment: Equipment[]; guessed?: true }
  | { ok: false; reason: string } {
  const word = exercise.equipment ?? 'body only';
  const mapped = EQUIPMENT[word];
  if (!mapped) return { ok: false, reason: `equipment "${word}"` };
  if (mapped.length === 0 && HANGS.test(exercise.name)) {
    return { ok: true, equipment: ['bar'], guessed: true };
  }
  return { ok: true, equipment: mapped };
}

/**
 * The first matching rule wins, read against the *first* primary muscle --
 * the source lists the prime mover first.
 */
const PATTERN_BY_MUSCLE: [MovementPattern, string[]][] = [
  ['core', ['abdominals']],
  ['squat', ['quadriceps', 'adductors', 'abductors', 'calves']],
  ['hinge', ['hamstrings', 'glutes', 'lower back']],
  ['push', ['chest', 'shoulders', 'triceps']],
  ['pull', ['lats', 'middle back', 'biceps', 'traps']],
];

/**
 * A guess at `pattern`, never an answer. Null when nothing points anywhere,
 * which a curator settles rather than a default hides.
 */
export function suggestPattern(
  exercise: SourceExercise,
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
 * The source's numbered steps as the one paragraph of prose the seed holds.
 * Refused rather than drafted when there is nothing to read, or when the
 * prose holds a word the shipped library is not allowed to contain.
 */
export function joinInstructions(
  steps: string[],
): { ok: true; instructions: string } | { ok: false; reason: string } {
  const instructions = steps
    .map((step) => step.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' ');
  if (!instructions) return { ok: false, reason: 'no instructions' };
  const word = SCHEMA_WORDS.find((w) => instructions.includes(w));
  if (word) return { ok: false, reason: `instructions name "${word}"` };
  return { ok: true, instructions };
}

/**
 * What two names have to share to be the same movement: case, spacing,
 * hyphens and a trailing plural all ignored, so the source's "Pushups" meets
 * the library's "Push-up".
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
function sentenceCase(name: string): string {
  const lower = name.trim().toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export function draftExercises(
  source: readonly SourceExercise[],
  libraryNames: readonly string[],
): DraftResult {
  const seen = new Map<string, string>(
    libraryNames.map((name) => [nameKey(name), name]),
  );
  const fromLibrary = new Set(seen.keys());
  const drafts: Draft[] = [];
  const skipped: Skipped[] = [];

  for (const exercise of source) {
    const key = nameKey(exercise.name);
    const earlier = seen.get(key);
    if (earlier !== undefined) {
      skipped.push({
        name: exercise.name,
        reason: fromLibrary.has(key)
          ? `already in the library as "${earlier}"`
          : `duplicate of "${earlier}" in the source`,
      });
      continue;
    }

    const equipment = mapEquipment(exercise);
    if (!equipment.ok) {
      skipped.push({ name: exercise.name, reason: equipment.reason });
      continue;
    }
    const prose = joinInstructions(exercise.instructions);
    if (!prose.ok) {
      skipped.push({ name: exercise.name, reason: prose.reason });
      continue;
    }

    seen.set(key, exercise.name);

    const pattern = suggestPattern(exercise);
    const notes = [
      pattern
        ? `pattern "${pattern}" suggested from ${describe(exercise)}`
        : `no pattern suggested from ${describe(exercise)}`,
    ];
    if (equipment.guessed) {
      notes.push('bar added: the source lists this as body only');
    }

    const seed: DraftSeed = {
      name: sentenceCase(exercise.name),
      pattern,
      instructions: prose.instructions,
    };
    if (equipment.equipment.length > 0) seed.equipment = equipment.equipment;
    if (exercise.force === 'static') {
      seed.unit = 'seconds';
      notes.push('counted in seconds: the source calls it a static hold');
    }
    if (exercise.category === 'stretching') {
      notes.push("a stretch: maybe phase: 'cooldown'");
    }

    drafts.push({ seed, notes });
  }

  return { drafts, skipped };
}

function describe(exercise: SourceExercise): string {
  const parts = [`category ${exercise.category}`];
  if (exercise.primaryMuscles.length > 0) {
    parts.push(`primary ${exercise.primaryMuscles.join('/')}`);
  }
  if (exercise.force) parts.push(`force ${exercise.force}`);
  return parts.join(', ');
}

/**
 * The review file: a TypeScript module, so it type-checks as
 * `Partial<ExerciseSeed>[]` where it lands, with each guess written as a
 * comment over the entry it belongs to. Comments rather than fields because
 * `ExerciseSeed` has no field for "unconfirmed", and an extra field would
 * stop the entry pasting cleanly.
 */
export function renderDrafts(
  { drafts, skipped }: DraftResult,
  { source }: { source: string },
): string {
  const lines = [
    `// Generated by \`npm run exercises:draft --workspace apps/api\` (DN-157).`,
    `// Source: ${source}`,
    '//',
    '// Drafts for review, not library entries. Each needs a movementGroup,',
    '// sortOrder and default decided -- or a deliberate no-group -- and an',
    '// equipment movement needs a bodyweight fallback, before it is pasted into',
    '// `exercises` in exercise-seed.ts. The seed spec says what is still missing.',
    '//',
    `// ${drafts.length} drafted, ${skipped.length} skipped:`,
    ...skipped.map((s) => `//   ${s.name}: ${s.reason}`),
    '',
    "import type { ExerciseSeed } from './exercise-seed';",
    '',
    'export const drafts: Partial<ExerciseSeed>[] = [',
  ];

  for (const { seed, notes } of drafts) {
    lines.push(...notes.map((note) => `  // ${note}`));
    lines.push('  {');
    for (const [key, value] of Object.entries(seed)) {
      lines.push(`    ${key}: ${JSON.stringify(value)},`);
    }
    lines.push('  },');
  }

  lines.push('];', '');
  return lines.join('\n');
}
