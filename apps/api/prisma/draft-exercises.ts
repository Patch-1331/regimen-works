/**
 * Drafts `ExerciseSeed` entries from free-exercise-db for a person to curate
 * (DN-157).
 *
 *   npm run exercises:draft --workspace apps/api -- <exercises.json> [out.ts]
 *
 * Source: https://github.com/yuhonas/free-exercise-db, pinned at commit
 * f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5, file `dist/exercises.json`:
 *
 *   https://raw.githubusercontent.com/yuhonas/free-exercise-db/f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5/dist/exercises.json
 *
 * Released into the public domain under the Unlicense, so names and prose
 * can be copied and edited freely. Its images are not: the repository says
 * nothing about where they came from, so nothing here reads them.
 *
 * Nothing is fetched. The dataset is a local file passed in by path, and is
 * not committed -- the library is what gets committed, one curated group at
 * a time. Moving the pin means changing the commit and the checksum below
 * together.
 *
 * Writes a review module (default `prisma/exercise-drafts.generated.ts`,
 * git-ignored) and prints the summary. Never touches `exercise-seed.ts` or the
 * database.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { z } from 'zod';

import { draftExercises, renderDrafts } from '../src/seed/exercise-draft';
import { exercises } from './exercise-seed';

const PINNED_COMMIT = 'f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5';
/** sha256 of `dist/exercises.json` at `PINNED_COMMIT`. */
const PINNED_SHA256 =
  '5bb747e3fc658f095a60dcbf6d53c96627acdcc6ffb6fffde86f7e26995d40bf';

const sourceExercise = z.object({
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

const [input, output = resolve(__dirname, 'exercise-drafts.generated.ts')] =
  process.argv.slice(2);
if (!input) {
  console.error(
    'Usage: npm run exercises:draft --workspace apps/api -- <exercises.json> [out.ts]',
  );
  process.exit(1);
}

const raw = readFileSync(input);
const sha256 = createHash('sha256').update(raw).digest('hex');
if (sha256 !== PINNED_SHA256) {
  // Refused rather than warned: the header of the review file claims a
  // provenance, and a different file would make that claim false.
  console.error(
    `${input} is not free-exercise-db at ${PINNED_COMMIT} (sha256 ${sha256}).`,
  );
  process.exit(1);
}

const source = z.array(sourceExercise).parse(JSON.parse(raw.toString('utf8')));
const result = draftExercises(
  source,
  exercises.map((e) => e.name),
);

writeFileSync(
  output,
  renderDrafts(result, {
    source: `free-exercise-db@${PINNED_COMMIT} (Unlicense)`,
  }),
);

const reasons = new Map<string, number>();
for (const { reason } of result.skipped) {
  // Which piece of kit is worth knowing; which library name matched is not.
  const kind = reason.startsWith('equipment')
    ? reason
    : reason.replace(/ (as|of) ".*"$/, '');
  reasons.set(kind, (reasons.get(kind) ?? 0) + 1);
}
console.log(`${source.length} source entries`);
console.log(`${result.drafts.length} drafted -> ${output}`);
console.log(`${result.skipped.length} skipped:`);
for (const [kind, count] of [...reasons].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${count}  ${kind}`);
}
