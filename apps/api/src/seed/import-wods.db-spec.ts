import { loadLibrary } from '../../prisma/library';
import { wods, type WodSeed } from '../../prisma/wod-seed';
import { testPrisma } from '../test-support/database';
import {
  createAssignment,
  createUser,
  createWod,
} from '../test-support/fixtures';
import { importLibrary } from './import-library';
import { importWods } from './import-wods';

/**
 * The WOD seed against a real database (DN-175): what makes it safe to run
 * on every deploy, over rows athletes' history points at.
 *
 * A logged swap is keyed by the `WodMovement` the athlete tapped, and that
 * foreign key cascades. So re-seeding a WOD must update its movements where
 * they stand: deleting and recreating them, as the seed once did, took every
 * athlete's swaps on that WOD with them, on every deploy.
 */

const { exercises } = loadLibrary();

async function seedLibrary(library: readonly WodSeed[] = wods) {
  const { idByKey } = await importLibrary(testPrisma(), exercises);
  return importWods(testPrisma(), library, idByKey);
}

function movementsOf(name: string) {
  return testPrisma().wodMovement.findMany({
    where: { wod: { name, ownerId: null } },
    orderBy: { order: 'asc' },
  });
}

/** A copy of the first seeded WOD, with its movements changed by `edit`. */
function editedFirstWod(
  edit: (movements: WodSeed['movements']) => WodSeed['movements'],
): WodSeed[] {
  const [head, ...rest] = wods;
  return [
    { ...head, movements: edit(head.movements.map((m) => ({ ...m }))) },
    ...rest,
  ];
}

/** The WOD the tests edit. Its first movement must be a flat count; the second test checks. */
const first = wods[0];

describe('importWods', () => {
  it('keeps an athlete’s logged swap when the library is seeded again', async () => {
    await seedLibrary();
    const [movement] = await movementsOf(first.name);
    const userId = (await createUser()).id;
    const assignment = await createAssignment(userId, {
      wodId: movement.wodId,
    });
    const swap = await testPrisma().assignmentSubstitution.create({
      data: {
        userId,
        assignmentId: assignment.id,
        wodMovementId: movement.id,
        exerciseId: movement.exerciseId,
      },
    });

    await seedLibrary();

    expect(
      await testPrisma().assignmentSubstitution.findUnique({
        where: { id: swap.id },
      }),
    ).toMatchObject({ wodMovementId: movement.id });
  });

  it('applies a changed movement to the row that already stands', async () => {
    await seedLibrary();
    const [before] = await movementsOf(first.name);
    expect(first.movements[0].reps).toBeDefined();

    await seedLibrary(
      editedFirstWod(([m, ...rest]) => [{ ...m, reps: m.reps! + 1 }, ...rest]),
    );

    const [after] = await movementsOf(first.name);
    expect(after).toMatchObject({ id: before.id, reps: before.reps + 1 });
  });

  it('adds a movement the seed appended, and deletes one it dropped', async () => {
    await seedLibrary();
    const before = await movementsOf(first.name);

    await seedLibrary(editedFirstWod((ms) => [...ms, { ...ms[0], reps: 1 }]));
    const grown = await movementsOf(first.name);
    expect(grown).toHaveLength(before.length + 1);
    expect(grown.slice(0, before.length).map((m) => m.id)).toEqual(
      before.map((m) => m.id),
    );

    await seedLibrary(editedFirstWod((ms) => ms.slice(0, 1)));
    const shrunk = await movementsOf(first.name);
    expect(shrunk.map((m) => m.id)).toEqual([before[0].id]);
  });

  it('changes nothing on a second run', async () => {
    await seedLibrary();
    const ids = (await testPrisma().wodMovement.findMany()).map((m) => m.id);

    expect(await seedLibrary()).toEqual({ retired: [] });

    expect(
      (await testPrisma().wodMovement.findMany()).map((m) => m.id).sort(),
    ).toEqual(ids.sort());
    expect(await testPrisma().wod.count()).toBe(wods.length);
  });

  // DN-151: the rows already deployed have no key. The first run finds each
  // by the name it has today and gives it one, so nothing is recreated.
  it('gives an already-deployed WOD its key where it stands', async () => {
    const legacy = await createWod({
      ownerId: null,
      key: null,
      name: first.name,
    });

    await seedLibrary();

    expect(
      await testPrisma().wod.findUniqueOrThrow({ where: { id: legacy.id } }),
    ).toMatchObject({ key: first.key, name: first.name, archivedAt: null });
    expect(await testPrisma().wod.count()).toBe(wods.length);
  });

  it('renames a WOD in place by its key', async () => {
    await seedLibrary();
    const before = await testPrisma().wod.findFirstOrThrow({
      where: { key: first.key },
    });

    await seedLibrary([
      { ...first, name: 'Renamed in the file' },
      ...wods.slice(1),
    ]);

    expect(
      await testPrisma().wod.findUniqueOrThrow({ where: { id: before.id } }),
    ).toMatchObject({ key: first.key, name: 'Renamed in the file' });
  });

  // ADR 0010: leaving the file is how a seeded WOD retires, and a WOD with no
  // key is an admin's, which the deploy never archives.
  it('retires a WOD whose key has left the file, and no other', async () => {
    await seedLibrary();
    const admins = await createWod({ ownerId: null, key: null });

    const report = await seedLibrary(wods.slice(1));

    expect(report.retired).toEqual([first.name]);
    const archivedAt = async (where: { key: string } | { id: string }) =>
      (await testPrisma().wod.findFirstOrThrow({ where })).archivedAt;
    expect(await archivedAt({ key: first.key })).not.toBeNull();
    expect(await archivedAt({ id: admins.id })).toBeNull();

    // And putting it back brings it back.
    await seedLibrary();
    expect(await archivedAt({ key: first.key })).toBeNull();
  });
});
