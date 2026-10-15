import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_PLAN_ID,
  ROUTINE_EXPORT_FORMAT,
  ROUTINE_EXPORT_VERSION,
} from '@regimen-works/shared';
import type { PrismaService } from '../prisma/prisma.service';
import { testPrisma } from '../test-support/database';
import {
  createEnrollment,
  createExercise,
  createUser,
} from '../test-support/fixtures';
import { SetupService } from '../setup/setup.service';
import { loadActiveProgram } from './active-program';
import { upsertJustWods } from './just-wods';
import { failureLines, importRoutinesFile } from './import-routines';
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

/**
 * A day's own name (DN-155). Wording, like the routine's name: it saves in
 * place even once someone has started the routine, and never forks it.
 */
describe('naming the days of a routine', () => {
  const named = (labels: Record<number, string | null>) =>
    body({
      days: [
        {
          dayOfWeek: 1,
          label: labels[1],
          lines: [line(), line({ movementGroup: 'push_vertical' })],
        },
        {
          dayOfWeek: 4,
          label: labels[4],
          lines: [line({ movementGroup: 'squat' })],
        },
      ],
    });

  const labels = async (id: string) =>
    Object.fromEntries(
      (await stored(id)).weeks[0].slots.map((s) => [s.dayOfWeek, s.label]),
    );

  it('stores each day’s name on its slot, and reads it back', async () => {
    const alice = await createUser();
    const sent = named({ 1: 'Upper', 4: null });
    const routine = await routines().create({ ownerId: alice.id }, sent);

    expect(await labels(routine.id)).toEqual({ 1: 'Upper', 4: null });
    const { routine: back } = await routines().getForEditing(
      { ownerId: alice.id },
      routine.id,
    );
    expect(back.days.map((d) => d.label)).toEqual(['Upper', undefined]);
  });

  it('renames a day in place once someone has started it, never forking', async () => {
    const alice = await createUser();
    const routine = await routines().create(
      { ownerId: alice.id },
      named({ 1: 'Upper', 4: null }),
    );
    await createEnrollment(alice.id, { planId: routine.id });
    const slotIds = (await stored(routine.id)).weeks[0].slots.map((s) => s.id);

    const saved = await routines().update(
      { ownerId: alice.id },
      routine.id,
      named({ 1: 'Push', 4: 'Legs' }),
    );

    expect(saved).toMatchObject({ forked: false, routine: { id: routine.id } });
    expect(await labels(routine.id)).toEqual({ 1: 'Push', 4: 'Legs' });
    expect((await stored(routine.id)).weeks[0].slots.map((s) => s.id)).toEqual(
      slotIds,
    );
    expect(
      await testPrisma().plan.count({ where: { ownerId: alice.id } }),
    ).toBe(1);
  });

  it('clears a name in place, too', async () => {
    const alice = await createUser();
    const routine = await routines().create(
      { ownerId: alice.id },
      named({ 1: 'Upper', 4: 'Lower' }),
    );
    await createEnrollment(alice.id, { planId: routine.id });

    await routines().update(
      { ownerId: alice.id },
      routine.id,
      named({ 1: null }),
    );

    expect(await labels(routine.id)).toEqual({ 1: null, 4: null });
  });

  it('carries the names into a fork of a changed week', async () => {
    const alice = await createUser();
    const routine = await routines().create(
      { ownerId: alice.id },
      named({ 1: 'Upper', 4: 'Lower' }),
    );
    await createEnrollment(alice.id, { planId: routine.id });

    const saved = await routines().update(
      { ownerId: alice.id },
      routine.id,
      body({
        days: [
          { dayOfWeek: 1, label: 'Push', lines: [line()] },
          {
            dayOfWeek: 4,
            label: 'Lower',
            lines: [line({ movementGroup: 'squat' })],
          },
        ],
      }),
    );

    expect(saved.forked).toBe(true);
    expect(await labels(saved.routine.id)).toEqual({ 1: 'Push', 4: 'Lower' });
    expect(await labels(routine.id)).toEqual({ 1: 'Upper', 4: 'Lower' });
  });

  it('carries the names into a copy', async () => {
    const alice = await createUser();
    const source = await routines().create(
      { ownerId: null },
      named({ 1: 'Upper', 4: 'Lower' }),
    );

    const mine = await routines().create(
      { ownerId: alice.id },
      await routines().getForCopy(source.id),
    );

    expect(await labels(mine.id)).toEqual({ 1: 'Upper', 4: 'Lower' });
  });

  it('shows Today the day’s name', async () => {
    const alice = await createUser();
    const routine = await routines().create(
      { ownerId: alice.id },
      named({ 1: 'Upper', 4: null }),
    );
    await createEnrollment(alice.id, { planId: routine.id });

    const program = await loadActiveProgram(testPrisma(), alice.id);
    expect(
      program?.authoredWeeks[0].slots.map((s) => [s.dayOfWeek, s.label]),
    ).toEqual(
      expect.arrayContaining([
        [1, 'Upper'],
        [4, null],
      ]),
    );
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

describe('the global tier (DN-148)', () => {
  const TODAY = '2026-10-13';
  const GLOBAL = { ownerId: null };

  async function offered(userId: string) {
    const setup = new SetupService(testPrisma() as unknown as PrismaService);
    return (await setup.options(userId, TODAY)).programs.map((p) => p.id);
  }

  it('creates a global routine that every athlete is offered', async () => {
    const bob = await createUser();

    const created = await routines().create(GLOBAL, body());

    expect((await stored(created.id)).ownerId).toBeNull();
    expect(await offered(bob.id)).toContain(created.id);
    expect(await routines().listOwn(bob.id)).toEqual([]);
  });

  describe('promote', () => {
    it("publishes the admin's own routine in place, their run carrying on", async () => {
      const admin = await createUser();
      const bob = await createUser();
      const routine = await routines().create({ ownerId: admin.id }, body());
      await createEnrollment(admin.id, { planId: routine.id });
      const before = await loadActiveProgram(testPrisma(), admin.id);

      const published = await routines().promote(admin.id, routine.id);

      expect(published).toEqual(routine);
      expect((await stored(routine.id)).ownerId).toBeNull();
      const after = await loadActiveProgram(testPrisma(), admin.id);
      expect(after?.planId).toBe(routine.id);
      expect(after?.authoredWeeks).toEqual(before?.authoredWeeks);
      expect(await offered(bob.id)).toContain(routine.id);
      expect(await routines().listOwn(admin.id)).toEqual([]);
    });

    it('is refused when a live global routine has the name', async () => {
      const admin = await createUser();
      await routines().create(GLOBAL, body());
      const routine = await routines().create({ ownerId: admin.id }, body());

      await expect(routines().promote(admin.id, routine.id)).rejects.toThrow(
        new ConflictException(
          'There is already a global routine called "Upper / Lower"',
        ),
      );
      expect((await stored(routine.id)).ownerId).toBe(admin.id);
    });

    it('is refused while it names a movement only the admin has', async () => {
      const admin = await createUser();
      const chin = await createExercise({ name: 'Chin-up' });
      const towel = await createExercise({
        name: 'Towel row',
        ownerId: admin.id,
      });
      const named = (exerciseId: string) =>
        body({
          days: [
            {
              dayOfWeek: 1,
              lines: [line({ movementGroup: null, exerciseId })],
            },
          ],
        });
      const mine = await routines().create(
        { ownerId: admin.id },
        named(towel.id),
      );

      await expect(routines().promote(admin.id, mine.id)).rejects.toThrow(
        new BadRequestException(
          'It names movements only you have: Towel row. Swap them for library ones before publishing it.',
        ),
      );
      expect((await stored(mine.id)).ownerId).toBe(admin.id);

      const library = await routines().create(
        { ownerId: admin.id },
        { ...named(chin.id), name: 'Chins' },
      );
      await expect(
        routines().promote(admin.id, library.id),
      ).resolves.toMatchObject({ id: library.id });
    });

    it('is refused while archived', async () => {
      const admin = await createUser();
      const routine = await routines().create({ ownerId: admin.id }, body());
      await routines().archive({ ownerId: admin.id }, routine.id);

      await expect(routines().promote(admin.id, routine.id)).rejects.toThrow(
        ConflictException,
      );
    });

    it("cannot publish another athlete's routine, or one already global", async () => {
      const admin = await createUser();
      const bob = await createUser();
      const bobs = await routines().create({ ownerId: bob.id }, body());
      const global = await routines().create(GLOBAL, body({ name: 'Ours' }));

      await expect(routines().promote(admin.id, bobs.id)).rejects.toThrow(
        NotFoundException,
      );
      await expect(routines().promote(admin.id, global.id)).rejects.toThrow(
        NotFoundException,
      );
      expect((await stored(bobs.id)).ownerId).toBe(bob.id);
    });
  });

  it("takes an archived global routine off every picker but leaves an athlete's run on it", async () => {
    const admin = await createUser();
    const bob = await createUser();
    const routine = await routines().create(GLOBAL, body());
    await createEnrollment(bob.id, { planId: routine.id });

    const removed = await routines().archive(GLOBAL, routine.id, admin.id);

    expect(removed.running).toBe(false);
    expect(await offered(admin.id)).not.toContain(routine.id);
    expect(await offered(bob.id)).not.toContain(routine.id);
    expect((await loadActiveProgram(testPrisma(), bob.id))?.planId).toBe(
      routine.id,
    );

    await routines().restore(GLOBAL, routine.id);
    expect(await offered(bob.id)).toContain(routine.id);
  });

  it("says the admin's own run carries on when they archive what they run", async () => {
    const admin = await createUser();
    const routine = await routines().create(GLOBAL, body());
    await createEnrollment(admin.id, { planId: routine.id });

    const removed = await routines().archive(GLOBAL, routine.id, admin.id);

    expect(removed.running).toBe(true);
  });

  it('forks a global routine once any athlete has started it, still global', async () => {
    const bob = await createUser();
    const routine = await routines().create(GLOBAL, body());
    await createEnrollment(bob.id, { planId: routine.id });

    const saved = await routines().update(
      GLOBAL,
      routine.id,
      body({ scheduleMode: 'fixed' }),
    );

    expect(saved.forked).toBe(true);
    expect((await stored(saved.routine.id)).ownerId).toBeNull();
    expect((await stored(routine.id)).archivedAt).not.toBeNull();
  });

  it("lists the global library, Just WODs first and built in, nobody's own", async () => {
    await upsertJustWods(testPrisma());
    const alice = await createUser();
    await routines().create({ ownerId: alice.id }, body({ name: 'Mine' }));
    const live = await routines().create(GLOBAL, body({ name: 'Zed' }));
    const old = await routines().create(GLOBAL, body({ name: 'Alpha' }));
    await routines().archive(GLOBAL, old.id);

    const listed = await routines().listGlobal();

    expect(listed.map((r) => [r.id, r.builtIn, r.archived])).toEqual([
      [DEFAULT_PLAN_ID, true, false],
      [live.id, false, false],
      [old.id, false, true],
    ]);
  });

  it('refuses Just WODs to the global writer as well', async () => {
    await upsertJustWods(testPrisma());

    await expect(
      routines().getForEditing(GLOBAL, DEFAULT_PLAN_ID),
    ).rejects.toThrow(NotFoundException);
    await expect(routines().restore(GLOBAL, DEFAULT_PLAN_ID)).rejects.toThrow(
      NotFoundException,
    );
  });
});

/** Everything a routine is stored as, minus the ids that make it a row. */
async function shape(id: string) {
  const plan = await stored(id);
  return plan.weeks.map((week) => ({
    order: week.order,
    phase: week.phase,
    slots: [...week.slots]
      .sort((a, b) => a.dayOfWeek - b.dayOfWeek)
      .map((slot) => ({
        dayOfWeek: slot.dayOfWeek,
        kind: slot.kind,
        priority: slot.priority,
        movements: slot.movements.map((movement) => ({
          ...movement,
          id: undefined,
          planSlotId: undefined,
        })),
      })),
  }));
}

describe('copying a global routine (DN-149)', () => {
  const GLOBAL = { ownerId: null };

  async function copy(ownerId: string, sourceId: string) {
    const prefill = await routines().getForCopy(sourceId);
    return routines().create({ ownerId }, prefill);
  }

  it("saves a copy the caller owns, stored as the source's week", async () => {
    const alice = await createUser();
    const chin = await createExercise({ name: 'Chin-up' });
    const source = await routines().create(
      GLOBAL,
      body({
        summary: 'Two days, heavy',
        days: [
          {
            dayOfWeek: 1,
            lines: [line({ movementGroup: null, exerciseId: chin.id }), line()],
          },
          {
            dayOfWeek: 4,
            lines: [line({ toFailure: true, reps: null, repsMax: null })],
          },
        ],
      }),
    );

    const mine = await copy(alice.id, source.id);

    expect(mine.id).not.toBe(source.id);
    expect(mine).toMatchObject({
      name: source.name,
      summary: 'Two days, heavy',
    });
    expect((await stored(mine.id)).ownerId).toBe(alice.id);
    expect(await shape(mine.id)).toEqual(await shape(source.id));
    expect(await routines().listOwn(alice.id)).toEqual([mine]);
  });

  it('keeps the copy and the source apart, editing either way', async () => {
    const alice = await createUser();
    const source = await routines().create(GLOBAL, body());
    const mine = await copy(alice.id, source.id);
    const original = await shape(source.id);

    await routines().update(
      { ownerId: alice.id },
      mine.id,
      body({ name: 'Mine now', scheduleMode: 'fixed' }),
    );
    expect(await shape(source.id)).toEqual(original);
    expect((await stored(source.id)).name).toBe('Upper / Lower');

    const copied = await shape(mine.id);
    await routines().update(
      GLOBAL,
      source.id,
      body({ days: [{ dayOfWeek: 2, lines: [line()] }] }),
    );
    expect(await shape(mine.id)).toEqual(copied);
  });

  it("offers only live global routines, never Just WODs or anyone's own", async () => {
    await upsertJustWods(testPrisma());
    const alice = await createUser();
    const bob = await createUser();
    const live = await routines().create(GLOBAL, body({ name: 'Live' }));
    const retired = await routines().create(GLOBAL, body({ name: 'Retired' }));
    await routines().archive(GLOBAL, retired.id);
    const alices = await routines().create(
      { ownerId: alice.id },
      body({ name: 'Alices' }),
    );
    const bobs = await routines().create(
      { ownerId: bob.id },
      body({ name: 'Bobs' }),
    );

    expect((await routines().listCopyable()).map((r) => r.id)).toEqual([
      live.id,
    ]);

    for (const id of [retired.id, alices.id, bobs.id, DEFAULT_PLAN_ID]) {
      await expect(routines().getForCopy(id)).rejects.toThrow(
        NotFoundException,
      );
    }
  });

  it("makes an admin's copy personal, and publishable once renamed", async () => {
    const admin = await createUser();
    const source = await routines().create(GLOBAL, body());

    const mine = await copy(admin.id, source.id);
    expect((await stored(mine.id)).ownerId).toBe(admin.id);

    await expect(routines().promote(admin.id, mine.id)).rejects.toThrow(
      ConflictException,
    );
    await routines().update(
      { ownerId: admin.id },
      mine.id,
      body({ name: 'Upper / Lower II' }),
    );
    await expect(routines().promote(admin.id, mine.id)).resolves.toMatchObject({
      id: mine.id,
    });
  });
});

describe('exporting and importing global routines (DN-150)', () => {
  const GLOBAL = { ownerId: null };

  const envelope = (entries: unknown[]) => ({
    format: ROUTINE_EXPORT_FORMAT,
    version: ROUTINE_EXPORT_VERSION,
    routines: entries,
  });

  /** What an import refused, as the command would print it. */
  async function refusal(file: unknown) {
    const error: unknown = await routines()
      .importGlobal(file)
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    expect(error).toBeDefined();
    return failureLines(error);
  }

  async function globalCount() {
    return testPrisma().plan.count({ where: { ownerId: null } });
  }

  it('round-trips: exported routines import into an empty library as they were', async () => {
    const chin = await createExercise({ name: 'Chin-up' });
    const pull = await routines().create(
      GLOBAL,
      body({
        name: 'Pull focus',
        summary: 'Hang, pull, repeat',
        scheduleMode: 'fixed',
        days: [
          {
            dayOfWeek: 2,
            lines: [line({ movementGroup: null, exerciseId: chin.id }), line()],
          },
        ],
      }),
    );
    const legs = await routines().create(GLOBAL, body({ name: 'Legs' }));
    await routines().archive(GLOBAL, legs.id);
    const before = [await shape(legs.id), await shape(pull.id)];

    const file = await routines().exportGlobal({ ids: [pull.id, legs.id] });
    expect(file).toMatchObject({
      format: ROUTINE_EXPORT_FORMAT,
      version: ROUTINE_EXPORT_VERSION,
    });
    expect(file.routines.map((r) => r.name)).toEqual(['Legs', 'Pull focus']);

    await testPrisma().plan.deleteMany({ where: { ownerId: null } });
    // Through JSON, as the file travels.
    const created = await routines().importGlobal(
      JSON.parse(JSON.stringify(file)),
    );

    expect(created.map((r) => [r.name, r.archived])).toEqual([
      ['Legs', false],
      ['Pull focus', false],
    ]);
    expect(await Promise.all(created.map((r) => shape(r.id)))).toEqual(before);
    for (const r of created) {
      expect((await stored(r.id)).ownerId).toBeNull();
    }
    expect((await stored(created[1].id)).summary).toBe('Hang, pull, repeat');
  });

  it('exports only global routines, and never Just WODs', async () => {
    await upsertJustWods(testPrisma());
    const alice = await createUser();
    const live = await routines().create(GLOBAL, body({ name: 'Live' }));
    const mine = await routines().create({ ownerId: alice.id }, body());

    for (const ids of [[live.id, mine.id], [DEFAULT_PLAN_ID], ['nope']]) {
      await expect(routines().exportGlobal({ ids })).rejects.toThrow(
        NotFoundException,
      );
    }
    await expect(routines().exportGlobal({ ids: [] })).rejects.toThrow(
      BadRequestException,
    );
  });

  it("refuses an entry that breaks the editor's rules, names it, and loads nothing", async () => {
    const chin = await createExercise({ name: 'Chin-up' });
    const lines = await refusal(
      envelope([
        body({ name: 'Fine' }),
        body({
          name: 'Both',
          days: [{ dayOfWeek: 1, lines: [line({ exerciseId: chin.id })] }],
        }),
      ]),
    );

    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l).toMatch(/^Routine 2 \(Both\): /);
    expect(await globalCount()).toBe(0);
  });

  it('refuses a live name clash without overwriting, and rolls back what came before it', async () => {
    const existing = await routines().create(GLOBAL, body({ name: 'Taken' }));
    const original = await shape(existing.id);

    const lines = await refusal(
      envelope([
        body({ name: 'New one' }),
        body({ name: 'Taken', days: [{ dayOfWeek: 6, lines: [line()] }] }),
      ]),
    );

    expect(lines).toEqual([
      'Routine 2 (Taken): There is already a global routine called "Taken"',
    ]);
    expect(await globalCount()).toBe(1);
    expect(await shape(existing.id)).toEqual(original);
  });

  it('refuses two entries with one name, the second named', async () => {
    const lines = await refusal(
      envelope([body({ name: 'Twice' }), body({ name: 'Twice' })]),
    );
    expect(lines).toEqual([
      'Routine 2 (Twice): There is already a global routine called "Twice"',
    ]);
    expect(await globalCount()).toBe(0);
  });

  it('refuses a routine naming a movement only one athlete has', async () => {
    const alice = await createUser();
    const towel = await createExercise({
      name: 'Towel row',
      ownerId: alice.id,
    });
    const lines = await refusal(
      envelope([
        body({
          days: [
            {
              dayOfWeek: 1,
              lines: [line({ movementGroup: null, exerciseId: towel.id })],
            },
          ],
        }),
      ]),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^Routine 1 \(Upper \/ Lower\): /);
    expect(await globalCount()).toBe(0);
  });

  it('refuses a file that is not an export, or from another version', async () => {
    expect(await refusal([body()])).not.toEqual([]);
    expect(await refusal({ ...envelope([body()]), version: 2 })).toEqual([
      `version: this app reads routine exports of version ${ROUTINE_EXPORT_VERSION}`,
    ]);
    expect(await refusal(envelope([]))).toEqual([
      'routines: the file holds no routines',
    ]);
    expect(await globalCount()).toBe(0);
  });

  it('reads the file the command is given, and says when it is not JSON', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'routines-'));
    const good = join(dir, 'good.json');
    const bad = join(dir, 'bad.json');
    await writeFile(
      good,
      JSON.stringify(envelope([body({ name: 'From disk' })])),
    );
    await writeFile(bad, 'not json');

    const created = await importRoutinesFile(routines(), good);
    expect(created.map((r) => r.name)).toEqual(['From disk']);

    await expect(importRoutinesFile(routines(), bad)).rejects.toThrow(
      `${bad} is not JSON. Is it a routine export?`,
    );
    await expect(
      importRoutinesFile(routines(), join(dir, 'missing.json')),
    ).rejects.toThrow(/^Can't read /);
  });
});
