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
  DEFAULT_PROGRAM_ID,
  PROGRAM_EXPORT_FORMAT,
  PROGRAM_EXPORT_VERSION,
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
import { failureLines, importProgramsFile } from './import-programs';
import { PROGRAM_WEEKS, ProgramsService } from './programs.service';

/**
 * Writing a program against a real database (DN-145).
 *
 * The editor's rules are pinned in `program.spec.ts` in shared; this pins that
 * the service applies them itself -- every later path (copy, import) calls it
 * without going through a controller -- and what a program is stored as.
 */

function programs(): ProgramsService {
  return new ProgramsService(testPrisma() as unknown as PrismaService);
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
  return testPrisma().program.findUniqueOrThrow({
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

describe('ProgramsService.create', () => {
  it('stores one repeating core week with a movements slot per day trained', async () => {
    const alice = await createUser();

    const created = await programs().create({ ownerId: alice.id }, body());
    const program = await stored(created.id);

    expect(program.ownerId).toBe(alice.id);
    expect(program.weeks).toHaveLength(1);
    expect(program.weeks[0]).toMatchObject({ order: 0, phase: 'core' });
    const slots = [...program.weeks[0].slots].sort(
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

    const program = await stored(
      (await programs().create({ ownerId: alice.id }, body())).id,
    );

    expect([program.minWeeks, program.maxWeeks, program.defaultWeeks]).toEqual([
      PROGRAM_WEEKS.min,
      PROGRAM_WEEKS.max,
      PROGRAM_WEEKS.default,
    ]);
  });

  it('stores "any N days a week" as exactly N, starting on the days written', async () => {
    const alice = await createUser();

    const program = await stored(
      (await programs().create({ ownerId: alice.id }, body())).id,
    );

    expect(program).toMatchObject({
      scheduleMode: 'flexible',
      minDaysPerWeek: 2,
      maxDaysPerWeek: 2,
      defaultDays: [1, 4],
    });
  });

  it('stores "on these weekdays" as fixed, with no day bounds', async () => {
    const alice = await createUser();

    const program = await stored(
      (
        await programs().create(
          { ownerId: alice.id },
          body({ scheduleMode: 'fixed' }),
        )
      ).id,
    );

    expect(program).toMatchObject({
      scheduleMode: 'fixed',
      minDaysPerWeek: null,
      maxDaysPerWeek: null,
      defaultDays: [],
    });
  });

  it('writes a summary from the schedule when the author left it blank', async () => {
    const alice = await createUser();

    const flexible = await programs().create({ ownerId: alice.id }, body());
    const fixed = await programs().create(
      { ownerId: alice.id },
      body({ name: 'Fixed', scheduleMode: 'fixed' }),
    );
    const written = await programs().create(
      { ownerId: alice.id },
      body({ name: 'Written', summary: 'Mine.' }),
    );

    expect(flexible.summary).toBe('Your program, 2 days a week');
    expect(fixed.summary).toBe('Your program, Mon · Thu');
    expect(written.summary).toBe('Mine.');
  });

  it('applies the editor’s rules itself, not only at the controller', async () => {
    const alice = await createUser();

    await expect(
      programs().create(
        { ownerId: alice.id },
        body({
          days: [{ dayOfWeek: 1, lines: [line({ movementGroup: null })] }],
        }),
      ),
    ).rejects.toThrow(BadRequestException);
    await expect(
      programs().create(
        { ownerId: alice.id },
        body({ days: [{ dayOfWeek: 1, lines: [line({ load: '80%' })] }] }),
      ),
    ).rejects.toThrow(BadRequestException);
    expect(
      await testPrisma().program.count({ where: { ownerId: alice.id } }),
    ).toBe(0);
  });

  it('accepts a global exercise and the author’s own', async () => {
    const alice = await createUser();
    const global = await createExercise({ name: 'Chin-up' });
    const own = await createExercise({ name: 'Towel row', ownerId: alice.id });

    const created = await programs().create(
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

    const program = await stored(created.id);
    expect(
      program.weeks[0].slots[0].movements.map((m) => m.exerciseId),
    ).toEqual([global.id, own.id]);
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
        programs().create(
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

  it('refuses a second live program of the same name', async () => {
    const alice = await createUser();
    await programs().create({ ownerId: alice.id }, body());

    await expect(
      programs().create({ ownerId: alice.id }, body()),
    ).rejects.toThrow(ConflictException);
  });

  it('lets a name archived away be used again, and another athlete use it at all', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const first = await programs().create({ ownerId: alice.id }, body());
    await testPrisma().program.update({
      where: { id: first.id },
      data: { archivedAt: new Date() },
    });

    await expect(
      programs().create({ ownerId: alice.id }, body()),
    ).resolves.toMatchObject({ name: 'Upper / Lower' });
    await expect(
      programs().create({ ownerId: bob.id }, body()),
    ).resolves.toMatchObject({ name: 'Upper / Lower' });
  });
});

describe('ProgramsService.listOwn', () => {
  it('lists the caller’s own programs, live first, archived marked', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const old = await programs().create(
      { ownerId: alice.id },
      body({ name: 'A old' }),
    );
    await testPrisma().program.update({
      where: { id: old.id },
      data: { archivedAt: new Date() },
    });
    await programs().create({ ownerId: alice.id }, body({ name: 'B live' }));
    await programs().create({ ownerId: bob.id }, body({ name: 'Bob’s' }));
    await programs().create({ ownerId: null }, body({ name: 'Global' }));

    const listed = await programs().listOwn(alice.id);

    expect(listed.map((r) => [r.name, r.archived])).toEqual([
      ['B live', false],
      ['A old', true],
    ]);
    expect(listed[0].days).toEqual([1, 4]);
  });
});

/**
 * Editing a program (DN-146, ADR 0006 decision 6). The switch under test is
 * "has anyone ever started it": before, every save edits in place; after, a
 * change to the week becomes a new program and the old one is archived, so
 * nobody's run changes under them.
 */
describe('ProgramsService.update', () => {
  async function written(ownerId: string) {
    return programs().create({ ownerId }, body());
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
    const program = await written(alice.id);

    const saved = await programs().update(
      { ownerId: alice.id },
      program.id,
      longerMonday(),
    );

    expect(saved).toMatchObject({ forked: false, program: { id: program.id } });
    expect(await mondayGroups(program.id)).toEqual([
      'pull',
      'push_vertical',
      'hinge',
    ]);
    expect(
      await testPrisma().program.count({ where: { ownerId: alice.id } }),
    ).toBe(1);
  });

  it('rewrites the schedule in place too, bounds included', async () => {
    const alice = await createUser();
    const program = await written(alice.id);

    await programs().update(
      { ownerId: alice.id },
      program.id,
      body({ scheduleMode: 'fixed' }),
    );

    expect(await stored(program.id)).toMatchObject({
      scheduleMode: 'fixed',
      minDaysPerWeek: null,
      maxDaysPerWeek: null,
      defaultDays: [],
    });
  });

  describe('once someone has started it', () => {
    it('forks once a run of it has ended, as it does for one still going', async () => {
      // An ended run keeps its days pointing at these slots (DN-178), so the
      // edit cannot rewrite them in place any more than a live run's.
      const alice = await createUser();
      const program = await written(alice.id);
      await createEnrollment(alice.id, {
        programId: program.id,
        status: 'ended',
        endedAt: new Date(),
      });

      const saved = await programs().update(
        { ownerId: alice.id },
        program.id,
        longerMonday(),
      );

      expect(saved.forked).toBe(true);
      expect((await stored(program.id)).archivedAt).not.toBeNull();
    });

    it('forks a change to the week, archiving the version being run', async () => {
      const alice = await createUser();
      const program = await written(alice.id);
      await createEnrollment(alice.id, { programId: program.id });

      const saved = await programs().update(
        { ownerId: alice.id },
        program.id,
        longerMonday(),
      );

      expect(saved.forked).toBe(true);
      expect(saved.program.id).not.toBe(program.id);
      expect(saved.program).toMatchObject({
        name: 'Upper / Lower',
        archived: false,
      });
      expect(await mondayGroups(saved.program.id)).toEqual([
        'pull',
        'push_vertical',
        'hinge',
      ]);

      const old = await stored(program.id);
      expect(old.archivedAt).not.toBeNull();
      expect(old.ownerId).toBe(alice.id);
      expect(await mondayGroups(program.id)).toEqual(['pull', 'push_vertical']);
      expect((await stored(saved.program.id)).ownerId).toBe(alice.id);
    });

    it('leaves the run under way on the version it started', async () => {
      const alice = await createUser();
      const program = await written(alice.id);
      await createEnrollment(alice.id, { programId: program.id });
      const before = await loadActiveProgram(testPrisma(), alice.id);

      await programs().update(
        { ownerId: alice.id },
        program.id,
        longerMonday(),
      );

      const after = await loadActiveProgram(testPrisma(), alice.id);
      expect(after?.programId).toBe(program.id);
      expect(after?.authoredWeeks).toEqual(before?.authoredWeeks);
    });

    it('counts a finished run as someone having started it', async () => {
      const alice = await createUser();
      const program = await written(alice.id);
      await createEnrollment(alice.id, {
        programId: program.id,
        status: 'completed',
      });

      const saved = await programs().update(
        { ownerId: alice.id },
        program.id,
        longerMonday(),
      );

      expect(saved.forked).toBe(true);
    });

    it('renames in place, whoever is running it', async () => {
      const alice = await createUser();
      const program = await written(alice.id);
      await createEnrollment(alice.id, { programId: program.id });

      const saved = await programs().update(
        { ownerId: alice.id },
        program.id,
        body({ name: 'Upper / Lower v2', summary: 'Two days, heavy.' }),
      );

      expect(saved).toMatchObject({
        forked: false,
        program: {
          id: program.id,
          name: 'Upper / Lower v2',
          summary: 'Two days, heavy.',
        },
      });
      expect(
        await testPrisma().program.count({ where: { ownerId: alice.id } }),
      ).toBe(1);
    });

    it('carries a rename and a new week in one fork, leaving the old name on the old version', async () => {
      const alice = await createUser();
      const program = await written(alice.id);
      await createEnrollment(alice.id, { programId: program.id });

      const saved = await programs().update(
        { ownerId: alice.id },
        program.id,
        longerMonday({ name: 'Upper / Lower v2' }),
      );

      expect(saved).toMatchObject({
        forked: true,
        program: { name: 'Upper / Lower v2' },
      });
      expect((await stored(program.id)).name).toBe('Upper / Lower');
    });
  });

  it('treats a save that changes nothing as a wording edit', async () => {
    const alice = await createUser();
    const program = await written(alice.id);
    await createEnrollment(alice.id, { programId: program.id });

    const saved = await programs().update(
      { ownerId: alice.id },
      program.id,
      body(),
    );

    expect(saved).toMatchObject({ forked: false, program: { id: program.id } });
  });

  it('writes a new summary from a new schedule when the author left it blank', async () => {
    const alice = await createUser();
    const program = await written(alice.id);

    const saved = await programs().update(
      { ownerId: alice.id },
      program.id,
      body({ scheduleMode: 'fixed' }),
    );

    expect(saved.program.summary).toBe('Your program, Mon · Thu');
  });

  it('refuses a name another live program of theirs holds', async () => {
    const alice = await createUser();
    const program = await written(alice.id);
    await programs().create({ ownerId: alice.id }, body({ name: 'Taken' }));

    await expect(
      programs().update(
        { ownerId: alice.id },
        program.id,
        body({ name: 'Taken' }),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('holds an edit to the editor’s rules', async () => {
    const alice = await createUser();
    const program = await written(alice.id);

    await expect(
      programs().update({ ownerId: alice.id }, program.id, body({ days: [] })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses another athlete’s exercise in an edit', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const program = await written(alice.id);
    const bobs = await createExercise({ ownerId: bob.id });

    await expect(
      programs().update(
        { ownerId: alice.id },
        program.id,
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

  it('is a 404 for another athlete’s program', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const bobs = await written(bob.id);

    await expect(
      programs().update({ ownerId: alice.id }, bobs.id, longerMonday()),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(await mondayGroups(bobs.id)).toEqual(['pull', 'push_vertical']);
  });

  it('is a 404 for a global program from the owner’s route', async () => {
    const alice = await createUser();
    const global = await programs().create({ ownerId: null }, body());

    await expect(
      programs().update({ ownerId: alice.id }, global.id, longerMonday()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses Just WODs, whoever asks', async () => {
    const alice = await createUser();

    for (const writer of [{ ownerId: alice.id }, { ownerId: null }]) {
      await expect(
        programs().update(writer, DEFAULT_PROGRAM_ID, body()),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it('refuses an archived program until it is brought back', async () => {
    const alice = await createUser();
    const program = await written(alice.id);
    await testPrisma().program.update({
      where: { id: program.id },
      data: { archivedAt: new Date() },
    });

    await expect(
      programs().update({ ownerId: alice.id }, program.id, body()),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

/**
 * A day's own name (DN-155). Wording, like the program's name: it saves in
 * place even once someone has started the program, and never forks it.
 */
describe('naming the days of a program', () => {
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
    const program = await programs().create({ ownerId: alice.id }, sent);

    expect(await labels(program.id)).toEqual({ 1: 'Upper', 4: null });
    const { program: back } = await programs().getForEditing(
      { ownerId: alice.id },
      program.id,
    );
    expect(back.days.map((d) => d.label)).toEqual(['Upper', undefined]);
  });

  it('renames a day in place once someone has started it, never forking', async () => {
    const alice = await createUser();
    const program = await programs().create(
      { ownerId: alice.id },
      named({ 1: 'Upper', 4: null }),
    );
    await createEnrollment(alice.id, { programId: program.id });
    const slotIds = (await stored(program.id)).weeks[0].slots.map((s) => s.id);

    const saved = await programs().update(
      { ownerId: alice.id },
      program.id,
      named({ 1: 'Push', 4: 'Legs' }),
    );

    expect(saved).toMatchObject({ forked: false, program: { id: program.id } });
    expect(await labels(program.id)).toEqual({ 1: 'Push', 4: 'Legs' });
    expect((await stored(program.id)).weeks[0].slots.map((s) => s.id)).toEqual(
      slotIds,
    );
    expect(
      await testPrisma().program.count({ where: { ownerId: alice.id } }),
    ).toBe(1);
  });

  it('clears a name in place, too', async () => {
    const alice = await createUser();
    const program = await programs().create(
      { ownerId: alice.id },
      named({ 1: 'Upper', 4: 'Lower' }),
    );
    await createEnrollment(alice.id, { programId: program.id });

    await programs().update(
      { ownerId: alice.id },
      program.id,
      named({ 1: null }),
    );

    expect(await labels(program.id)).toEqual({ 1: null, 4: null });
  });

  it('carries the names into a fork of a changed week', async () => {
    const alice = await createUser();
    const program = await programs().create(
      { ownerId: alice.id },
      named({ 1: 'Upper', 4: 'Lower' }),
    );
    await createEnrollment(alice.id, { programId: program.id });

    const saved = await programs().update(
      { ownerId: alice.id },
      program.id,
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
    expect(await labels(saved.program.id)).toEqual({ 1: 'Push', 4: 'Lower' });
    expect(await labels(program.id)).toEqual({ 1: 'Upper', 4: 'Lower' });
  });

  it('carries the names into a copy', async () => {
    const alice = await createUser();
    const source = await programs().create(
      { ownerId: null },
      named({ 1: 'Upper', 4: 'Lower' }),
    );

    const mine = await programs().create(
      { ownerId: alice.id },
      await programs().getForCopy(source.id),
    );

    expect(await labels(mine.id)).toEqual({ 1: 'Upper', 4: 'Lower' });
  });

  it('shows Today the day’s name', async () => {
    const alice = await createUser();
    const program = await programs().create(
      { ownerId: alice.id },
      named({ 1: 'Upper', 4: null }),
    );
    await createEnrollment(alice.id, { programId: program.id });

    const active = await loadActiveProgram(testPrisma(), alice.id);
    expect(
      active?.authoredWeeks[0].slots.map((s) => [s.dayOfWeek, s.label]),
    ).toEqual(
      expect.arrayContaining([
        [1, 'Upper'],
        [4, null],
      ]),
    );
  });
});

describe('ProgramsService.getForEditing', () => {
  it('reads the program back as the body that wrote it', async () => {
    const alice = await createUser();
    const sent = body({ summary: 'Two days.' });
    const program = await programs().create({ ownerId: alice.id }, sent);

    expect(
      await programs().getForEditing({ ownerId: alice.id }, program.id),
    ).toEqual({
      id: program.id,
      program: sent,
      hasRuns: false,
      archived: false,
    });
  });

  it('gives back no summary where the stored one was written from the schedule', async () => {
    const alice = await createUser();
    const program = await programs().create({ ownerId: alice.id }, body());

    const loaded = await programs().getForEditing(
      { ownerId: alice.id },
      program.id,
    );

    expect(loaded.program.summary).toBeNull();
  });

  it('says when someone has started it', async () => {
    const alice = await createUser();
    const program = await programs().create({ ownerId: alice.id }, body());
    await createEnrollment(alice.id, {
      programId: program.id,
      status: 'completed',
    });

    expect(
      (await programs().getForEditing({ ownerId: alice.id }, program.id))
        .hasRuns,
    ).toBe(true);
  });

  it('is a 404 for another athlete’s program', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const bobs = await programs().create({ ownerId: bob.id }, body());

    await expect(
      programs().getForEditing({ ownerId: alice.id }, bobs.id),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ProgramsService.archive and restore', () => {
  const TODAY = '2026-10-12';

  async function offered(userId: string) {
    const setup = new SetupService(testPrisma() as unknown as PrismaService);
    return (await setup.options(userId, TODAY)).programs.map((p) => p.id);
  }

  it('takes a program out of setup, and restore puts it back', async () => {
    const alice = await createUser();
    const program = await programs().create({ ownerId: alice.id }, body());
    expect(await offered(alice.id)).toContain(program.id);

    const removed = await programs().archive({ ownerId: alice.id }, program.id);
    expect(removed).toEqual({
      program: { ...program, archived: true },
      running: false,
    });
    expect(await offered(alice.id)).not.toContain(program.id);

    const restored = await programs().restore(
      { ownerId: alice.id },
      program.id,
    );
    expect(restored).toEqual({ ...program, archived: false });
    expect(await offered(alice.id)).toContain(program.id);
  });

  it('leaves the run under way on it resolving, and says it is running', async () => {
    const alice = await createUser();
    const program = await programs().create({ ownerId: alice.id }, body());
    await createEnrollment(alice.id, { programId: program.id });
    const before = await loadActiveProgram(testPrisma(), alice.id);

    const removed = await programs().archive({ ownerId: alice.id }, program.id);

    expect(removed.running).toBe(true);
    const after = await loadActiveProgram(testPrisma(), alice.id);
    expect(after?.programId).toBe(program.id);
    expect(after?.authoredWeeks).toEqual(before?.authoredWeeks);
  });

  it('does not count a finished run as running', async () => {
    const alice = await createUser();
    const program = await programs().create({ ownerId: alice.id }, body());
    await createEnrollment(alice.id, {
      programId: program.id,
      status: 'completed',
    });

    const removed = await programs().archive({ ownerId: alice.id }, program.id);
    expect(removed.running).toBe(false);
  });

  it('never deletes, even a program nobody ran', async () => {
    const alice = await createUser();
    const program = await programs().create({ ownerId: alice.id }, body());

    await programs().archive({ ownerId: alice.id }, program.id);

    const row = await stored(program.id);
    expect(row.archivedAt).not.toBeNull();
    expect(row.weeks[0].slots).toHaveLength(2);
  });

  it('is idempotent both ways', async () => {
    const alice = await createUser();
    const program = await programs().create({ ownerId: alice.id }, body());

    await programs().archive({ ownerId: alice.id }, program.id);
    const archivedAt = (await stored(program.id)).archivedAt;
    await programs().archive({ ownerId: alice.id }, program.id);
    expect((await stored(program.id)).archivedAt).toEqual(archivedAt);

    await programs().restore({ ownerId: alice.id }, program.id);
    const again = await programs().restore({ ownerId: alice.id }, program.id);
    expect(again.archived).toBe(false);
  });

  it('refuses a restore into a name a live program now holds', async () => {
    const alice = await createUser();
    const program = await programs().create({ ownerId: alice.id }, body());
    await programs().archive({ ownerId: alice.id }, program.id);
    await programs().create({ ownerId: alice.id }, body());

    await expect(
      programs().restore({ ownerId: alice.id }, program.id),
    ).rejects.toThrow(
      new ConflictException(
        'You already have a program called "Upper / Lower"',
      ),
    );
    expect((await stored(program.id)).archivedAt).not.toBeNull();
  });

  it("gives 404 for another athlete's program, either way", async () => {
    const alice = await createUser();
    const bob = await createUser();
    const program = await programs().create({ ownerId: alice.id }, body());

    await expect(
      programs().archive({ ownerId: bob.id }, program.id),
    ).rejects.toThrow(NotFoundException);
    await programs().archive({ ownerId: alice.id }, program.id);
    await expect(
      programs().restore({ ownerId: bob.id }, program.id),
    ).rejects.toThrow(NotFoundException);
    expect((await stored(program.id)).archivedAt).not.toBeNull();
  });

  it('will not archive Just WODs', async () => {
    const alice = await createUser();

    await expect(
      programs().archive({ ownerId: alice.id }, DEFAULT_PROGRAM_ID),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      programs().archive({ ownerId: null }, DEFAULT_PROGRAM_ID),
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

  it('creates a global program that every athlete is offered', async () => {
    const bob = await createUser();

    const created = await programs().create(GLOBAL, body());

    expect((await stored(created.id)).ownerId).toBeNull();
    expect(await offered(bob.id)).toContain(created.id);
    expect(await programs().listOwn(bob.id)).toEqual([]);
  });

  describe('promote', () => {
    it("publishes the admin's own program in place, their run carrying on", async () => {
      const admin = await createUser();
      const bob = await createUser();
      const program = await programs().create({ ownerId: admin.id }, body());
      await createEnrollment(admin.id, { programId: program.id });
      const before = await loadActiveProgram(testPrisma(), admin.id);

      const published = await programs().promote(admin.id, program.id);

      expect(published).toEqual(program);
      expect((await stored(program.id)).ownerId).toBeNull();
      const after = await loadActiveProgram(testPrisma(), admin.id);
      expect(after?.programId).toBe(program.id);
      expect(after?.authoredWeeks).toEqual(before?.authoredWeeks);
      expect(await offered(bob.id)).toContain(program.id);
      expect(await programs().listOwn(admin.id)).toEqual([]);
    });

    it('is refused when a live global program has the name', async () => {
      const admin = await createUser();
      await programs().create(GLOBAL, body());
      const program = await programs().create({ ownerId: admin.id }, body());

      await expect(programs().promote(admin.id, program.id)).rejects.toThrow(
        new ConflictException(
          'There is already a global program called "Upper / Lower"',
        ),
      );
      expect((await stored(program.id)).ownerId).toBe(admin.id);
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
      const mine = await programs().create(
        { ownerId: admin.id },
        named(towel.id),
      );

      await expect(programs().promote(admin.id, mine.id)).rejects.toThrow(
        new BadRequestException(
          'It names movements only you have: Towel row. Swap them for library ones before publishing it.',
        ),
      );
      expect((await stored(mine.id)).ownerId).toBe(admin.id);

      const library = await programs().create(
        { ownerId: admin.id },
        { ...named(chin.id), name: 'Chins' },
      );
      await expect(
        programs().promote(admin.id, library.id),
      ).resolves.toMatchObject({ id: library.id });
    });

    it('is refused while archived', async () => {
      const admin = await createUser();
      const program = await programs().create({ ownerId: admin.id }, body());
      await programs().archive({ ownerId: admin.id }, program.id);

      await expect(programs().promote(admin.id, program.id)).rejects.toThrow(
        ConflictException,
      );
    });

    it("cannot publish another athlete's program, or one already global", async () => {
      const admin = await createUser();
      const bob = await createUser();
      const bobs = await programs().create({ ownerId: bob.id }, body());
      const global = await programs().create(GLOBAL, body({ name: 'Ours' }));

      await expect(programs().promote(admin.id, bobs.id)).rejects.toThrow(
        NotFoundException,
      );
      await expect(programs().promote(admin.id, global.id)).rejects.toThrow(
        NotFoundException,
      );
      expect((await stored(bobs.id)).ownerId).toBe(bob.id);
    });
  });

  it("takes an archived global program off every picker but leaves an athlete's run on it", async () => {
    const admin = await createUser();
    const bob = await createUser();
    const program = await programs().create(GLOBAL, body());
    await createEnrollment(bob.id, { programId: program.id });

    const removed = await programs().archive(GLOBAL, program.id, admin.id);

    expect(removed.running).toBe(false);
    expect(await offered(admin.id)).not.toContain(program.id);
    expect(await offered(bob.id)).not.toContain(program.id);
    expect((await loadActiveProgram(testPrisma(), bob.id))?.programId).toBe(
      program.id,
    );

    await programs().restore(GLOBAL, program.id);
    expect(await offered(bob.id)).toContain(program.id);
  });

  it("says the admin's own run carries on when they archive what they run", async () => {
    const admin = await createUser();
    const program = await programs().create(GLOBAL, body());
    await createEnrollment(admin.id, { programId: program.id });

    const removed = await programs().archive(GLOBAL, program.id, admin.id);

    expect(removed.running).toBe(true);
  });

  it('forks a global program once any athlete has started it, still global', async () => {
    const bob = await createUser();
    const program = await programs().create(GLOBAL, body());
    await createEnrollment(bob.id, { programId: program.id });

    const saved = await programs().update(
      GLOBAL,
      program.id,
      body({ scheduleMode: 'fixed' }),
    );

    expect(saved.forked).toBe(true);
    expect((await stored(saved.program.id)).ownerId).toBeNull();
    expect((await stored(program.id)).archivedAt).not.toBeNull();
  });

  it("lists the global library, Just WODs first and built in, nobody's own", async () => {
    await upsertJustWods(testPrisma());
    const alice = await createUser();
    await programs().create({ ownerId: alice.id }, body({ name: 'Mine' }));
    const live = await programs().create(GLOBAL, body({ name: 'Zed' }));
    const old = await programs().create(GLOBAL, body({ name: 'Alpha' }));
    await programs().archive(GLOBAL, old.id);

    const listed = await programs().listGlobal();

    expect(listed.map((r) => [r.id, r.builtIn, r.archived])).toEqual([
      [DEFAULT_PROGRAM_ID, true, false],
      [live.id, false, false],
      [old.id, false, true],
    ]);
  });

  it('refuses Just WODs to the global writer as well', async () => {
    await upsertJustWods(testPrisma());

    await expect(
      programs().getForEditing(GLOBAL, DEFAULT_PROGRAM_ID),
    ).rejects.toThrow(NotFoundException);
    await expect(
      programs().restore(GLOBAL, DEFAULT_PROGRAM_ID),
    ).rejects.toThrow(NotFoundException);
  });
});

/** Everything a program is stored as, minus the ids that make it a row. */
async function shape(id: string) {
  const program = await stored(id);
  return program.weeks.map((week) => ({
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
          programSlotId: undefined,
        })),
      })),
  }));
}

describe('copying a global program (DN-149)', () => {
  const GLOBAL = { ownerId: null };

  async function copy(ownerId: string, sourceId: string) {
    const prefill = await programs().getForCopy(sourceId);
    return programs().create({ ownerId }, prefill);
  }

  it("saves a copy the caller owns, stored as the source's week", async () => {
    const alice = await createUser();
    const chin = await createExercise({ name: 'Chin-up' });
    const source = await programs().create(
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
    expect(await programs().listOwn(alice.id)).toEqual([mine]);
  });

  it('keeps the copy and the source apart, editing either way', async () => {
    const alice = await createUser();
    const source = await programs().create(GLOBAL, body());
    const mine = await copy(alice.id, source.id);
    const original = await shape(source.id);

    await programs().update(
      { ownerId: alice.id },
      mine.id,
      body({ name: 'Mine now', scheduleMode: 'fixed' }),
    );
    expect(await shape(source.id)).toEqual(original);
    expect((await stored(source.id)).name).toBe('Upper / Lower');

    const copied = await shape(mine.id);
    await programs().update(
      GLOBAL,
      source.id,
      body({ days: [{ dayOfWeek: 2, lines: [line()] }] }),
    );
    expect(await shape(mine.id)).toEqual(copied);
  });

  it("offers only live global programs, never Just WODs or anyone's own", async () => {
    await upsertJustWods(testPrisma());
    const alice = await createUser();
    const bob = await createUser();
    const live = await programs().create(GLOBAL, body({ name: 'Live' }));
    const retired = await programs().create(GLOBAL, body({ name: 'Retired' }));
    await programs().archive(GLOBAL, retired.id);
    const alices = await programs().create(
      { ownerId: alice.id },
      body({ name: 'Alices' }),
    );
    const bobs = await programs().create(
      { ownerId: bob.id },
      body({ name: 'Bobs' }),
    );

    expect((await programs().listCopyable()).map((r) => r.id)).toEqual([
      live.id,
    ]);

    for (const id of [retired.id, alices.id, bobs.id, DEFAULT_PROGRAM_ID]) {
      await expect(programs().getForCopy(id)).rejects.toThrow(
        NotFoundException,
      );
    }
  });

  it("makes an admin's copy personal, and publishable once renamed", async () => {
    const admin = await createUser();
    const source = await programs().create(GLOBAL, body());

    const mine = await copy(admin.id, source.id);
    expect((await stored(mine.id)).ownerId).toBe(admin.id);

    await expect(programs().promote(admin.id, mine.id)).rejects.toThrow(
      ConflictException,
    );
    await programs().update(
      { ownerId: admin.id },
      mine.id,
      body({ name: 'Upper / Lower II' }),
    );
    await expect(programs().promote(admin.id, mine.id)).resolves.toMatchObject({
      id: mine.id,
    });
  });
});

describe('exporting and importing global programs (DN-150)', () => {
  const GLOBAL = { ownerId: null };

  const envelope = (entries: unknown[]) => ({
    format: PROGRAM_EXPORT_FORMAT,
    version: PROGRAM_EXPORT_VERSION,
    programs: entries,
  });

  /** What an import refused, as the command would print it. */
  async function refusal(file: unknown) {
    const error: unknown = await programs()
      .importGlobal(file)
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    expect(error).toBeDefined();
    return failureLines(error);
  }

  async function globalCount() {
    return testPrisma().program.count({ where: { ownerId: null } });
  }

  it('round-trips: exported programs import into an empty library as they were', async () => {
    const chin = await createExercise({ name: 'Chin-up' });
    const pull = await programs().create(
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
    const legs = await programs().create(GLOBAL, body({ name: 'Legs' }));
    await programs().archive(GLOBAL, legs.id);
    const before = [await shape(legs.id), await shape(pull.id)];

    const file = await programs().exportGlobal({ ids: [pull.id, legs.id] });
    expect(file).toMatchObject({
      format: PROGRAM_EXPORT_FORMAT,
      version: PROGRAM_EXPORT_VERSION,
    });
    expect(file.programs.map((r) => r.name)).toEqual(['Legs', 'Pull focus']);

    await testPrisma().program.deleteMany({ where: { ownerId: null } });
    // Through JSON, as the file travels.
    const created = await programs().importGlobal(
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

  it('exports only global programs, and never Just WODs', async () => {
    await upsertJustWods(testPrisma());
    const alice = await createUser();
    const live = await programs().create(GLOBAL, body({ name: 'Live' }));
    const mine = await programs().create({ ownerId: alice.id }, body());

    for (const ids of [[live.id, mine.id], [DEFAULT_PROGRAM_ID], ['nope']]) {
      await expect(programs().exportGlobal({ ids })).rejects.toThrow(
        NotFoundException,
      );
    }
    await expect(programs().exportGlobal({ ids: [] })).rejects.toThrow(
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
    for (const l of lines) expect(l).toMatch(/^Program 2 \(Both\): /);
    expect(await globalCount()).toBe(0);
  });

  it('refuses a live name clash without overwriting, and rolls back what came before it', async () => {
    const existing = await programs().create(GLOBAL, body({ name: 'Taken' }));
    const original = await shape(existing.id);

    const lines = await refusal(
      envelope([
        body({ name: 'New one' }),
        body({ name: 'Taken', days: [{ dayOfWeek: 6, lines: [line()] }] }),
      ]),
    );

    expect(lines).toEqual([
      'Program 2 (Taken): There is already a global program called "Taken"',
    ]);
    expect(await globalCount()).toBe(1);
    expect(await shape(existing.id)).toEqual(original);
  });

  it('refuses two entries with one name, the second named', async () => {
    const lines = await refusal(
      envelope([body({ name: 'Twice' }), body({ name: 'Twice' })]),
    );
    expect(lines).toEqual([
      'Program 2 (Twice): There is already a global program called "Twice"',
    ]);
    expect(await globalCount()).toBe(0);
  });

  it('refuses a program naming a movement only one athlete has', async () => {
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
    expect(lines[0]).toMatch(/^Program 1 \(Upper \/ Lower\): /);
    expect(await globalCount()).toBe(0);
  });

  it('refuses a file that is not an export, or from another version', async () => {
    expect(await refusal([body()])).not.toEqual([]);
    expect(await refusal({ ...envelope([body()]), version: 2 })).toEqual([
      `version: this app reads program exports of version ${PROGRAM_EXPORT_VERSION}`,
    ]);
    expect(await refusal(envelope([]))).toEqual([
      'programs: the file holds no programs',
    ]);
    expect(await globalCount()).toBe(0);
  });

  it('reads the file the command is given, and says when it is not JSON', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'programs-'));
    const good = join(dir, 'good.json');
    const bad = join(dir, 'bad.json');
    await writeFile(
      good,
      JSON.stringify(envelope([body({ name: 'From disk' })])),
    );
    await writeFile(bad, 'not json');

    const created = await importProgramsFile(programs(), good);
    expect(created.map((r) => r.name)).toEqual(['From disk']);

    await expect(importProgramsFile(programs(), bad)).rejects.toThrow(
      `${bad} is not JSON. Is it a program export?`,
    );
    await expect(
      importProgramsFile(programs(), join(dir, 'missing.json')),
    ).rejects.toThrow(/^Can't read /);
  });

  it('loads a file exported before programs were called programs (DN-177)', async () => {
    // Spelled out rather than built from the constants, because this is the
    // file as it was written then: its own format string, its list under
    // `routines`.
    const dir = await mkdtemp(join(tmpdir(), 'programs-'));
    const old = join(dir, 'routines.json');
    await writeFile(
      old,
      JSON.stringify({
        format: 'regimen-works/routines',
        version: 1,
        routines: [body({ name: 'Written last month' })],
      }),
    );

    const created = await importProgramsFile(programs(), old);

    expect(created.map((r) => [r.name, r.archived])).toEqual([
      ['Written last month', false],
    ]);
    expect(await globalCount()).toBe(1);
  });
});
