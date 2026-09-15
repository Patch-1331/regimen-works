import type { PrismaService } from '../prisma/prisma.service';
import { testPrisma } from '../test-support/database';
import { createExercise, createLadder } from '../test-support/fixtures';
import { ExercisesService } from './exercises.service';

/**
 * The movement library the swap screen lists (DN-99, DN-108).
 *
 * One query, and both halves of it matter to the screen: the order it renders
 * in, and the no-equipment alternative hanging off each row.
 */

function service(): ExercisesService {
  return new ExercisesService(testPrisma() as unknown as PrismaService);
}

describe('ExercisesService.findAll', () => {
  it('lists the library alphabetically', async () => {
    await createExercise({ name: 'Thruster' });
    await createExercise({ name: 'Air squat' });
    await createExercise({ name: 'Pull-up' });

    expect((await service().findAll()).map((e) => e.name)).toEqual([
      'Air squat',
      'Pull-up',
      'Thruster',
    ]);
  });

  it('carries the alternative movement, not just its id', async () => {
    // What the swap screen offers an athlete without the equipment. Without
    // the include it would have a foreign key and nothing to show.
    const { rungs, alt } = await createLadder('pull', ['Pull-up'], {
      altFor: 0,
    });

    const listed = (await service().findAll()).find(
      (e) => e.id === rungs[0].id,
    );

    expect(listed?.altExercise).toMatchObject({
      id: alt!.id,
      name: alt!.name,
    });
  });

  it('leaves altExercise null on a movement that needs no substitute', async () => {
    const exercise = await createExercise({ name: 'Air squat' });

    const listed = (await service().findAll()).find(
      (e) => e.id === exercise.id,
    );

    expect(listed?.altExercise).toBeNull();
  });

  it('is empty before anything is seeded', async () => {
    expect(await service().findAll()).toEqual([]);
  });
});
