import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DEFAULT_PLAN_ID } from '@regimen-works/shared';
import type { PrismaService } from '../prisma/prisma.service';
import { testPrisma } from '../test-support/database';
import {
  createEnrollment,
  createExercise,
  createUser,
} from '../test-support/fixtures';
import { SetupService } from '../setup/setup.service';
import { loadActiveProgram } from './active-program';
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

/**
 * Editing a routine (DN-146, ADR 0006 decision 6). The switch under test is
 * "has anyone ever started it": before, every save edits in place; after, a
 * change to the week becomes a new routine and the old one is archived, so
 * nobody's run changes under them.
 */
describe('RoutinesService.update', () => {
  async function written(ownerId: string) {
    return routines().create({ ownerId }, body());
  }

  /** The same week with one more line on Monday. */
  const longerMonday = (overrides: Record<string, unknown> = {}) =>
    body({
      days: [
        {
          dayOfWeek: 1,
          lines: [
            line(),
            line({ movementGroup: 'push_vertical' }),
            line({ movementGroup: 'hinge' }),
          ],
        },
        { dayOfWeek: 4, lines: [line({ movementGroup: 'squat' })] },
      ],
      ...overrides,
    });

  const mondayGroups = async (id: string) =>
    (await stored(id)).weeks[0].slots
      .find((s) => s.dayOfWeek === 1)!
      .movements.map((m) => m.movementGroup);

  it('changes the week in place while nobody has started it', async () => {
    const alice = await createUser();
    const routine = await written(alice.id);

    const saved = await routines().update(
      { ownerId: alice.id },
      routine.id,
      longerMonday(),
    );

    expect(saved).toMatchObject({ forked: false, routine: { id: routine.id } });
    expect(await mondayGroups(routine.id)).toEqual([
      'pull',
      'push_vertical',
      'hinge',
    ]);
    expect(
      await testPrisma().plan.count({ where: { ownerId: alice.id } }),
    ).toBe(1);
  });

  it('rewrites the schedule in place too, bounds included', async () => {
    const alice = await createUser();
    const routine = await written(alice.id);

    await routines().update(
      { ownerId: alice.id },
      routine.id,
      body({ scheduleMode: 'fixed' }),
    );

    expect(await stored(routine.id)).toMatchObject({
      scheduleMode: 'fixed',
      minDaysPerWeek: null,
      maxDaysPerWeek: null,
      defaultDays: [],
    });
  });

  describe('once someone has started it', () => {
    it('forks a change to the week, archiving the version being run', async () => {
      const alice = await createUser();
      const routine = await written(alice.id);
      await createEnrollment(alice.id, { planId: routine.id });

      const saved = await routines().update(
        { ownerId: alice.id },
        routine.id,
        longerMonday(),
      );

      expect(saved.forked).toBe(true);
      expect(saved.routine.id).not.toBe(routine.id);
      expect(saved.routine).toMatchObject({
        name: 'Upper / Lower',
        archived: false,
      });
      expect(await mondayGroups(saved.routine.id)).toEqual([
        'pull',
        'push_vertical',
        'hinge',
      ]);

      const old = await stored(routine.id);
      expect(old.archivedAt).not.toBeNull();
      expect(old.ownerId).toBe(alice.id);
      expect(await mondayGroups(routine.id)).toEqual(['pull', 'push_vertical']);
      expect((await stored(saved.routine.id)).ownerId).toBe(alice.id);
    });

    it('leaves the run under way on the version it started', async () => {
      const alice = await createUser();
      const routine = await written(alice.id);
      await createEnrollment(alice.id, { planId: routine.id });
      const before = await loadActiveProgram(testPrisma(), alice.id);

      await routines().update(
        { ownerId: alice.id },
        routine.id,
        longerMonday(),
      );

      const after = await loadActiveProgram(testPrisma(), alice.id);
      expect(after?.planId).toBe(routine.id);
      expect(after?.authoredWeeks).toEqual(before?.authoredWeeks);
    });

    it('counts a finished run as someone having started it', async () => {
      const alice = await createUser();
      const routine = await written(alice.id);
      await createEnrollment(alice.id, {
        planId: routine.id,
        status: 'completed',
      });

      const saved = await routines().update(
        { ownerId: alice.id },
        routine.id,
        longerMonday(),
      );

      expect(saved.forked).toBe(true);
    });

    it('renames in place, whoever is running it', async () => {
      const alice = await createUser();
      const routine = await written(alice.id);
      await createEnrollment(alice.id, { planId: routine.id });

      const saved = await routines().update(
        { ownerId: alice.id },
        routine.id,
        body({ name: 'Upper / Lower v2', summary: 'Two days, heavy.' }),
      );

      expect(saved).toMatchObject({
        forked: false,
        routine: {
          id: routine.id,
          name: 'Upper / Lower v2',
          summary: 'Two days, heavy.',
        },
      });
      expect(
        await testPrisma().plan.count({ where: { ownerId: alice.id } }),
      ).toBe(1);
    });

    it('carries a rename and a new week in one fork, leaving the old name on the old version', async () => {
      const alice = await createUser();
      const routine = await written(alice.id);
      await createEnrollment(alice.id, { planId: routine.id });

      const saved = await routines().update(
        { ownerId: alice.id },
        routine.id,
        longerMonday({ name: 'Upper / Lower v2' }),
      );

      expect(saved).toMatchObject({
        forked: true,
        routine: { name: 'Upper / Lower v2' },
      });
      expect((await stored(routine.id)).name).toBe('Upper / Lower');
    });
  });

  it('treats a save that changes nothing as a wording edit', async () => {
    const alice = await createUser();
    const routine = await written(alice.id);
    await createEnrollment(alice.id, { planId: routine.id });

    const saved = await routines().update(
      { ownerId: alice.id },
      routine.id,
      body(),
    );

    expect(saved).toMatchObject({ forked: false, routine: { id: routine.id } });
  });

  it('writes a new summary from a new schedule when the author left it blank', async () => {
    const alice = await createUser();
    const routine = await written(alice.id);

    const saved = await routines().update(
      { ownerId: alice.id },
      routine.id,
      body({ scheduleMode: 'fixed' }),
    );

    expect(saved.routine.summary).toBe('Your routine, Mon · Thu');
  });

  it('refuses a name another live routine of theirs holds', async () => {
    const alice = await createUser();
    const routine = await written(alice.id);
    await routines().create({ ownerId: alice.id }, body({ name: 'Taken' }));

    await expect(
      routines().update(
        { ownerId: alice.id },
        routine.id,
        body({ name: 'Taken' }),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('holds an edit to the editor’s rules', async () => {
    const alice = await createUser();
    const routine = await written(alice.id);

    await expect(
      routines().update({ ownerId: alice.id }, routine.id, body({ days: [] })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses another athlete’s exercise in an edit', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const routine = await written(alice.id);
    const bobs = await createExercise({ ownerId: bob.id });

    await expect(
      routines().update(
        { ownerId: alice.id },
        routine.id,
        body({
          days: [
            {
              dayOfWeek: 1,
              lines: [line({ movementGroup: null, exerciseId: bobs.id })],
            },
          ],
        }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('is a 404 for another athlete’s routine', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const bobs = await written(bob.id);

    await expect(
      routines().update({ ownerId: alice.id }, bobs.id, longerMonday()),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(await mondayGroups(bobs.id)).toEqual(['pull', 'push_vertical']);
  });

  it('is a 404 for a global routine from the owner’s route', async () => {
    const alice = await createUser();
    const global = await routines().create({ ownerId: null }, body());

    await expect(
      routines().update({ ownerId: alice.id }, global.id, longerMonday()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses Just WODs, whoever asks', async () => {
    const alice = await createUser();

    for (const writer of [{ ownerId: alice.id }, { ownerId: null }]) {
      await expect(
        routines().update(writer, DEFAULT_PLAN_ID, body()),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it('refuses an archived routine until it is brought back', async () => {
    const alice = await createUser();
    const routine = await written(alice.id);
    await testPrisma().plan.update({
      where: { id: routine.id },
      data: { archivedAt: new Date() },
    });

    await expect(
      routines().update({ ownerId: alice.id }, routine.id, body()),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('RoutinesService.getForEditing', () => {
  it('reads the routine back as the body that wrote it', async () => {
    const alice = await createUser();
    const sent = body({ summary: 'Two days.' });
    const routine = await routines().create({ ownerId: alice.id }, sent);

    expect(
      await routines().getForEditing({ ownerId: alice.id }, routine.id),
    ).toEqual({
      id: routine.id,
      routine: sent,
      hasRuns: false,
      archived: false,
    });
  });

  it('gives back no summary where the stored one was written from the schedule', async () => {
    const alice = await createUser();
    const routine = await routines().create({ ownerId: alice.id }, body());

    const loaded = await routines().getForEditing(
      { ownerId: alice.id },
      routine.id,
    );

    expect(loaded.routine.summary).toBeNull();
  });

  it('says when someone has started it', async () => {
    const alice = await createUser();
    const routine = await routines().create({ ownerId: alice.id }, body());
    await createEnrollment(alice.id, {
      planId: routine.id,
      status: 'completed',
    });

    expect(
      (await routines().getForEditing({ ownerId: alice.id }, routine.id))
        .hasRuns,
    ).toBe(true);
  });

  it('is a 404 for another athlete’s routine', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const bobs = await routines().create({ ownerId: bob.id }, body());

    await expect(
      routines().getForEditing({ ownerId: alice.id }, bobs.id),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('RoutinesService.archive and restore', () => {
  const TODAY = '2026-10-12';

  async function offered(userId: string) {
    const setup = new SetupService(testPrisma() as unknown as PrismaService);
    return (await setup.options(userId, TODAY)).programs.map((p) => p.id);
  }

  it('takes a routine out of setup, and restore puts it back', async () => {
    const alice = await createUser();
    const routine = await routines().create({ ownerId: alice.id }, body());
    expect(await offered(alice.id)).toContain(routine.id);

    const removed = await routines().archive({ ownerId: alice.id }, routine.id);
    expect(removed).toEqual({
      routine: { ...routine, archived: true },
      running: false,
    });
    expect(await offered(alice.id)).not.toContain(routine.id);

    const restored = await routines().restore(
      { ownerId: alice.id },
      routine.id,
    );
    expect(restored).toEqual({ ...routine, archived: false });
    expect(await offered(alice.id)).toContain(routine.id);
  });

  it('leaves the run under way on it resolving, and says it is running', async () => {
    const alice = await createUser();
    const routine = await routines().create({ ownerId: alice.id }, body());
    await createEnrollment(alice.id, { planId: routine.id });
    const before = await loadActiveProgram(testPrisma(), alice.id);

    const removed = await routines().archive({ ownerId: alice.id }, routine.id);

    expect(removed.running).toBe(true);
    const after = await loadActiveProgram(testPrisma(), alice.id);
    expect(after?.planId).toBe(routine.id);
    expect(after?.authoredWeeks).toEqual(before?.authoredWeeks);
  });

  it('does not count a finished run as running', async () => {
    const alice = await createUser();
    const routine = await routines().create({ ownerId: alice.id }, body());
    await createEnrollment(alice.id, {
      planId: routine.id,
      status: 'completed',
    });

    const removed = await routines().archive({ ownerId: alice.id }, routine.id);
    expect(removed.running).toBe(false);
  });

  it('never deletes, even a routine nobody ran', async () => {
    const alice = await createUser();
    const routine = await routines().create({ ownerId: alice.id }, body());

    await routines().archive({ ownerId: alice.id }, routine.id);

    const plan = await stored(routine.id);
    expect(plan.archivedAt).not.toBeNull();
    expect(plan.weeks[0].slots).toHaveLength(2);
  });

  it('is idempotent both ways', async () => {
    const alice = await createUser();
    const routine = await routines().create({ ownerId: alice.id }, body());

    await routines().archive({ ownerId: alice.id }, routine.id);
    const archivedAt = (await stored(routine.id)).archivedAt;
    await routines().archive({ ownerId: alice.id }, routine.id);
    expect((await stored(routine.id)).archivedAt).toEqual(archivedAt);

    await routines().restore({ ownerId: alice.id }, routine.id);
    const again = await routines().restore({ ownerId: alice.id }, routine.id);
    expect(again.archived).toBe(false);
  });

  it('refuses a restore into a name a live routine now holds', async () => {
    const alice = await createUser();
    const routine = await routines().create({ ownerId: alice.id }, body());
    await routines().archive({ ownerId: alice.id }, routine.id);
    await routines().create({ ownerId: alice.id }, body());

    await expect(
      routines().restore({ ownerId: alice.id }, routine.id),
    ).rejects.toThrow(
      new ConflictException(
        'You already have a routine called "Upper / Lower"',
      ),
    );
    expect((await stored(routine.id)).archivedAt).not.toBeNull();
  });

  it("gives 404 for another athlete's routine, either way", async () => {
    const alice = await createUser();
    const bob = await createUser();
    const routine = await routines().create({ ownerId: alice.id }, body());

    await expect(
      routines().archive({ ownerId: bob.id }, routine.id),
    ).rejects.toThrow(NotFoundException);
    await routines().archive({ ownerId: alice.id }, routine.id);
    await expect(
      routines().restore({ ownerId: bob.id }, routine.id),
    ).rejects.toThrow(NotFoundException);
    expect((await stored(routine.id)).archivedAt).not.toBeNull();
  });

  it('will not archive Just WODs', async () => {
    const alice = await createUser();

    await expect(
      routines().archive({ ownerId: alice.id }, DEFAULT_PLAN_ID),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      routines().archive({ ownerId: null }, DEFAULT_PLAN_ID),
    ).rejects.toThrow(ForbiddenException);
  });
});
