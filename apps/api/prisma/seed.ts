import 'dotenv/config';

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

import { GLOBAL_LIBRARY } from '../src/library/visible-to';
import { upsertJustWods } from '../src/programs/just-wods';
import { importLibrary } from '../src/seed/import-library';
import { importWods } from '../src/seed/import-wods';
import {
  assertSubstitutesReachable,
  assertSubstituteUnitsMatch,
} from '../src/seed/substitute-guard';
import { checklistEntries, entrySteps } from './checklist-seed';
import { loadLibrary } from './library';
import { wods } from './wod-seed';

// Prisma 7 requires a driver adapter — a bare `new PrismaClient()` throws at
// construction. Run directly by ts-node rather than through the Prisma CLI,
// so .env is loaded here too instead of being inherited from it.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is not set');

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

async function main() {
  // Built and checked before anything is written: the checksum, the
  // curation against the files it names, and every value against the enums.
  // A half-written library is worse than a refused one.
  const library = loadLibrary();
  const { exercises } = library;

  // Every movement needing equipment must have a one-step fall to a movement
  // needing none (DN-83). Nothing at runtime can report this -- the resolver
  // passes a gap through rather than throwing, so the athlete just gets a
  // movement they cannot do. The guard reads names; here the key is the name
  // that cannot drift.
  //
  // Only the curated: they are what the seeded WODs, groups and checklists
  // prescribe. The rest of the library comes in for the swap panel and has
  // no hand-written fallback; a muscle-matched one is DN-169's.
  const guarded = exercises
    .filter((e) => e.curated)
    .map((e) => ({ ...e, name: e.key }));
  assertSubstitutesReachable(guarded);
  assertSubstituteUnitsMatch(guarded);

  console.log('Importing the exercise library...');
  const { created, renamed, unchanged, idByKey } = await importLibrary(
    prisma,
    exercises,
  );
  console.log(`  ${created.length} new`);
  for (const name of created) console.log(`    ${name}`);
  console.log(`  ${renamed.length} renamed in place`);
  for (const change of renamed) console.log(`    ${change}`);
  console.log(`  ${unchanged} updated under the name they had`);
  console.log(`  ${library.leftOut.length} left out of the dataset:`);
  for (const { name, reason } of library.leftOut) {
    console.log(`    ${name}: ${reason}`);
  }
  // Kit the dataset's one equipment word left off, read from the steps
  // (DN-168). Per piece rather than per row: the rows are in the PR that
  // proposed them, and a correction in curation.ts overrides any of them.
  const added = new Map<string, number>();
  for (const { added: pieces } of library.hiddenKit) {
    for (const piece of pieces) added.set(piece, (added.get(piece) ?? 0) + 1);
  }
  console.log(
    `  ${library.hiddenKit.length} given kit their equipment word left off:`,
  );
  for (const [piece, count] of added) console.log(`    ${piece}: ${count}`);

  console.log('Seeding warm-up and cool-down lists...');
  for (const c of checklistEntries) {
    const exerciseId = idByKey.get(c.exercise);
    if (!exerciseId)
      throw new Error(
        `Unknown exercise "${c.exercise}" on the ${c.kind} checklist`,
      );
    const fields = { pattern: c.pattern, instructions: entrySteps(c) };

    // Found by hand for the reason the exercise loop is (DN-93): the global
    // tier's uniqueness is a partial index Prisma cannot name in a `where`.
    const existing = await prisma.checklistEntry.findFirst({
      where: { ...GLOBAL_LIBRARY, exerciseId, kind: c.kind },
      select: { id: true },
    });
    if (existing) {
      await prisma.checklistEntry.update({
        where: { id: existing.id },
        data: fields,
      });
    } else {
      await prisma.checklistEntry.create({
        data: { exerciseId, kind: c.kind, ...fields },
      });
    }
  }

  console.log('Seeding WOD library...');
  await importWods(prisma, wods, idByKey);

  // ScheduleRule and SkillLevel rows used to be seeded here, when they were
  // global singletons. They are per-user now, so UserProvisioningService
  // creates them on a user's first authenticated request instead -- this seed
  // runs at deploy time, when no user exists yet.
  //
  // Just WODs is library content like the WODs above -- global, admin-owned,
  // the same for everyone -- so the deploy keeps it current here (DN-13).
  //
  // UserProvisioningService creates these same rows if they are missing, and
  // that is not a duplicate of this loop but the other half of it: it cannot
  // wait for a seed that may not have run, and this cannot wait for a user
  // who may never sign in. The ids are shared, so whichever runs first wins
  // and the other is a no-op. The difference is that this one *updates*, so
  // a change to the definition reaches an existing deploy.
  //
  // It is the only program seeded. The first programs this once wrote beside
  // it were retired by migration (ADR 0006, decision 3); the global library is
  // authored in the app now, and a deploy must not undo an admin's edits.
  console.log('Seeding the Just WODs program...');
  await upsertJustWods(prisma);

  // Enrollments are not seeded. They are per-user rows, and the users this
  // would backfill are exactly the ones UserProvisioningService reaches on
  // their next authenticated request -- through the very code path that
  // enrolls a new athlete, rather than a second one written once and never
  // exercised again. An athlete who never signs in again gets no enrollment
  // and needs none, having no Today to render.
  console.log(
    `Done: ${exercises.length} exercises, ${checklistEntries.length} checklist entries, ${wods.length} WODs, 1 program.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
