import { NotFoundException } from '@nestjs/common';
import {
  LIBRARY_PAGE_SIZE,
  exerciseSearchQuerySchema,
} from '@regimen-works/shared';
import type { PrismaService } from '../prisma/prisma.service';
import { testPrisma } from '../test-support/database';
import { createExercise, createUser } from '../test-support/fixtures';
import { ExercisesService } from './exercises.service';

/**
 * The library page's search, the retired list and the detail view (DN-171).
 *
 * Against Postgres rather than a recorded query, because what is under test
 * is what the filters *mean* -- an array `has`, a case-insensitive contains,
 * a page boundary -- and only the database can say what those return.
 */

function service(): ExercisesService {
  return new ExercisesService(testPrisma() as unknown as PrismaService);
}

/** The query as the controller hands it over, defaults filled in. */
const query = (raw: Record<string, string> = {}) =>
  exerciseSearchQuerySchema.parse(raw);

async function search(userId: string, raw: Record<string, string> = {}) {
  return service().search(userId, query(raw));
}

const names = (page: { items: { name: string }[] }) =>
  page.items.map((e) => e.name);

describe('ExercisesService.search (DN-171)', () => {
  it('finds by part of the name, in any case', async () => {
    const user = await createUser();
    await createExercise({ name: 'Decline push-up' });
    await createExercise({ name: 'Pike Push-Up' });
    await createExercise({ name: 'Air squat' });

    expect(names(await search(user.id, { q: 'PUSH' }))).toEqual([
      'Decline push-up',
      'Pike Push-Up',
    ]);
  });

  it('filters by a muscle, as a prime mover or otherwise', async () => {
    const user = await createUser();
    await createExercise({
      name: 'Close-grip push-up',
      primaryMuscles: ['triceps'],
    });
    await createExercise({
      name: 'Push-up',
      primaryMuscles: ['chest'],
      secondaryMuscles: ['triceps'],
    });
    await createExercise({ name: 'Air squat', primaryMuscles: ['quadriceps'] });

    expect(names(await search(user.id, { muscle: 'triceps' }))).toEqual([
      'Close-grip push-up',
      'Push-up',
    ]);
  });

  it('filters by a piece of equipment the movement needs', async () => {
    const user = await createUser();
    await createExercise({ name: 'Goblet squat', equipment: ['kettlebell'] });
    await createExercise({
      name: 'Kettlebell swing',
      equipment: ['kettlebell'],
    });
    await createExercise({ name: 'Air squat', equipment: [] });

    expect(names(await search(user.id, { equipment: 'kettlebell' }))).toEqual([
      'Goblet squat',
      'Kettlebell swing',
    ]);
  });

  it.each([
    [
      'category',
      'stretching',
      { category: 'stretching' },
      { category: 'strength' },
    ],
    ['level', 'expert', { level: 'expert' }, { level: 'beginner' }],
    ['pattern', 'hinge', { pattern: 'hinge' }, { pattern: 'squat' }],
  ])('filters by %s', async (key, value, match, miss) => {
    const user = await createUser();
    await createExercise({ name: 'Wanted', ...match });
    await createExercise({ name: 'Not wanted', ...miss });

    expect(names(await search(user.id, { [key]: value }))).toEqual(['Wanted']);
  });

  it('combines filters with AND', async () => {
    const user = await createUser();
    await createExercise({
      name: 'Push-up',
      primaryMuscles: ['chest'],
      level: 'beginner',
    });
    await createExercise({
      name: 'Archer push-up',
      primaryMuscles: ['chest'],
      level: 'expert',
    });
    await createExercise({
      name: 'Pistol squat',
      primaryMuscles: ['quadriceps'],
      level: 'expert',
    });

    expect(
      names(await search(user.id, { muscle: 'chest', level: 'expert' })),
    ).toEqual(['Archer push-up']);
  });

  describe('only what I own', () => {
    async function kit() {
      await createExercise({ name: 'Air squat', equipment: [] });
      await createExercise({ name: 'Pull-up', equipment: ['bar'] });
      await createExercise({ name: 'Goblet squat', equipment: ['kettlebell'] });
      await createExercise({
        name: 'Dumbbell bench press',
        equipment: ['dumbbell', 'bench'],
      });
    }

    it("keeps only what the athlete's equipment covers, every piece of it", async () => {
      const user = await createUser();
      await testPrisma().scheduleRule.create({
        data: { userId: user.id, equipment: ['dumbbell'] },
      });
      await kit();

      // A dumbbell without the bench is not enough for the bench press.
      expect(names(await search(user.id, { owned: 'true' }))).toEqual([
        'Air squat',
      ]);
    });

    it('reads no schedule rule as the baseline kit, not as owning nothing', async () => {
      const user = await createUser();
      await kit();

      expect(names(await search(user.id, { owned: 'true' }))).toEqual([
        'Air squat',
        'Pull-up',
      ]);
    });

    it('offers the whole library when it is off', async () => {
      const user = await createUser();
      await kit();

      expect((await search(user.id, { owned: 'false' })).total).toBe(4);
    });
  });

  describe('paging', () => {
    async function library(count: number) {
      for (let i = 0; i < count; i++) {
        await createExercise({
          name: `Movement ${String(i).padStart(2, '0')}`,
        });
      }
    }

    it('holds one page of rows and counts them all', async () => {
      const user = await createUser();
      await library(LIBRARY_PAGE_SIZE + 3);

      const first = await search(user.id);
      expect(first.items).toHaveLength(LIBRARY_PAGE_SIZE);
      expect(first).toMatchObject({
        total: LIBRARY_PAGE_SIZE + 3,
        page: 1,
        pageSize: LIBRARY_PAGE_SIZE,
      });
    });

    it('carries on where the last page stopped, by name', async () => {
      const user = await createUser();
      await library(LIBRARY_PAGE_SIZE + 3);

      const first = await search(user.id);
      const second = await search(user.id, { page: '2' });
      expect(names(second)).toEqual([
        'Movement 25',
        'Movement 26',
        'Movement 27',
      ]);
      expect(names(first)).not.toContain('Movement 25');
    });

    it('answers a page past the end with nothing, not an error', async () => {
      const user = await createUser();
      await library(2);

      expect(await search(user.id, { page: '9' })).toMatchObject({
        items: [],
        total: 2,
      });
    });

    it('counts what the filters kept, not the library', async () => {
      const user = await createUser();
      await library(4);
      await createExercise({ name: 'Plank', unit: 'seconds' });

      expect((await search(user.id, { q: 'plank' })).total).toBe(1);
    });
  });

  describe('scoping', () => {
    it("offers the athlete's own movements beside the shared ones", async () => {
      const user = await createUser();
      await createExercise({ name: 'Shared squat' });
      await createExercise({ name: 'My squat', ownerId: user.id });

      expect(names(await search(user.id, { q: 'squat' }))).toEqual([
        'My squat',
        'Shared squat',
      ]);
    });

    it("never offers another athlete's, whatever the filters", async () => {
      // The muscle filter is an OR; spread over the ownership OR it would
      // replace it, and this row would come back.
      const user = await createUser();
      const stranger = await createUser();
      await createExercise({
        name: 'Their push-up',
        ownerId: stranger.id,
        primaryMuscles: ['chest'],
      });

      expect(await search(user.id, { muscle: 'chest' })).toMatchObject({
        items: [],
        total: 0,
      });
    });

    it('leaves retired movements out', async () => {
      const user = await createUser();
      await createExercise({ name: 'Retired squat', archivedAt: new Date() });

      expect((await search(user.id)).total).toBe(0);
    });
  });
});

describe('ExercisesService.retired (DN-171)', () => {
  it("lists the athlete's retired movements and the shared ones, nobody else's", async () => {
    const user = await createUser();
    const stranger = await createUser();
    await createExercise({ name: 'Live squat' });
    await createExercise({
      name: 'My old lunge',
      ownerId: user.id,
      archivedAt: new Date(),
    });
    await createExercise({ name: 'Old shared row', archivedAt: new Date() });
    await createExercise({
      name: 'Their old lunge',
      ownerId: stranger.id,
      archivedAt: new Date(),
    });

    expect((await service().retired(user.id)).map((e) => e.name)).toEqual([
      'My old lunge',
      'Old shared row',
    ]);
  });
});

describe('ExercisesService.findOne (DN-171)', () => {
  it('loads a shared movement with its alternative', async () => {
    const user = await createUser();
    const fallback = await createExercise({ name: 'Row under table' });
    const pullUp = await createExercise({
      name: 'Pull-up',
      fallbackExerciseId: fallback.id,
    });

    expect(await service().findOne(user.id, pullUp.id)).toMatchObject({
      name: 'Pull-up',
      fallbackExercise: { id: fallback.id, name: 'Row under table' },
    });
  });

  it('still loads a retired one, so a link to it says so', async () => {
    const user = await createUser();
    const retired = await createExercise({
      name: 'Old squat',
      archivedAt: new Date(),
    });

    expect(
      (await service().findOne(user.id, retired.id)).archivedAt,
    ).not.toBeNull();
  });

  it("is a 404 for another athlete's movement", async () => {
    const user = await createUser();
    const stranger = await createUser();
    const theirs = await createExercise({
      name: 'Their squat',
      ownerId: stranger.id,
    });

    await expect(service().findOne(user.id, theirs.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('is a 404 for an id that names nothing', async () => {
    const user = await createUser();
    await expect(
      service().findOne(user.id, 'no-such-id'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
