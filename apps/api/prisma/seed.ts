import 'dotenv/config';

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

import { GLOBAL_LIBRARY } from '../src/library/visible-to';
import {
  assertSubstitutesReachable,
  assertSubstituteUnitsMatch,
} from '../src/seed/substitute-guard';
import { exercises } from './exercise-seed';
import { wods, type WodMovementSeed, type WodSeed } from './wod-seed';

// Prisma 7 requires a driver adapter — a bare `new PrismaClient()` throws at
// construction. Run directly by ts-node rather than through the Prisma CLI,
// so .env is loaded here too instead of being inherited from it.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is not set');

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

/**
 * Resolves a seeded movement to the pair actually stored, and refuses
 * anything self-contradictory. The DB has a CHECK constraint saying the same
 * thing; this just fails at the line of seed data that's wrong rather than at
 * the insert.
 */
function movementCounts(
  m: WodMovementSeed,
  wodName: string,
): { reps: number; repScheme: number[] } {
  const repScheme = m.repScheme ?? [];
  if (repScheme.length > 0) {
    const total = repScheme.reduce((sum, r) => sum + r, 0);
    if (m.reps !== undefined && m.reps !== total) {
      throw new Error(
        `"${wodName}" / ${m.exercise}: reps ${m.reps} doesn't match repScheme total ${total}`,
      );
    }
    return { reps: total, repScheme };
  }
  if (m.reps === undefined) {
    throw new Error(`"${wodName}" / ${m.exercise}: needs reps or repScheme`);
  }
  return { reps: m.reps, repScheme: [] };
}

/** A ladder is one shape for the whole WOD, so every scheme in it is the same length. */
function assertUniformSchemes(w: WodSeed): void {
  const lengths = w.movements
    .map((m) => m.repScheme?.length ?? 0)
    .filter((n) => n > 0);
  if (new Set(lengths).size > 1) {
    throw new Error(`"${w.name}": repSchemes of differing lengths`);
  }
}

async function main() {
  // Before anything is written: every movement needing equipment must have a
  // one-step fall to a movement needing none (DN-83). Nothing at runtime can
  // report this -- the resolver passes a gap through rather than throwing, so
  // the athlete just gets a movement they cannot do -- and a half-written
  // seed is worse than a refused one.
  assertSubstitutesReachable(exercises);
  assertSubstituteUnitsMatch(exercises);

  console.log('Seeding exercises...');
  const idByName = new Map<string, string>();

  for (const e of exercises) {
    const fields = {
      pattern: e.pattern,
      equipment: e.equipment ?? [],
      scalable: e.scalable ?? false,
      unit: e.unit ?? 'reps',
      line: e.line ?? null,
      rung: e.rung ?? null,
      phase: e.phase ?? null,
      instructions: e.instructions,
      // Re-seeding a retired movement brings it back (DN-25). The lookup
      // below deliberately does not filter on `archivedAt`: archiving does
      // not free the name, so skipping archived rows would make this try to
      // create a name the unique index still holds and fail the deploy.
      archivedAt: null,
    };

    // Not an upsert any more (DN-93). `name` is no longer unique on its own,
    // and Prisma types the `ownerId_name` compound key's `ownerId` as a plain
    // string -- there is no way to say "the row named X with no owner" in a
    // unique `where` at all. So the global row is found by hand, and the
    // uniqueness this relied on is enforced by the partial unique index in
    // the migration instead of by this lookup.
    //
    // The `ownerId: null` here is load-bearing beyond the lookup: it is what
    // stops the seed resolving a name to an athlete's own exercise and then
    // wiring a global row's `altExerciseId` to it, which would let one
    // athlete's delete break everyone's scheduler.
    const existing = await prisma.exercise.findFirst({
      where: { ...GLOBAL_LIBRARY, name: e.name },
      select: { id: true },
    });

    const row = existing
      ? await prisma.exercise.update({
          where: { id: existing.id },
          data: fields,
        })
      : await prisma.exercise.create({ data: { name: e.name, ...fields } });

    idByName.set(e.name, row.id);
  }

  for (const e of exercises) {
    if (!e.alt) continue;
    const altId = idByName.get(e.alt);
    if (!altId)
      throw new Error(`Unknown alt exercise "${e.alt}" for "${e.name}"`);
    await prisma.exercise.update({
      where: { id: idByName.get(e.name)! },
      data: { altExerciseId: altId },
    });
  }

  console.log('Seeding WOD library...');
  for (const w of wods) {
    assertUniformSchemes(w);
    const movements = w.movements.map((m, i) => ({
      ...movementCounts(m, w.name),
      order: i,
      exercise: { connect: { id: idByName.get(m.exercise)! } },
    }));

    const fields = {
      type: w.type,
      timeCapMinutes: w.timeCapMinutes,
      rounds: w.rounds,
      workSeconds: w.workSeconds ?? null,
      restSeconds: w.restSeconds ?? null,
      intervalCount: w.intervalCount ?? null,
      isNamed: w.isNamed,
      dominantPattern: w.dominantPattern,
      description: w.description ?? null,
      movements: { create: movements },
      // Same as the exercise loop: re-seeding un-retires (DN-25).
      archivedAt: null,
    };

    // Scoped to the global tier for the same reason the exercise loop is
    // (DN-93): re-seeding must not reach into an athlete's own library.
    const existing = await prisma.wod.findFirst({
      where: { ...GLOBAL_LIBRARY, name: w.name },
      select: { id: true },
    });

    if (existing) {
      await prisma.wodMovement.deleteMany({ where: { wodId: existing.id } });
      await prisma.wod.update({ where: { id: existing.id }, data: fields });
    } else {
      await prisma.wod.create({ data: { name: w.name, ...fields } });
    }
  }

  // ScheduleRule and SkillLevel rows used to be seeded here, when they were
  // global singletons. They are per-user now, so UserProvisioningService
  // creates them on a user's first authenticated request instead — this seed
  // runs at deploy time, when no user exists yet. Only the shared catalogue
  // (exercises and WODs) belongs here.
  console.log(`Done: ${exercises.length} exercises, ${wods.length} WODs.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
