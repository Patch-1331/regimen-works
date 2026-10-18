import {
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { testPrisma } from '../test-support/database';
import {
  createChecklistEntry,
  createExercise,
  createUser,
} from '../test-support/fixtures';
import { ChecklistEntriesService } from './checklist-entries.service';

/**
 * An athlete's own warm-up and cool-down entries (DN-173): the writes that
 * replaced the library editor's old "Warm-up / cool-down" select. What the
 * checklist screens then make of them is `WodsService.getChecklists`, tested
 * in `wods.service.db-spec.ts`.
 */

function service(): ChecklistEntriesService {
  return new ChecklistEntriesService(testPrisma() as unknown as PrismaService);
}

describe('ChecklistEntriesService.create', () => {
  it("puts a global exercise on the athlete's own list", async () => {
    const alice = await createUser();
    const squat = await createExercise({ name: 'Air squat' });

    const entry = await service().create(alice.id, {
      exerciseId: squat.id,
      kind: 'warmup',
      pattern: 'squat',
    });

    expect(entry).toEqual({
      id: expect.any(String),
      kind: 'warmup',
      pattern: 'squat',
      sortOrder: 0,
      exercise: { id: squat.id, name: 'Air squat' },
    });
    const stored = await testPrisma().checklistEntry.findUniqueOrThrow({
      where: { id: entry.id },
    });
    expect(stored.ownerId).toBe(alice.id);
    expect(stored.instructions).toEqual([]);
  });

  it("puts the athlete's own exercise on their list", async () => {
    const alice = await createUser();
    const mine = await createExercise({ name: 'My stretch', ownerId: alice.id });

    const entry = await service().create(alice.id, {
      exerciseId: mine.id,
      kind: 'cooldown',
      pattern: null,
    });

    expect(entry.exercise.id).toBe(mine.id);
    expect(entry.pattern).toBeNull();
  });

  it('adds a new entry at the end of that list', async () => {
    const alice = await createUser();
    const [a, b, c] = [
      await createExercise({ name: 'A' }),
      await createExercise({ name: 'B' }),
      await createExercise({ name: 'C' }),
    ];

    await service().create(alice.id, { exerciseId: a.id, kind: 'warmup', pattern: null });
    // The other list keeps its own count.
    await service().create(alice.id, { exerciseId: c.id, kind: 'cooldown', pattern: null });
    const second = await service().create(alice.id, {
      exerciseId: b.id,
      kind: 'warmup',
      pattern: null,
    });

    expect(second.sortOrder).toBe(1);
  });

  it("refuses another athlete's exercise as if it were not there", async () => {
    const alice = await createUser();
    const bob = await createUser();
    const bobs = await createExercise({ name: "Bob's move", ownerId: bob.id });

    await expect(
      service().create(alice.id, { exerciseId: bobs.id, kind: 'warmup', pattern: null }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses a retired exercise', async () => {
    const alice = await createUser();
    const retired = await createExercise({ name: 'Old', archivedAt: new Date() });

    await expect(
      service().create(alice.id, { exerciseId: retired.id, kind: 'warmup', pattern: null }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses a movement already on that list with a 409, not a 500', async () => {
    const alice = await createUser();
    const squat = await createExercise({ name: 'Air squat' });
    await service().create(alice.id, { exerciseId: squat.id, kind: 'warmup', pattern: 'squat' });

    await expect(
      service().create(alice.id, { exerciseId: squat.id, kind: 'warmup', pattern: null }),
    ).rejects.toThrow(new ConflictException('Air squat is already on your warm-up.'));
  });

  it('lets one movement be on both lists', async () => {
    const alice = await createUser();
    const bridge = await createExercise({ name: 'Glute bridge' });

    await service().create(alice.id, { exerciseId: bridge.id, kind: 'warmup', pattern: 'hinge' });
    await expect(
      service().create(alice.id, { exerciseId: bridge.id, kind: 'cooldown', pattern: 'hinge' }),
    ).resolves.toMatchObject({ kind: 'cooldown' });
  });

  it('lets an athlete add a movement the global list already has', async () => {
    // Tiers are separate (ADR-0008); the read shows it once.
    const alice = await createUser();
    const squat = await createExercise({ name: 'Air squat' });
    await createChecklistEntry(squat.id, 'warmup', { pattern: 'squat' });

    await expect(
      service().create(alice.id, { exerciseId: squat.id, kind: 'warmup', pattern: 'squat' }),
    ).resolves.toMatchObject({ exercise: { id: squat.id } });
  });
});

describe('ChecklistEntriesService.list', () => {
  it("lists only the athlete's own entries, by list and then by position", async () => {
    const alice = await createUser();
    const bob = await createUser();
    const [a, b, c] = [
      await createExercise({ name: 'A' }),
      await createExercise({ name: 'B' }),
      await createExercise({ name: 'C' }),
    ];
    await createChecklistEntry(a.id, 'warmup', { ownerId: alice.id, sortOrder: 1 });
    await createChecklistEntry(b.id, 'warmup', { ownerId: alice.id, sortOrder: 0 });
    await createChecklistEntry(c.id, 'cooldown', { ownerId: alice.id, sortOrder: 0 });
    await createChecklistEntry(c.id, 'warmup', { ownerId: bob.id });
    await createChecklistEntry(c.id, 'warmup', { pattern: null }); // global

    const entries = await service().list(alice.id);

    expect(entries.map((e) => [e.kind, e.exercise.name])).toEqual([
      ['cooldown', 'C'],
      ['warmup', 'B'],
      ['warmup', 'A'],
    ]);
  });
});

describe('ChecklistEntriesService.remove', () => {
  it("takes an entry off the athlete's list", async () => {
    const alice = await createUser();
    const a = await createExercise({ name: 'A' });
    const entry = await createChecklistEntry(a.id, 'warmup', { ownerId: alice.id });

    await service().remove(alice.id, entry.id);

    expect(await testPrisma().checklistEntry.count()).toBe(0);
    // The movement itself is untouched.
    expect(await testPrisma().exercise.count({ where: { id: a.id } })).toBe(1);
  });

  it("refuses another athlete's entry, and a global one, as not found", async () => {
    const alice = await createUser();
    const bob = await createUser();
    const a = await createExercise({ name: 'A' });
    const bobs = await createChecklistEntry(a.id, 'warmup', { ownerId: bob.id });
    const global = await createChecklistEntry(a.id, 'cooldown');

    for (const id of [bobs.id, global.id]) {
      await expect(service().remove(alice.id, id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    }
    expect(await testPrisma().checklistEntry.count()).toBe(2);
  });
});

describe('ChecklistEntriesService.reorder', () => {
  async function aliceWithThree() {
    const alice = await createUser();
    const [a, b, c] = [
      await createExercise({ name: 'A' }),
      await createExercise({ name: 'B' }),
      await createExercise({ name: 'C' }),
    ];
    const entries = [
      await createChecklistEntry(a.id, 'warmup', { ownerId: alice.id, sortOrder: 0 }),
      await createChecklistEntry(b.id, 'warmup', { ownerId: alice.id, sortOrder: 1 }),
      await createChecklistEntry(c.id, 'warmup', { ownerId: alice.id, sortOrder: 2 }),
    ];
    return { alice, ids: entries.map((e) => e.id) };
  }

  it('puts the list in the order given and returns it', async () => {
    const { alice, ids } = await aliceWithThree();

    const list = await service().reorder(alice.id, {
      kind: 'warmup',
      entryIds: [ids[2], ids[0], ids[1]],
    });

    expect(list.map((e) => e.exercise.name)).toEqual(['C', 'A', 'B']);
    expect(list.map((e) => e.sortOrder)).toEqual([0, 1, 2]);
  });

  it('refuses a list that leaves an entry out, and changes nothing', async () => {
    // A stale screen: the athlete added an entry elsewhere since loading it.
    const { alice, ids } = await aliceWithThree();

    await expect(
      service().reorder(alice.id, { kind: 'warmup', entryIds: [ids[1], ids[0]] }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect((await service().list(alice.id)).map((e) => e.exercise.name)).toEqual([
      'A',
      'B',
      'C',
    ]);
  });

  it("refuses another athlete's entry in the list", async () => {
    const { alice, ids } = await aliceWithThree();
    const bob = await createUser();
    const x = await createExercise({ name: 'X' });
    const bobs = await createChecklistEntry(x.id, 'warmup', { ownerId: bob.id });

    await expect(
      service().reorder(alice.id, {
        kind: 'warmup',
        entryIds: [...ids, bobs.id],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
