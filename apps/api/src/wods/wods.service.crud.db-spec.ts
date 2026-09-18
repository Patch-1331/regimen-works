import type { CreateWod, CreateWodMovement } from '@regimen-works/shared';
import type { PrismaService } from '../prisma/prisma.service';
import { WodsService } from './wods.service';
import { testPrisma } from '../test-support/database';
import {
  createAssignment,
  createExercise,
  createUser,
  createWod,
} from '../test-support/fixtures';

/**
 * The WOD write path (DN-26), against a real database.
 *
 * Three things here can only be tested against Postgres. The CHECK constraint
 * holding `reps = sum(repScheme)` is enforced by the database rather than by
 * validation; the partial unique index over global names is invisible to
 * Prisma; and the movement list is written through a nested delete-and-create
 * whose atomicity is the transaction's, not the service's.
 */

function wods(): WodsService {
  return new WodsService(testPrisma() as unknown as PrismaService);
}

const ADMIN = { ownerId: null };

/** A complete, coherent body — each test changes only the field it is about. */
function body(overrides: Partial<CreateWod> = {}): CreateWod {
  return {
    name: 'Fran',
    type: 'for_time',
    timeCapMinutes: 12,
    rounds: null,
    workSeconds: null,
    restSeconds: null,
    intervalCount: null,
    isNamed: true,
    dominantPattern: 'push',
    description: null,
    movements: [],
    ...overrides,
  };
}

/** One movement, flat unless a ladder is asked for. */
function movement(
  exerciseId: string,
  overrides: Partial<CreateWodMovement> = {},
): CreateWodMovement {
  return { exerciseId, reps: 21, repScheme: [], ...overrides };
}

/** A body whose single movement points at a freshly made global exercise. */
async function bodyOn(overrides: Partial<CreateWod> = {}): Promise<CreateWod> {
  const exercise = await createExercise();
  return body({ movements: [movement(exercise.id)], ...overrides });
}

describe('who may write which tier', () => {
  it('lands an athlete’s create in their own library, not the shared one', async () => {
    const alice = await createUser();

    const created = await wods().create({ ownerId: alice.id }, await bodyOn());

    expect(created.ownerId).toBe(alice.id);
  });

  it('lands an admin’s create in the shared library', async () => {
    const created = await wods().create(ADMIN, await bodyOn());

    expect(created.ownerId).toBeNull();
  });

  it('refuses an athlete editing a global WOD', async () => {
    const alice = await createUser();
    const global = await createWod({ name: 'Murph' });

    await expect(
      wods().update({ ownerId: alice.id }, global.id, { name: 'Mine now' }),
    ).rejects.toThrow(/edited by an admin/i);
  });

  it('refuses an admin editing an athlete’s own WOD', async () => {
    const alice = await createUser();
    const hers = await wods().create({ ownerId: alice.id }, await bodyOn());

    await expect(
      wods().update(ADMIN, hers.id, { name: 'Curated' }),
    ).rejects.toThrow(/belongs to an athlete/i);
  });

  it('refuses one athlete editing another’s', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const hers = await wods().create({ ownerId: alice.id }, await bodyOn());

    await expect(
      wods().update({ ownerId: bob.id }, hers.id, { name: 'Mine' }),
    ).rejects.toThrow(/edited by an admin/i);
  });

  it('reports a WOD that does not exist as not found', async () => {
    await expect(wods().update(ADMIN, 'nope', { name: 'x' })).rejects.toThrow(
      /not found/i,
    );
  });
});

describe('names', () => {
  it('refuses a second WOD of the same name in the same tier', async () => {
    await wods().create(ADMIN, await bodyOn());

    await expect(wods().create(ADMIN, await bodyOn())).rejects.toThrow(
      /already called "Fran"/,
    );
  });

  it('points at the retired WOD holding the name rather than the index', async () => {
    const created = await wods().create(ADMIN, await bodyOn());
    await wods().archive(ADMIN, created.id);

    await expect(wods().create(ADMIN, await bodyOn())).rejects.toThrow(
      /un-archive it instead/i,
    );
  });

  it('lets an athlete’s own WOD shadow a global name', async () => {
    const alice = await createUser();
    await wods().create(ADMIN, await bodyOn());

    const hers = await wods().create({ ownerId: alice.id }, await bodyOn());

    expect(hers.name).toBe('Fran');
  });

  it('lets two athletes each have one of the same name', async () => {
    const alice = await createUser();
    const bob = await createUser();
    await wods().create({ ownerId: alice.id }, await bodyOn());

    const his = await wods().create({ ownerId: bob.id }, await bodyOn());

    expect(his.name).toBe('Fran');
  });

  it('does not read a PATCH restating the current name as a collision', async () => {
    const created = await wods().create(ADMIN, await bodyOn());

    const updated = await wods().update(ADMIN, created.id, {
      name: 'Fran',
      timeCapMinutes: 20,
    });

    expect(updated.timeCapMinutes).toBe(20);
  });
});

describe('the one-way reference rule (DN-93)', () => {
  it('refuses a global WOD naming an athlete’s own exercise', async () => {
    const alice = await createUser();
    const hers = await createExercise({ ownerId: alice.id });

    await expect(
      wods().create(ADMIN, body({ movements: [movement(hers.id)] })),
    ).rejects.toThrow(/cannot point at/i);
  });

  it('lets an athlete’s WOD name their own exercise', async () => {
    const alice = await createUser();
    const hers = await createExercise({ ownerId: alice.id });

    const created = await wods().create(
      { ownerId: alice.id },
      body({ movements: [movement(hers.id)] }),
    );

    expect(created.movements[0].exerciseId).toBe(hers.id);
  });

  it('lets an athlete’s WOD name a global exercise', async () => {
    const alice = await createUser();

    const created = await wods().create({ ownerId: alice.id }, await bodyOn());

    expect(created.movements).toHaveLength(1);
  });

  it('refuses an athlete naming another athlete’s exercise', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const his = await createExercise({ ownerId: bob.id });

    await expect(
      wods().create(
        { ownerId: alice.id },
        body({ movements: [movement(his.id)] }),
      ),
    ).rejects.toThrow(/cannot point at/i);
  });

  it('refuses a movement naming a retired exercise', async () => {
    const retired = await createExercise({ archivedAt: new Date() });

    await expect(
      wods().create(ADMIN, body({ movements: [movement(retired.id)] })),
    ).rejects.toThrow(/cannot point at/i);
  });

  it('counts the misses rather than naming which id failed', async () => {
    const alice = await createUser();
    const hers = await createExercise({ ownerId: alice.id });
    const ok = await createExercise();

    await expect(
      wods().create(
        ADMIN,
        body({ movements: [movement(ok.id), movement(hers.id)] }),
      ),
    ).rejects.toThrow(/1 of 2 movements/);
  });

  it('applies the rule to a PATCH that swaps the list', async () => {
    const alice = await createUser();
    const hers = await createExercise({ ownerId: alice.id });
    const global = await wods().create(ADMIN, await bodyOn());

    await expect(
      wods().update(ADMIN, global.id, { movements: [movement(hers.id)] }),
    ).rejects.toThrow(/cannot point at/i);
  });
});

describe('reps and the rep scheme', () => {
  it('derives reps from a ladder rather than taking the caller’s total', async () => {
    const exercise = await createExercise();

    const created = await wods().create(
      ADMIN,
      body({
        movements: [
          movement(exercise.id, { reps: null, repScheme: [21, 15, 9] }),
        ],
      }),
    );

    expect(created.movements[0].reps).toBe(45);
  });

  it('keeps a flat movement’s own count', async () => {
    const exercise = await createExercise();

    const created = await wods().create(
      ADMIN,
      body({ movements: [movement(exercise.id, { reps: 30 })] }),
    );

    expect(created.movements[0].reps).toBe(30);
    expect(created.movements[0].repScheme).toEqual([]);
  });

  it('numbers the movements by their place in the list', async () => {
    const a = await createExercise();
    const b = await createExercise();
    const c = await createExercise();

    const created = await wods().create(
      ADMIN,
      body({ movements: [movement(a.id), movement(b.id), movement(c.id)] }),
    );

    expect(created.movements.map((m) => m.order)).toEqual([0, 1, 2]);
    expect(created.movements.map((m) => m.exerciseId)).toEqual([
      a.id,
      b.id,
      c.id,
    ]);
  });
});

describe('the movement list is written whole', () => {
  it('replaces the list when a PATCH carries one', async () => {
    const a = await createExercise();
    const b = await createExercise();
    const created = await wods().create(
      ADMIN,
      body({ movements: [movement(a.id)] }),
    );

    const updated = await wods().update(ADMIN, created.id, {
      movements: [movement(b.id, { reps: 5 })],
    });

    expect(updated.movements).toHaveLength(1);
    expect(updated.movements[0].exerciseId).toBe(b.id);
    expect(updated.movements[0].reps).toBe(5);
  });

  it('leaves the list alone when a PATCH does not carry one', async () => {
    const created = await wods().create(ADMIN, await bodyOn());

    const updated = await wods().update(ADMIN, created.id, {
      description: 'One pass, for time',
    });

    expect(updated.movements).toHaveLength(1);
    expect(updated.description).toBe('One pass, for time');
  });

  it('leaves no orphaned movement rows behind a replacement', async () => {
    const a = await createExercise();
    const b = await createExercise();
    const created = await wods().create(
      ADMIN,
      body({ movements: [movement(a.id), movement(b.id)] }),
    );

    await wods().update(ADMIN, created.id, { movements: [movement(a.id)] });

    const rows = await testPrisma().wodMovement.count({
      where: { wodId: created.id },
    });
    expect(rows).toBe(1);
  });
});

describe('interval structure', () => {
  it('stores the timer fields on an EMOM', async () => {
    const created = await wods().create(
      ADMIN,
      await bodyOn({
        type: 'emom',
        workSeconds: 40,
        restSeconds: 20,
        intervalCount: 12,
      }),
    );

    expect(created.workSeconds).toBe(40);
    expect(created.intervalCount).toBe(12);
  });

  it('leaves them null on an EMOM that does not state them', async () => {
    const created = await wods().create(ADMIN, await bodyOn({ type: 'emom' }));

    expect(created.workSeconds).toBeNull();
  });

  it('refuses timer fields on a format that runs no intervals', async () => {
    await expect(
      wods().create(ADMIN, await bodyOn({ type: 'amrap', workSeconds: 40 })),
    ).rejects.toThrow(/stored and never read/i);
  });

  it('refuses a PATCH that leaves timer fields stranded on a new type', async () => {
    const created = await wods().create(
      ADMIN,
      await bodyOn({ type: 'emom', workSeconds: 40 }),
    );

    // The patch itself names no timer field. The row it produces still has
    // one, which is exactly the case a per-request check would wave through.
    await expect(
      wods().update(ADMIN, created.id, { type: 'amrap' }),
    ).rejects.toThrow(/stored and never read/i);
  });

  it('lets that PATCH through once it clears them too', async () => {
    const created = await wods().create(
      ADMIN,
      await bodyOn({ type: 'emom', workSeconds: 40 }),
    );

    const updated = await wods().update(ADMIN, created.id, {
      type: 'amrap',
      workSeconds: null,
    });

    expect(updated.type).toBe('amrap');
  });
});

describe('archiving', () => {
  it('hides an archived WOD from the pool', async () => {
    const alice = await createUser();
    const created = await wods().create({ ownerId: alice.id }, await bodyOn());

    await wods().archive({ ownerId: alice.id }, created.id);

    const pool = await wods().findAll(alice.id);
    expect(pool.map((w) => w.id)).not.toContain(created.id);
  });

  it('is idempotent', async () => {
    const created = await wods().create(ADMIN, await bodyOn());
    const first = await wods().archive(ADMIN, created.id);

    const second = await wods().archive(ADMIN, created.id);

    expect(second.archivedAt).toEqual(first.archivedAt);
  });

  it('archives a WOD an athlete has already been assigned', async () => {
    const alice = await createUser();
    const created = await wods().create(ADMIN, await bodyOn());
    await createAssignment(alice.id, { wodId: created.id });

    const archived = await wods().archive(ADMIN, created.id);

    expect(archived.archivedAt).not.toBeNull();
  });

  it('keeps that assignment resolvable, so history still renders', async () => {
    const alice = await createUser();
    const created = await wods().create(ADMIN, await bodyOn());
    const assignment = await createAssignment(alice.id, { wodId: created.id });
    await wods().archive(ADMIN, created.id);

    const row = await testPrisma().dailyAssignment.findUnique({
      where: { id: assignment.id },
      include: { wod: true },
    });

    expect(row?.wod?.name).toBe('Fran');
  });

  it('brings one back', async () => {
    const created = await wods().create(ADMIN, await bodyOn());
    await wods().archive(ADMIN, created.id);

    const back = await wods().unarchive(ADMIN, created.id);

    expect(back.archivedAt).toBeNull();
  });

  it('refuses to un-archive into a movement the pool no longer offers', async () => {
    const exercise = await createExercise();
    const created = await wods().create(
      ADMIN,
      body({ movements: [movement(exercise.id)] }),
    );
    await wods().archive(ADMIN, created.id);
    await testPrisma().exercise.update({
      where: { id: exercise.id },
      data: { archivedAt: new Date() },
    });

    await expect(wods().unarchive(ADMIN, created.id)).rejects.toThrow(
      /cannot point at/i,
    );
  });

  it('is a no-op on a live WOD, without re-checking it', async () => {
    // The re-check belongs to coming back into the pool, not to being in it.
    // A live WOD whose exercise has since been retired is a real row the
    // library already holds — an unarchive that judged it would refuse a call
    // that changes nothing, and report a problem it is not the fix for.
    const exercise = await createExercise();
    const created = await wods().create(
      ADMIN,
      body({ movements: [movement(exercise.id)] }),
    );
    await testPrisma().exercise.update({
      where: { id: exercise.id },
      data: { archivedAt: new Date() },
    });

    const same = await wods().unarchive(ADMIN, created.id);

    expect(same.archivedAt).toBeNull();
  });
});
