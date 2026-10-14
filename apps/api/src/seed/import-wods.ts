import type { PrismaClient } from '@prisma/client';

import type { WodMovementSeed, WodSeed } from '../../prisma/wod-seed';
import { GLOBAL_LIBRARY } from '../library/visible-to';

/**
 * Resolves a seeded movement to the pair actually stored, and refuses
 * anything self-contradictory. The DB has a CHECK constraint saying the same
 * thing; this just fails at the group of seed data that's wrong rather than at
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

/**
 * Writes the seeded WODs as global rows, matching on name.
 *
 * A WOD that already stands keeps its movement rows, updated in place by
 * position (DN-175). Athletes' logged swaps point at those rows, and that
 * foreign key cascades: deleting and recreating them, as this loop once did,
 * took every swap on every seeded WOD with it on every deploy, whether or not
 * anything had changed. A movement the seed has dropped is still deleted --
 * the one cascade that is meant, since its swaps name a movement that is gone.
 *
 * Idempotent: a second run finds every WOD and movement and writes the same
 * values.
 */
export async function importWods(
  prisma: PrismaClient,
  wods: readonly WodSeed[],
  idByKey: ReadonlyMap<string, string>,
): Promise<void> {
  for (const w of wods) {
    assertUniformSchemes(w);
    const movements = w.movements.map((m, i) => ({
      ...movementCounts(m, w.name),
      order: i,
      exerciseId: idByKey.get(m.exercise)!,
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
      // Same as the exercise loop: re-seeding un-retires (DN-25).
      archivedAt: null,
    };

    // Scoped to the global tier for the same reason the exercise loop is
    // (DN-93): re-seeding must not reach into an athlete's own library.
    const existing = await prisma.wod.findFirst({
      where: { ...GLOBAL_LIBRARY, name: w.name },
      select: { id: true, movements: { select: { id: true, order: true } } },
    });

    if (!existing) {
      await prisma.wod.create({
        data: { name: w.name, ...fields, movements: { create: movements } },
      });
      continue;
    }

    await prisma.wod.update({ where: { id: existing.id }, data: fields });
    const idByOrder = new Map(existing.movements.map((m) => [m.order, m.id]));
    for (const m of movements) {
      const id = idByOrder.get(m.order);
      if (id) {
        await prisma.wodMovement.update({ where: { id }, data: m });
      } else {
        await prisma.wodMovement.create({
          data: { ...m, wodId: existing.id },
        });
      }
    }
    await prisma.wodMovement.deleteMany({
      where: { wodId: existing.id, order: { gte: movements.length } },
    });
  }
}
