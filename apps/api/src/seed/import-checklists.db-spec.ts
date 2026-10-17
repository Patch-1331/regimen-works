import { checklistEntries } from '../../prisma/checklist-seed';
import { loadLibrary } from '../../prisma/library';
import { testPrisma } from '../test-support/database';
import { createChecklistEntry, createExercise } from '../test-support/fixtures';
import { checklistKey, importChecklists } from './import-checklists';
import { importLibrary } from './import-library';

/**
 * The warm-up and cool-down seed against a real database (DN-151): the files
 * own the entries that carry a key (ADR 0010), and only those.
 */

const { exercises } = loadLibrary();

async function seedChecklists(entries = checklistEntries) {
  const { idByKey } = await importLibrary(testPrisma(), exercises);
  return {
    idByKey,
    report: await importChecklists(testPrisma(), entries, idByKey),
  };
}

const first = checklistEntries[0];

describe('importChecklists', () => {
  it('gives an already-deployed entry its key where it stands', async () => {
    const { idByKey } = await seedChecklists([]);
    const legacy = await createChecklistEntry(
      idByKey.get(first.exercise)!,
      first.kind,
      { ownerId: null, key: null },
    );

    await seedChecklists();

    expect(
      await testPrisma().checklistEntry.findUniqueOrThrow({
        where: { id: legacy.id },
      }),
    ).toMatchObject({ key: checklistKey(first), pattern: first.pattern });
    expect(await testPrisma().checklistEntry.count()).toBe(
      checklistEntries.length,
    );
  });

  it('changes nothing on a second run', async () => {
    await seedChecklists();
    const before = await testPrisma().checklistEntry.findMany({
      orderBy: { id: 'asc' },
    });

    const { report } = await seedChecklists();

    expect(report.removed).toEqual([]);
    expect(
      await testPrisma().checklistEntry.findMany({ orderBy: { id: 'asc' } }),
    ).toEqual(before);
  });

  it('removes an entry whose key has left the file, and no other', async () => {
    await seedChecklists();
    const keyless = await createChecklistEntry(
      (await createExercise({ ownerId: null })).id,
      'warmup',
      { ownerId: null, key: null },
    );

    const { report } = await seedChecklists(checklistEntries.slice(1));

    expect(report.removed).toEqual([checklistKey(first)]);
    expect(
      await testPrisma().checklistEntry.findFirst({
        where: { key: checklistKey(first) },
      }),
    ).toBeNull();
    expect(
      await testPrisma().checklistEntry.findUnique({
        where: { id: keyless.id },
      }),
    ).not.toBeNull();
  });
});
