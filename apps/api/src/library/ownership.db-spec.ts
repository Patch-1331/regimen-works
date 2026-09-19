import type { PrismaService } from '../prisma/prisma.service';
import { ExercisesService } from '../exercises/exercises.service';
import { MovementResolutionService } from '../scheduler/movement-resolution.service';
import { SchedulerService } from '../scheduler/scheduler.service';
import { testPrisma } from '../test-support/database';
import {
  createAssignment,
  createExercise,
  createUser,
  createWod,
} from '../test-support/fixtures';
import { WodsService } from '../wods/wods.service';

/**
 * The boundary between the two library tiers (DN-93), against a real database.
 *
 * The unit tests in `common/user-scoping.spec.ts` assert the shape of the
 * `where` each read is built with. These assert the consequence: that an
 * athlete's own content stays theirs, that the shared library stays shared,
 * and that the constraints holding both apart are the database's rather than
 * a convention the next write path can forget.
 *
 * Nothing can create a personal row through the API yet — DN-25/DN-26 build
 * those endpoints — so these tests write `ownerId` directly. That is the
 * point of landing the boundary first: it is provable before there is
 * anything to abuse it.
 */

function exercises(): ExercisesService {
  return new ExercisesService(testPrisma() as unknown as PrismaService);
}

function scheduler(): SchedulerService {
  const prisma = testPrisma() as unknown as PrismaService;
  return new SchedulerService(
    prisma,
    new WodsService(prisma),
    new MovementResolutionService(prisma),
  );
}

const TODAY = '2026-09-16';

describe('what an athlete can see', () => {
  it('lists the global library and their own, never another athlete’s', async () => {
    const [alice, bob] = [await createUser(), await createUser()];
    await createExercise({ name: 'Air squat' });
    await createExercise({ name: 'Alice sandbag clean', ownerId: alice.id });
    await createExercise({ name: 'Bob tyre flip', ownerId: bob.id });

    const listed = (await exercises().findAll(alice.id)).map((e) => e.name);

    expect(listed).toEqual(['Air squat', 'Alice sandbag clean']);
  });

  it('never schedules another athlete’s WOD', async () => {
    // The sharpest version of the leak: not a list an athlete could ignore,
    // but a workout the app hands them as their day's training.
    const [alice, bob] = [await createUser(), await createUser()];
    await createWod({ name: 'Bob’s Brutal Hour', ownerId: bob.id });

    await expect(scheduler().getToday(alice.id, TODAY)).rejects.toThrow();
  });

  it('schedules their own WOD as readily as a global one', async () => {
    // The other half, and the one a too-narrow scope would break: personal
    // content is meant to be usable, not merely invisible to everyone else.
    const alice = await createUser();
    await createWod({ name: 'Alice’s Own', ownerId: alice.id });

    const today = await scheduler().getToday(alice.id, TODAY);

    expect(today.assignment!.wod!.name).toBe('Alice’s Own');
  });
});

describe('names', () => {
  it('lets two athletes use the same name', async () => {
    const [alice, bob] = [await createUser(), await createUser()];
    await createExercise({ name: 'Push-up', ownerId: alice.id });

    await expect(
      createExercise({ name: 'Push-up', ownerId: bob.id }),
    ).resolves.toMatchObject({ name: 'Push-up' });
  });

  it('lets an athlete shadow a global name', async () => {
    // Allowed on purpose. Reserving every global name forever would mean an
    // admin seeding "Sandbag carry" makes unwritable an athlete's row of the
    // same name that their own history already references.
    const alice = await createUser();
    await createExercise({ name: 'Push-up' });

    await expect(
      createExercise({ name: 'Push-up', ownerId: alice.id }),
    ).resolves.toMatchObject({ name: 'Push-up' });
  });

  it('still refuses two global rows of the same name', async () => {
    // The guarantee that the compound unique key alone would have lost:
    // Postgres treats NULLs as distinct, so `@@unique([ownerId, name])` is
    // satisfied by two rows that both have no owner. The partial unique index
    // in the migration is what actually refuses this, and the seed's upsert
    // -- now a find-then-write -- depends on it.
    await createExercise({ name: 'Push-up' });

    await expect(createExercise({ name: 'Push-up' })).rejects.toThrow();
  });

  it('refuses two global WODs of the same name', async () => {
    await createWod({ name: 'Cindy' });

    await expect(createWod({ name: 'Cindy' })).rejects.toThrow();
  });
});

describe('deleting an athlete', () => {
  it('takes their library with them and leaves the shared one', async () => {
    const alice = await createUser();
    await createExercise({ name: 'Air squat' });
    await createExercise({ name: 'Alice sandbag clean', ownerId: alice.id });

    await testPrisma().user.delete({ where: { id: alice.id } });

    const remaining = await testPrisma().exercise.findMany({
      select: { name: true },
    });
    expect(remaining.map((e) => e.name)).toEqual(['Air squat']);
  });

  it('is not blocked by their own history pointing at their own WOD', async () => {
    // Two cascades fire from one delete -- the assignments via `userId`, the
    // WOD via `ownerId` -- and nothing orders them. The assignment's optional
    // FK defaults to SetNull, so whichever runs first the delete completes
    // rather than failing on a foreign key. Worth a test rather than a
    // comment: the order is the database's choice, not ours.
    const alice = await createUser();
    const wod = await createWod({ name: 'Alice’s Own', ownerId: alice.id });
    await createAssignment(alice.id, { wodId: wod.id, status: 'completed' });

    await expect(
      testPrisma().user.delete({ where: { id: alice.id } }),
    ).resolves.toMatchObject({ id: alice.id });

    expect(await testPrisma().wod.count()).toBe(0);
    expect(await testPrisma().dailyAssignment.count()).toBe(0);
  });
});
