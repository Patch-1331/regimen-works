import type { PrismaClient } from '@prisma/client';

import { GLOBAL_LIBRARY } from '../library/visible-to';
import type { LibraryExercise } from './library';

/** What one run of the import did, for the deploy log. */
export type ImportReport = {
  created: string[];
  /** `Old name -> New name`, for each row renamed in place. */
  renamed: string[];
  /** Rows that already had their key and name. */
  unchanged: number;
  /** Every exercise's row id, by key, for whatever is seeded next. */
  idByKey: Map<string, string>;
};

/**
 * Writes the library's exercises as global rows (DN-167), matching on `key`.
 *
 * A row is found by its key, and the first time -- before any row has one --
 * by the name it has today: `formerly` for a dataset twin that takes the
 * dataset's name, its own name otherwise. That one lookup is what makes a
 * rename happen *in place*: the row keeps its primary key, so logged sets,
 * remembered choices, WOD movements and program slots all keep pointing at
 * it (ADR-0007 decision 5). Upserting by name, as the hand-written seed did,
 * would have made every rename a new row and orphaned the old one's history.
 *
 * Every lookup is scoped to the global tier (DN-93): the import must never
 * resolve a name to an athlete's own exercise and overwrite it, or wire a
 * global fallback to it.
 *
 * Idempotent: a second run finds every row by key and writes the same values.
 */
export async function importLibrary(
  prisma: PrismaClient,
  exercises: readonly LibraryExercise[],
): Promise<ImportReport> {
  const report: ImportReport = {
    created: [],
    renamed: [],
    unchanged: 0,
    idByKey: new Map(),
  };

  for (const e of exercises) {
    const fields = {
      key: e.key,
      name: e.name,
      pattern: e.pattern,
      equipment: e.equipment,
      scalable: e.scalable,
      unit: e.unit,
      movementGroup: e.movementGroup,
      sortOrder: e.sortOrder,
      isGroupDefault: e.isGroupDefault,
      instructions: e.instructions,
      primaryMuscles: e.primaryMuscles,
      secondaryMuscles: e.secondaryMuscles,
      force: e.force,
      mechanic: e.mechanic,
      level: e.level,
      category: e.category,
      curated: e.curated,
      // Re-seeding a retired movement brings it back (DN-25). Neither lookup
      // filters on `archivedAt`: a retired row still holds its key and its
      // name, so skipping it would mean creating a second one.
      archivedAt: null,
    };

    const existing =
      (await prisma.exercise.findFirst({
        where: { ...GLOBAL_LIBRARY, key: e.key },
        select: { id: true, name: true },
      })) ??
      (await prisma.exercise.findFirst({
        where: { ...GLOBAL_LIBRARY, key: null, name: e.formerly ?? e.name },
        select: { id: true, name: true },
      }));

    if (!existing) {
      const row = await prisma.exercise.create({ data: fields });
      report.created.push(e.name);
      report.idByKey.set(e.key, row.id);
      continue;
    }

    await prisma.exercise.update({ where: { id: existing.id }, data: fields });
    if (existing.name !== e.name) {
      report.renamed.push(`${existing.name} -> ${e.name}`);
    } else {
      report.unchanged += 1;
    }
    report.idByKey.set(e.key, existing.id);
  }

  // Second pass: a fallback can name an exercise written after it.
  for (const e of exercises) {
    if (e.fallback === undefined) continue;
    await prisma.exercise.update({
      where: { id: report.idByKey.get(e.key)! },
      data: { fallbackExerciseId: report.idByKey.get(e.fallback)! },
    });
  }

  return report;
}
