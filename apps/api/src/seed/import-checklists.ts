import type { PrismaClient } from '@prisma/client';

import type { ChecklistEntrySeed } from '../../prisma/checklist-seed';
import { entrySteps } from '../../prisma/checklist-seed';
import { GLOBAL_LIBRARY } from '../library/visible-to';

/**
 * An entry's stable identity (DN-151): which list, and the exercise's own
 * key. Both are stable, so the key is derived rather than written into the
 * seed -- and one movement is on each list at most once, so the pair is
 * already unique.
 */
export function checklistKey(
  c: Pick<ChecklistEntrySeed, 'kind' | 'exercise'>,
): string {
  return `${c.kind}/${c.exercise}`;
}

/** What one run of the checklist import did, for the deploy log. */
export type ChecklistImportReport = {
  /** Keys of the entries removed because they left `checklist-seed.ts`. */
  removed: string[];
};

/**
 * Writes the warm-up and cool-down lists as global entries, matching on
 * `key` (DN-151), and the first time by the exercise and list the entry is
 * on -- which is how the keys arrive on the entries already deployed.
 *
 * The files own every entry that carries a key (ADR 0010), so one whose key
 * has left `checklist-seed.ts` is deleted. Deleted, not archived: an entry is
 * a pointer at a movement with no history of its own, and nothing refers to
 * it. An entry with no key is not the seed's, and is never touched.
 *
 * Idempotent: a second run finds every entry by key and writes the same
 * values.
 */
export async function importChecklists(
  prisma: PrismaClient,
  entries: readonly ChecklistEntrySeed[],
  idByKey: ReadonlyMap<string, string>,
): Promise<ChecklistImportReport> {
  for (const c of entries) {
    const exerciseId = idByKey.get(c.exercise);
    if (!exerciseId)
      throw new Error(
        `Unknown exercise "${c.exercise}" on the ${c.kind} checklist`,
      );
    const key = checklistKey(c);
    const fields = { key, pattern: c.pattern, instructions: entrySteps(c) };

    // Found by hand for the reason the exercise loop is (DN-93): the global
    // tier's uniqueness is a partial index Prisma cannot name in a `where`.
    const existing =
      (await prisma.checklistEntry.findFirst({
        where: { ...GLOBAL_LIBRARY, key },
        select: { id: true },
      })) ??
      (await prisma.checklistEntry.findFirst({
        where: { ...GLOBAL_LIBRARY, key: null, exerciseId, kind: c.kind },
        select: { id: true },
      }));
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

  const leaving = {
    ...GLOBAL_LIBRARY,
    key: { not: null, notIn: entries.map(checklistKey) },
  };
  const removed = await prisma.checklistEntry.findMany({
    where: leaving,
    select: { key: true },
    orderBy: { key: 'asc' },
  });
  await prisma.checklistEntry.deleteMany({ where: leaving });
  return { removed: removed.map((e) => e.key!) };
}
