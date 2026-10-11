import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PrismaService } from '../prisma/prisma.service';
import { testPrisma } from '../test-support/database';
import { createExercise, createUser } from '../test-support/fixtures';
import { ExercisesService } from './exercises.service';

/**
 * The fields the exercise library reads (DN-165, ADR-0007), against a real
 * database.
 *
 * Two rules here live only in the migration, because Prisma's schema can
 * state neither: the key is unique among global rows, and only global rows
 * carry one. A `prisma migrate dev` that drops them would compile and pass
 * every unit test, so these are the tests that notice.
 */

const MIGRATION = join(
  __dirname,
  '../../prisma/migrations/20261011000000_exercise_library_fields/migration.sql',
);

describe('Exercise.key', () => {
  it('is unique among global rows', async () => {
    await createExercise({ ownerId: null, key: 'Pushups' });

    await expect(
      createExercise({ ownerId: null, key: 'Pushups' }),
    ).rejects.toThrow(/Unique constraint|Exercise_key_global_key/);
  });

  it('stays taken when the row holding it is archived', async () => {
    // An identity does not stop being one when the row retires. Otherwise a
    // re-import would find no live row, create a second one for the same
    // exercise, and split its history in two.
    await createExercise({
      ownerId: null,
      key: 'Pushups',
      archivedAt: new Date(),
    });

    await expect(
      createExercise({ ownerId: null, key: 'Pushups' }),
    ).rejects.toThrow(/Unique constraint|Exercise_key_global_key/);
  });

  it('may be null on any number of global rows', async () => {
    // Every row the hand-written seed made has none until the import (DN-167)
    // gives it one.
    await createExercise({ ownerId: null, key: null });
    await createExercise({ ownerId: null, key: null });

    expect(
      await testPrisma().exercise.count({
        where: { ownerId: null, key: null },
      }),
    ).toBe(2);
  });

  it('is refused on an athlete-owned row', async () => {
    const alice = await createUser();

    await expect(
      createExercise({ ownerId: alice.id, key: 'rw-my-move' }),
    ).rejects.toThrow(/Exercise_key_global_only|check constraint/i);
  });

  it('is not written by the library editor', async () => {
    // The import owns the key; a write through the service has no way to set
    // one, and the row comes back with none.
    const alice = await createUser();
    const service = new ExercisesService(
      testPrisma() as unknown as PrismaService,
    );

    const hers = await service.create(
      { ownerId: alice.id },
      {
        name: 'Ring row',
        pattern: 'pull',
        equipment: [],
        scalable: false,
        unit: 'reps',
        instructions: ['Lean back.', 'Pull the rings to your chest.'],
        movementGroup: null,
        sortOrder: null,
        fallbackExerciseId: null,
      },
    );

    expect(hers.key).toBeNull();
    expect(hers.instructions).toEqual([
      'Lean back.',
      'Pull the rings to your chest.',
    ]);
  });
});

describe('the descriptive fields', () => {
  it('start empty on a row nobody has described', async () => {
    // What every row has until the import fills them, and what an
    // athlete-owned row keeps: the matcher reads empty as unmatchable.
    const row = await createExercise();

    expect(row).toMatchObject({
      instructions: [],
      primaryMuscles: [],
      secondaryMuscles: [],
      force: null,
      mechanic: null,
      level: null,
      category: null,
    });
  });

  it('store what the dataset says, prime mover first', async () => {
    const row = await createExercise({
      ownerId: null,
      key: 'Pushups',
      primaryMuscles: ['chest'],
      secondaryMuscles: ['shoulders', 'triceps'],
      force: 'push',
      mechanic: 'compound',
      level: 'beginner',
      category: 'strength',
    });

    const stored = await testPrisma().exercise.findUniqueOrThrow({
      where: { id: row.id },
    });
    expect(stored.primaryMuscles).toEqual(['chest']);
    expect(stored.secondaryMuscles).toEqual(['shoulders', 'triceps']);
    expect(stored.level).toBe('beginner');
  });
});

describe('the migration of existing instructions', () => {
  /**
   * The migration's own statements for the `instructions` column, run against
   * a probe table in the column's old shape. Read from the file rather than
   * restated, so what is tested is what deploys.
   */
  function instructionStatements(table: string): string[] {
    return readFileSync(MIGRATION, 'utf8')
      .replace(/--.*$/gm, '')
      .split(';')
      .map((statement) => statement.trim())
      .filter((statement) => statement.includes('"instructions"'))
      .map((statement) => statement.replaceAll('"Exercise"', `"${table}"`));
  }

  async function migrated(rows: (string | null)[]) {
    const prisma = testPrisma();
    const table = 'ExerciseInstructionsProbe';
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${table}"`);
    await prisma.$executeRawUnsafe(
      `CREATE TABLE "${table}" ("id" INT PRIMARY KEY, "instructions" TEXT)`,
    );
    for (const [id, prose] of rows.entries()) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "${table}" ("id", "instructions") VALUES ($1, $2)`,
        id,
        prose,
      );
    }

    const statements = instructionStatements(table);
    expect(statements).toHaveLength(3);
    for (const statement of statements) {
      await prisma.$executeRawUnsafe(statement);
    }

    const result = await prisma.$queryRawUnsafe<
      { id: number; instructions: string[] }[]
    >(`SELECT "id", "instructions" FROM "${table}" ORDER BY "id"`);
    await prisma.$executeRawUnsafe(`DROP TABLE "${table}"`);
    return result.map((r) => r.instructions);
  }

  it('keeps the prose of each row whole, as its one step', async () => {
    const prose =
      'Hands under your shoulders, body in a straight line from head to heels. Lower until your chest is a fist from the floor, then press back up.';

    expect(await migrated([prose])).toEqual([[prose]]);
  });

  it('turns no copy into no steps, rather than one empty step', async () => {
    expect(await migrated([null, '', '   '])).toEqual([[], [], []]);
  });
});
