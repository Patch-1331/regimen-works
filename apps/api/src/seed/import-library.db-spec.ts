import { loadLibrary } from '../../prisma/library';
import { testPrisma } from '../test-support/database';
import {
  createAssignment,
  createExercise,
  createSession,
  createSetLog,
  createSkillLevel,
  createUser,
} from '../test-support/fixtures';
import { importLibrary } from './import-library';

/**
 * The import against a real database (DN-167): what makes it safe to run
 * over production's rows rather than a fresh database.
 *
 * The rename is the case that matters. Production's rows were written by the
 * hand-written seed, under names like "Push-up", with athletes' sets and
 * choices pointing at them. The import has to turn that row into "Pushups"
 * where it stands (ADR-0007 decision 5); a new row would leave every logged
 * set on an orphan the library no longer shows.
 */

const { exercises } = loadLibrary();

/** A global row as the hand-written seed left it: a name, and no key. */
const legacyPushUp = () =>
  createExercise({ ownerId: null, key: null, name: 'Push-up' });

describe('importLibrary', () => {
  it('renames a seeded row in place, keeping its history and its choices', async () => {
    const userId = (await createUser()).id;
    const row = await legacyPushUp();
    const session = await createSession(
      userId,
      (await createAssignment(userId)).id,
    );
    const set = await createSetLog(userId, session.id, row.id);
    const choice = await createSkillLevel(userId, 'push_horizontal', row.id);

    const report = await importLibrary(testPrisma(), exercises);

    expect(report.renamed).toContain('Push-up -> Pushups');
    expect(report.idByKey.get('Pushups')).toBe(row.id);
    expect(
      await testPrisma().exercise.findUniqueOrThrow({ where: { id: row.id } }),
    ).toMatchObject({ key: 'Pushups', name: 'Pushups', ownerId: null });
    expect(
      (
        await testPrisma().workoutSetLog.findUniqueOrThrow({
          where: { id: set.id },
        })
      ).exerciseId,
    ).toBe(row.id);
    expect(
      (
        await testPrisma().skillLevel.findUniqueOrThrow({
          where: { id: choice.id },
        })
      ).exerciseId,
    ).toBe(row.id);
  });

  it('creates every exercise once into an empty library', async () => {
    const report = await importLibrary(testPrisma(), exercises);

    expect(report.created).toHaveLength(exercises.length);
    expect(await testPrisma().exercise.count()).toBe(exercises.length);
  });

  it('wires each fallback to the row its key names', async () => {
    const report = await importLibrary(testPrisma(), exercises);

    const goblet = await testPrisma().exercise.findUniqueOrThrow({
      where: { id: report.idByKey.get('Goblet_Squat')! },
    });
    expect(goblet.fallbackExerciseId).toBe(
      report.idByKey.get(
        exercises.find((e) => e.key === 'Goblet_Squat')!.fallback!,
      ),
    );
  });

  it('changes nothing on a second run', async () => {
    await legacyPushUp();
    const first = await importLibrary(testPrisma(), exercises);
    const count = await testPrisma().exercise.count();

    const second = await importLibrary(testPrisma(), exercises);

    expect(second.created).toEqual([]);
    expect(second.renamed).toEqual([]);
    expect(second.unchanged).toBe(exercises.length);
    expect(second.idByKey).toEqual(first.idByKey);
    expect(await testPrisma().exercise.count()).toBe(count);
  });

  it('brings a retired library row back rather than making a second', async () => {
    const row = await createExercise({
      ownerId: null,
      key: 'Pushups',
      name: 'Pushups',
      archivedAt: new Date(),
    });

    const report = await importLibrary(testPrisma(), exercises);

    expect(report.idByKey.get('Pushups')).toBe(row.id);
    expect(
      (await testPrisma().exercise.findUniqueOrThrow({ where: { id: row.id } }))
        .archivedAt,
    ).toBeNull();
  });

  it('never touches an athlete’s own exercise of the same name', async () => {
    // DN-93: every lookup is in the global tier. An athlete who wrote their
    // own "Push-up" keeps it exactly as they wrote it.
    const ownerId = (await createUser()).id;
    const mine = await createExercise({ ownerId, name: 'Push-up' });

    const report = await importLibrary(testPrisma(), exercises);

    expect(report.idByKey.get('Pushups')).not.toBe(mine.id);
    expect(
      await testPrisma().exercise.findUniqueOrThrow({ where: { id: mine.id } }),
    ).toMatchObject({ name: 'Push-up', key: null, ownerId });
  });
});
