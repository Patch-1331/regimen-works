import { BadRequestException, ConflictException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { testPrisma } from '../test-support/database';
import { createExercise, createUser } from '../test-support/fixtures';
import { ROUTINE_WEEKS, RoutinesService } from './routines.service';

/**
 * Writing a routine against a real database (DN-145).
 *
 * The editor's rules are pinned in `routine.spec.ts` in shared; this pins that
 * the service applies them itself -- every later path (copy, import) calls it
 * without going through a controller -- and what a routine is stored as.
 */

function routines(): RoutinesService {
  return new RoutinesService(testPrisma() as unknown as PrismaService);
}

const line = (overrides: Record<string, unknown> = {}) => ({
  movementGroup: 'pull',
  exerciseId: null,
  sets: 3,
  reps: 8,
  repsMax: 12,
  toFailure: false,
  restSeconds: null,
  ...overrides,
});

const body = (overrides: Record<string, unknown> = {}) => ({
  name: 'Upper / Lower',
  summary: null,
  scheduleMode: 'flexible',
  days: [
    { dayOfWeek: 1, lines: [line(), line({ movementGroup: 'push_vertical' })] },
    { dayOfWeek: 4, lines: [line({ movementGroup: 'squat' })] },
  ],
  ...overrides,
});

function stored(id: string) {
  return testPrisma().plan.findUniqueOrThrow({
    where: { id },
    include: {
      weeks: {
        include: {
          slots: { include: { movements: { orderBy: { order: 'asc' } } } },
        },
      },
    },
  });
}

describe('RoutinesService.create', () => {
  it('stores one repeating core week with a movements slot per day trained', async () => {
    const alice = await createUser();

    const created = await routines().create({ ownerId: alice.id }, body());
    const plan = await stored(created.id);

    expect(plan.ownerId).toBe(alice.id);
    expect(plan.weeks).toHaveLength(1);
    expect(plan.weeks[0]).toMatchObject({ order: 0, phase: 'core' });
    const slots = [...plan.weeks[0].slots].sort(
      (a, b) => a.dayOfWeek - b.dayOfWeek,
    );
    expect(slots.map((s) => [s.dayOfWeek, s.kind, s.priority])).toEqual([
      [1, 'movements', 0],
      [4, 'movements', 0],
    ]);
    expect(
      slots[0].movements.map((m) => [
        m.order,
        m.movementGroup,
        m.reps,
        m.repsMax,
        m.restSeconds,
      ]),
    ).toEqual([
      [0, 'pull', 8, 12, null],
      [1, 'push_vertical', 8, 12, null],
    ]);
  });

  it('leaves the length to enrolment, within wide bounds', async () => {
    const alice = await createUser();

    const plan = await stored(
      (await routines().create({ ownerId: alice.id }, body())).id,
    );

    expect([plan.minWeeks, plan.maxWeeks, plan.defaultWeeks]).toEqual([
      ROUTINE_WEEKS.min,
      ROUTINE_WEEKS.max,
      ROUTINE_WEEKS.default,
    ]);
  });

  it('stores "any N days a week" as exactly N, starting on the days written', async () => {
    const alice = await createUser();

    const plan = await stored(
      (await routines().create({ ownerId: alice.id }, body())).id,
    );

    expect(plan).toMatchObject({
      scheduleMode: 'flexible',
      minDaysPerWeek: 2,
      maxDaysPerWeek: 2,
      defaultDays: [1, 4],
    });
  });

  it('stores "on these weekdays" as fixed, with no day bounds', async () => {
    const alice = await createUser();

    const plan = await stored(
      (
        await routines().create(
          { ownerId: alice.id },
          body({ scheduleMode: 'fixed' }),
        )
      ).id,
    );

    expect(plan).toMatchObject({
      scheduleMode: 'fixed',
      minDaysPerWeek: null,
      maxDaysPerWeek: null,
      defaultDays: [],
    });
  });

  it('writes a summary from the schedule when the author left it blank', async () => {
    const alice = await createUser();

    const flexible = await routines().create({ ownerId: alice.id }, body());
    const fixed = await routines().create(
      { ownerId: alice.id },
      body({ name: 'Fixed', scheduleMode: 'fixed' }),
    );
    const written = await routines().create(
      { ownerId: alice.id },
      body({ name: 'Written', summary: 'Mine.' }),
    );

    expect(flexible.summary).toBe('Your routine, 2 days a week');
    expect(fixed.summary).toBe('Your routine, Mon · Thu');
    expect(written.summary).toBe('Mine.');
  });

  it('applies the editor’s rules itself, not only at the controller', async () => {
    const alice = await createUser();

    await expect(
      routines().create(
        { ownerId: alice.id },
        body({
          days: [{ dayOfWeek: 1, lines: [line({ movementGroup: null })] }],
        }),
      ),
    ).rejects.toThrow(BadRequestException);
    await expect(
      routines().create(
        { ownerId: alice.id },
        body({ days: [{ dayOfWeek: 1, lines: [line({ load: '80%' })] }] }),
      ),
    ).rejects.toThrow(BadRequestException);
    expect(
      await testPrisma().plan.count({ where: { ownerId: alice.id } }),
    ).toBe(0);
  });

  it('accepts a global exercise and the author’s own', async () => {
    const alice = await createUser();
    const global = await createExercise({ name: 'Chin-up' });
    const own = await createExercise({ name: 'Towel row', ownerId: alice.id });

    const created = await routines().create(
      { ownerId: alice.id },
      body({
        days: [
          {
            dayOfWeek: 1,
            lines: [
              line({ movementGroup: null, exerciseId: global.id }),
              line({ movementGroup: null, exerciseId: own.id }),
            ],
          },
        ],
      }),
    );

    const plan = await stored(created.id);
    expect(plan.weeks[0].slots[0].movements.map((m) => m.exerciseId)).toEqual([
      global.id,
      own.id,
    ]);
  });

  it('refuses another athlete’s exercise, and an archived one', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const bobs = await createExercise({ name: 'Bob row', ownerId: bob.id });
    const retired = await createExercise({
      name: 'Old row',
      archivedAt: new Date(),
    });

    for (const id of [bobs.id, retired.id]) {
      await expect(
        routines().create(
          { ownerId: alice.id },
          body({
            days: [
              {
                dayOfWeek: 1,
                lines: [line({ movementGroup: null, exerciseId: id })],
              },
            ],
          }),
        ),
      ).rejects.toThrow(BadRequestException);
    }
  });

  it('refuses a second live routine of the same name', async () => {
    const alice = await createUser();
    await routines().create({ ownerId: alice.id }, body());

    await expect(
      routines().create({ ownerId: alice.id }, body()),
    ).rejects.toThrow(ConflictException);
  });

  it('lets a name archived away be used again, and another athlete use it at all', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const first = await routines().create({ ownerId: alice.id }, body());
    await testPrisma().plan.update({
      where: { id: first.id },
      data: { archivedAt: new Date() },
    });

    await expect(
      routines().create({ ownerId: alice.id }, body()),
    ).resolves.toMatchObject({ name: 'Upper / Lower' });
    await expect(
      routines().create({ ownerId: bob.id }, body()),
    ).resolves.toMatchObject({ name: 'Upper / Lower' });
  });
});

describe('RoutinesService.listOwn', () => {
  it('lists the caller’s own routines, live first, archived marked', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const old = await routines().create(
      { ownerId: alice.id },
      body({ name: 'A old' }),
    );
    await testPrisma().plan.update({
      where: { id: old.id },
      data: { archivedAt: new Date() },
    });
    await routines().create({ ownerId: alice.id }, body({ name: 'B live' }));
    await routines().create({ ownerId: bob.id }, body({ name: 'Bob’s' }));
    await routines().create({ ownerId: null }, body({ name: 'Global' }));

    const listed = await routines().listOwn(alice.id);

    expect(listed.map((r) => [r.name, r.archived])).toEqual([
      ['B live', false],
      ['A old', true],
    ]);
    expect(listed[0].days).toEqual([1, 4]);
  });
});
