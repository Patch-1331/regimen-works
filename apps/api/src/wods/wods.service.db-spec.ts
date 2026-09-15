import type { PrismaService } from '../prisma/prisma.service';
import { testPrisma } from '../test-support/database';
import { createExercise, createWod } from '../test-support/fixtures';
import { WodsService } from './wods.service';

/**
 * The WOD library and the warm-up/cool-down checklists (DN-99, DN-107).
 *
 * Both methods here are almost entirely query. The selection rules the
 * checklists follow are pure and live in `checklist.logic.spec.ts`; what is
 * tested here is the half that file cannot see — which rows the query hands
 * it, which columns come with them, and what order anything arrives in.
 */

function service(): WodsService {
  return new WodsService(testPrisma() as unknown as PrismaService);
}

/** A phase-tagged exercise: the pool `getChecklists` draws from. */
function createPhaseExercise(
  phase: string,
  overrides: Record<string, unknown> = {},
) {
  return createExercise({ phase, ...overrides });
}

describe('WodsService.findAll', () => {
  it('lists the library alphabetically', async () => {
    await createWod({ name: 'Fran' });
    await createWod({ name: 'Angie' });
    await createWod({ name: 'Cindy' });

    expect((await service().findAll()).map((wod) => wod.name)).toEqual([
      'Angie',
      'Cindy',
      'Fran',
    ]);
  });

  it("puts each WOD's movements in the order they are performed", async () => {
    // Created back to front, so a result that happens to be in insertion
    // order is not mistaken for one that is ordered.
    const [first, second, third] = [
      await createExercise({ name: 'Thruster' }),
      await createExercise({ name: 'Pull-up' }),
      await createExercise({ name: 'Box jump' }),
    ];
    await createWod({
      name: 'Fran',
      movements: [
        { exerciseId: third.id, reps: 10, order: 2 },
        { exerciseId: first.id, reps: 21, order: 0 },
        { exerciseId: second.id, reps: 21, order: 1 },
      ],
    });

    const [wod] = await service().findAll();

    expect(wod.movements.map((m) => m.order)).toEqual([0, 1, 2]);
    expect(wod.movements.map((m) => m.exercise.name)).toEqual([
      'Thruster',
      'Pull-up',
      'Box jump',
    ]);
  });

  it('carries the exercise on each movement, not just its id', async () => {
    // The screens render the movement's name; without the include they would
    // have only a foreign key and no way to spend another query on it.
    const exercise = await createExercise({ name: 'Wall ball' });
    await createWod({
      movements: [{ exerciseId: exercise.id, reps: 20, order: 0 }],
    });

    const [wod] = await service().findAll();

    expect(wod.movements[0].exercise).toMatchObject({
      id: exercise.id,
      name: 'Wall ball',
    });
  });

  it('is empty before anything is seeded', async () => {
    expect(await service().findAll()).toEqual([]);
  });
});

describe('WodsService.getChecklists', () => {
  it('splits the pool by phase', async () => {
    await createPhaseExercise('warmup', { name: 'Arm circles' });
    await createPhaseExercise('cooldown', { name: 'Couch stretch' });

    const { warmup, cooldown } = await service().getChecklists('push');

    expect(warmup.map((e) => e.name)).toEqual(['Arm circles']);
    expect(cooldown.map((e) => e.name)).toEqual(['Couch stretch']);
  });

  it('never offers an untagged exercise', async () => {
    // Every movement in the library is an untagged row, so this is the
    // property that keeps thrusters out of the warm-up.
    //
    // Guarded twice, and this test cannot tell which guard did it: the
    // service's `phase: { not: null }` narrows the query, and
    // `buildChecklist` filters by phase again on the way out. Deleting the
    // `where` leaves the answer identical and this test green -- it is there
    // to stop the library being fetched, not to change the result. The
    // contract is worth asserting either way.
    await createExercise({ name: 'Thruster' });
    await createPhaseExercise('warmup', { name: 'Arm circles' });

    const { warmup, cooldown } = await service().getChecklists('push');

    expect([...warmup, ...cooldown].map((e) => e.name)).toEqual([
      'Arm circles',
    ]);
  });

  it('brings the instructions along', async () => {
    // Part of the `select`, and the one column the checklist screens render
    // beyond the name -- an omission here reads as a checklist of bare titles.
    const stored = await createPhaseExercise('warmup', {
      name: 'Arm circles',
      instructions: 'Ten each way, slowly.',
    });

    const [move] = (await service().getChecklists('push')).warmup;

    expect(move).toEqual({
      id: stored.id,
      name: 'Arm circles',
      pattern: 'push',
      phase: 'warmup',
      instructions: 'Ten each way, slowly.',
    });
  });

  it("offers the moves that match the day's pattern before the generic ones", async () => {
    // The handoff to checklist.logic: the query is unordered, so this is the
    // service actually passing dominantPattern through rather than dropping it.
    await createPhaseExercise('warmup', { name: 'Generic', pattern: null });
    await createPhaseExercise('warmup', {
      name: 'Pull specific',
      pattern: 'pull',
    });

    const { warmup } = await service().getChecklists('pull');

    expect(warmup.map((e) => e.name)).toEqual(['Pull specific', 'Generic']);
  });

  it('answers with empty lists when nothing is tagged', async () => {
    expect(await service().getChecklists('push')).toEqual({
      warmup: [],
      cooldown: [],
    });
  });
});
