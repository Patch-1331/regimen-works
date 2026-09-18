import type { CreateExercise } from '@regimen-works/shared';
import type { PrismaService } from '../prisma/prisma.service';
import { ExercisesService } from './exercises.service';
import { testPrisma } from '../test-support/database';
import { createExercise, createUser } from '../test-support/fixtures';

/**
 * The library write path (DN-25), against a real database.
 *
 * Two tiers, two writers: an admin curating global content (`ownerId: null`)
 * and an athlete authoring their own. Almost every rule here is about what
 * one of them must *not* be able to do to the other's rows, or about a gap
 * that reports itself nowhere at runtime — `applyEquipmentAvailability` hands
 * the athlete the movement they cannot do and says nothing, so the write is
 * the only place left to catch it.
 */

function exercises(): ExercisesService {
  return new ExercisesService(testPrisma() as unknown as PrismaService);
}

const ADMIN = { ownerId: null };

/** A complete, coherent body — each test changes only the field it is about. */
function body(overrides: Partial<CreateExercise> = {}): CreateExercise {
  return {
    name: 'Ring row',
    pattern: 'pull',
    equipment: [],
    scalable: false,
    unit: 'reps',
    instructions: null,
    line: null,
    rung: null,
    altExerciseId: null,
    phase: null,
    ...overrides,
  };
}

describe('who may write which tier', () => {
  it('lands an athlete’s create in their own library, not the shared one', async () => {
    const alice = await createUser();

    const created = await exercises().create({ ownerId: alice.id }, body());

    expect(created.ownerId).toBe(alice.id);
  });

  it('lands an admin’s create in the shared library', async () => {
    const created = await exercises().create(ADMIN, body());

    expect(created.ownerId).toBeNull();
  });

  it('refuses an athlete editing global content', async () => {
    const alice = await createUser();
    const global = await createExercise({ name: 'Air squat' });

    await expect(
      exercises().update({ ownerId: alice.id }, global.id, { scalable: true }),
    ).rejects.toThrow(/admin/i);
  });

  // Admin curates the shared library; it is not a superuser flag over
  // everyone's own content. Nothing else in the suite pins that reading.
  it('refuses an admin editing an athlete’s own exercise', async () => {
    const alice = await createUser();
    const hers = await createExercise({
      name: 'Sandbag clean',
      ownerId: alice.id,
    });

    await expect(
      exercises().update(ADMIN, hers.id, { scalable: true }),
    ).rejects.toThrow(/athlete/i);
  });

  it('refuses an athlete editing another athlete’s exercise', async () => {
    const [alice, bob] = [await createUser(), await createUser()];
    const his = await createExercise({ name: 'Tyre flip', ownerId: bob.id });

    await expect(
      exercises().update({ ownerId: alice.id }, his.id, { scalable: true }),
    ).rejects.toThrow();
  });
});

describe('names', () => {
  it('lets two athletes use the same name', async () => {
    const [alice, bob] = [await createUser(), await createUser()];

    await exercises().create({ ownerId: alice.id }, body({ name: 'Burpee' }));
    const his = await exercises().create(
      { ownerId: bob.id },
      body({ name: 'Burpee' }),
    );

    expect(his.name).toBe('Burpee');
  });

  it('lets an athlete shadow a global name with their own', async () => {
    const alice = await createUser();
    await createExercise({ name: 'Push-up' });

    const hers = await exercises().create(
      { ownerId: alice.id },
      body({ name: 'Push-up' }),
    );

    expect(hers.ownerId).toBe(alice.id);
  });

  it('refuses a second row of the same name in the same tier', async () => {
    const alice = await createUser();
    await exercises().create({ ownerId: alice.id }, body({ name: 'Burpee' }));

    await expect(
      exercises().create({ ownerId: alice.id }, body({ name: 'Burpee' })),
    ).rejects.toThrow(/already called/i);
  });

  // The unique index counts archived rows, so a create would otherwise die on
  // a raw constraint violation with nothing pointing at the fix.
  it('says so when the name is held by a retired row', async () => {
    const alice = await createUser();
    const hers = await exercises().create(
      { ownerId: alice.id },
      body({ name: 'Burpee' }),
    );
    await exercises().archive({ ownerId: alice.id }, hers.id);

    await expect(
      exercises().create({ ownerId: alice.id }, body({ name: 'Burpee' })),
    ).rejects.toThrow(/un-archive/i);
  });

  it('lets a rename settle on the row’s own current name', async () => {
    const alice = await createUser();
    const hers = await exercises().create(
      { ownerId: alice.id },
      body({ name: 'Burpee' }),
    );

    const updated = await exercises().update({ ownerId: alice.id }, hers.id, {
      name: 'Burpee',
      scalable: true,
    });

    expect(updated.scalable).toBe(true);
  });
});

describe('what a patch means', () => {
  // Absent and null are different words. `.partial()` keeps each field's own
  // type, so a form that sends only what changed and a form that clears a
  // field are told apart — and a patch that omits a field must never be read
  // as a patch that nulls it.
  it('leaves out what it does not mention', async () => {
    const alice = await createUser();
    const hers = await exercises().create(
      { ownerId: alice.id },
      body({
        instructions: 'Chest to the bar.',
        phase: 'warmup',
        line: 'pull',
        rung: 1,
      }),
    );

    const updated = await exercises().update({ ownerId: alice.id }, hers.id, {
      scalable: true,
    });

    expect(updated.instructions).toBe('Chest to the bar.');
    expect(updated.phase).toBe('warmup');
    expect(updated.line).toBe('pull');
    expect(updated.rung).toBe(1);
    expect(updated.pattern).toBe('pull');
  });

  it('clears what it explicitly nulls', async () => {
    const alice = await createUser();
    const hers = await exercises().create(
      { ownerId: alice.id },
      body({
        instructions: 'Chest to the bar.',
        phase: 'warmup',
        line: 'pull',
        rung: 1,
      }),
    );

    const updated = await exercises().update({ ownerId: alice.id }, hers.id, {
      instructions: null,
      phase: null,
      pattern: null,
      line: null,
      rung: null,
    });

    expect(updated.instructions).toBeNull();
    expect(updated.phase).toBeNull();
    expect(updated.pattern).toBeNull();
    expect(updated.line).toBeNull();
  });

  // The one clearing that is not just a database write: nulling the way out
  // of a movement that needs equipment has to be judged against the row as it
  // will be, or the check reads a fallback the patch has just removed.
  it('re-judges the row once a patch clears its fallback', async () => {
    const fallback = await createExercise({ name: 'Air squat', equipment: [] });
    const loaded = await exercises().create(
      ADMIN,
      body({
        name: 'Goblet squat',
        equipment: ['dumbbell'],
        altExerciseId: fallback.id,
      }),
    );

    await expect(
      exercises().update(ADMIN, loaded.id, { altExerciseId: null }),
    ).rejects.toThrow(/must name an alternative/i);
  });

  it('takes every field at once', async () => {
    const alice = await createUser();
    const fallback = await createExercise({
      name: 'Air squat',
      equipment: [],
      unit: 'seconds',
    });
    const hers = await exercises().create({ ownerId: alice.id }, body());

    const updated = await exercises().update({ ownerId: alice.id }, hers.id, {
      name: 'Goblet squat',
      pattern: 'squat',
      equipment: ['dumbbell'],
      scalable: true,
      unit: 'seconds',
      instructions: 'Elbows inside the knees.',
      line: 'squat',
      rung: 3,
      altExerciseId: fallback.id,
      phase: 'cooldown',
    });

    expect(updated.name).toBe('Goblet squat');
    expect(updated.equipment).toEqual(['dumbbell']);
    expect(updated.altExerciseId).toBe(fallback.id);
    expect(updated.rung).toBe(3);
  });
});

describe('what an alternative may be', () => {
  it('refuses a global row falling back to an athlete’s own', async () => {
    const alice = await createUser();
    const hers = await createExercise({
      name: 'Sandbag row',
      ownerId: alice.id,
    });

    await expect(
      exercises().create(ADMIN, body({ altExerciseId: hers.id })),
    ).rejects.toThrow(/not an exercise this write can point at/i);
  });

  it('lets an athlete’s row fall back to global content', async () => {
    const alice = await createUser();
    const global = await createExercise({ name: 'Air squat', equipment: [] });

    const hers = await exercises().create(
      { ownerId: alice.id },
      body({ altExerciseId: global.id }),
    );

    expect(hers.altExerciseId).toBe(global.id);
  });

  it('refuses an id lifted from another athlete’s library', async () => {
    const [alice, bob] = [await createUser(), await createUser()];
    const his = await createExercise({ name: 'Tyre flip', ownerId: bob.id });

    await expect(
      exercises().create(
        { ownerId: alice.id },
        body({ altExerciseId: his.id }),
      ),
    ).rejects.toThrow(/not an exercise this write can point at/i);
  });

  it('refuses an archived alternative', async () => {
    const global = await createExercise({
      name: 'Retired squat',
      archivedAt: new Date(),
    });

    await expect(
      exercises().create(ADMIN, body({ altExerciseId: global.id })),
    ).rejects.toThrow(/not an exercise this write can point at/i);
  });

  it('refuses an exercise that is its own alternative', async () => {
    const global = await createExercise({ name: 'Air squat' });

    await expect(
      exercises().update(ADMIN, global.id, { altExerciseId: global.id }),
    ).rejects.toThrow(/its own alternative/i);
  });

  // DN-113: the prescribed count carries over unchanged, so a reps movement
  // falling back to a timed one arrives meaning something else entirely.
  it('refuses a fallback counted in a different unit', async () => {
    const hold = await createExercise({ name: 'Plank', unit: 'seconds' });

    await expect(
      exercises().create(ADMIN, body({ unit: 'reps', altExerciseId: hold.id })),
    ).rejects.toThrow(/meaning something else/i);
  });
});

describe('a movement needing equipment needs a way out', () => {
  // DN-83. Every runtime layer passes the gap through rather than throwing,
  // so an athlete owning nothing is simply handed a movement they cannot do.
  it('refuses equipment with no alternative at all', async () => {
    await expect(
      exercises().create(ADMIN, body({ equipment: ['dumbbell'] })),
    ).rejects.toThrow(/must name an alternative/i);
  });

  it('refuses an alternative that itself needs equipment', async () => {
    const alsoLoaded = await createExercise({
      name: 'Kettlebell swing',
      equipment: ['kettlebell'],
    });

    await expect(
      exercises().create(
        ADMIN,
        body({ equipment: ['dumbbell'], altExerciseId: alsoLoaded.id }),
      ),
    ).rejects.toThrow(/one step/i);
  });

  it('accepts equipment with a bodyweight way out', async () => {
    const bodyweight = await createExercise({
      name: 'Air squat',
      equipment: [],
    });

    const created = await exercises().create(
      ADMIN,
      body({ equipment: ['dumbbell'], altExerciseId: bodyweight.id }),
    );

    expect(created.equipment).toEqual(['dumbbell']);
  });

  // The rule is judged against the row as it will be, not against the patch.
  it('refuses a patch that adds equipment to a row with no alternative', async () => {
    const global = await createExercise({ name: 'Air squat', equipment: [] });

    await expect(
      exercises().update(ADMIN, global.id, { equipment: ['dumbbell'] }),
    ).rejects.toThrow(/must name an alternative/i);
  });
});

describe('a position on a line is both halves', () => {
  it('refuses a line with no rung', async () => {
    await expect(
      exercises().create(ADMIN, body({ line: 'pull', rung: null })),
    ).rejects.toThrow(/line and rung/i);
  });

  it('refuses a rung with no line', async () => {
    await expect(
      exercises().create(ADMIN, body({ line: null, rung: 2 })),
    ).rejects.toThrow(/line and rung/i);
  });

  it('refuses a patch that clears only one of them', async () => {
    const global = await createExercise({
      name: 'Ring row',
      line: 'pull',
      rung: 1,
    });

    await expect(
      exercises().update(ADMIN, global.id, { rung: null }),
    ).rejects.toThrow(/line and rung/i);
  });
});

describe('archiving', () => {
  it('takes the movement out of the pool without deleting it', async () => {
    const alice = await createUser();
    const hers = await exercises().create({ ownerId: alice.id }, body());

    await exercises().archive({ ownerId: alice.id }, hers.id);

    expect(await exercises().findAll(alice.id)).toEqual([]);
    expect(
      await testPrisma().exercise.findUnique({ where: { id: hers.id } }),
    ).not.toBeNull();
  });

  it('brings it back', async () => {
    const alice = await createUser();
    const hers = await exercises().create({ ownerId: alice.id }, body());
    await exercises().archive({ ownerId: alice.id }, hers.id);

    await exercises().unarchive({ ownerId: alice.id }, hers.id);

    expect((await exercises().findAll(alice.id)).map((e) => e.name)).toEqual([
      'Ring row',
    ]);
  });

  // Silent otherwise: the resolver stops finding the substitute and hands the
  // athlete the movement they own no equipment for, reporting nothing.
  it('refuses to retire a movement something still falls back to', async () => {
    const bodyweight = await createExercise({
      name: 'Air squat',
      equipment: [],
    });
    await exercises().create(
      ADMIN,
      body({
        name: 'Goblet squat',
        equipment: ['dumbbell'],
        altExerciseId: bodyweight.id,
      }),
    );

    await expect(exercises().archive(ADMIN, bodyweight.id)).rejects.toThrow(
      /Goblet squat/,
    );
  });

  // An admin may not read athletes' libraries, so the referrers they cannot
  // see are counted instead of named.
  it('counts rather than names referrers in athletes’ own libraries', async () => {
    const alice = await createUser();
    const bodyweight = await createExercise({
      name: 'Air squat',
      equipment: [],
    });
    await exercises().create(
      { ownerId: alice.id },
      body({
        name: 'Alice goblet squat',
        equipment: ['dumbbell'],
        altExerciseId: bodyweight.id,
      }),
    );

    const archiving = exercises().archive(ADMIN, bodyweight.id);

    await expect(archiving).rejects.toThrow(/1 in athletes/i);
    await expect(archiving).rejects.not.toThrow(/Alice goblet squat/);
  });

  it('refuses to bring one back into a fallback that was retired meanwhile', async () => {
    const bodyweight = await createExercise({
      name: 'Air squat',
      equipment: [],
    });
    const loaded = await exercises().create(
      ADMIN,
      body({
        name: 'Goblet squat',
        equipment: ['dumbbell'],
        altExerciseId: bodyweight.id,
      }),
    );
    // Archive the loaded movement first, which frees the fallback to be
    // archived too — and now it has nothing to come back to.
    await exercises().archive(ADMIN, loaded.id);
    await exercises().archive(ADMIN, bodyweight.id);

    await expect(exercises().unarchive(ADMIN, loaded.id)).rejects.toThrow(
      /not an exercise this write can point at/i,
    );
  });

  // Both are idempotent, so a double-click is not an error and does not move
  // the timestamp — which is the record of when the movement was retired.
  it('is idempotent in both directions', async () => {
    const alice = await createUser();
    const hers = await exercises().create({ ownerId: alice.id }, body());

    const archived = await exercises().archive({ ownerId: alice.id }, hers.id);
    const again = await exercises().archive({ ownerId: alice.id }, hers.id);
    expect(again.archivedAt).toEqual(archived.archivedAt);

    await exercises().unarchive({ ownerId: alice.id }, hers.id);
    const live = await exercises().unarchive({ ownerId: alice.id }, hers.id);
    expect(live.archivedAt).toBeNull();
  });

  it('refuses to touch an exercise that does not exist', async () => {
    const alice = await createUser();

    await expect(
      exercises().archive({ ownerId: alice.id }, 'no-such-id'),
    ).rejects.toThrow(/not found/i);
  });

  it('refuses an athlete retiring global content', async () => {
    const alice = await createUser();
    const global = await createExercise({ name: 'Air squat' });

    await expect(
      exercises().archive({ ownerId: alice.id }, global.id),
    ).rejects.toThrow(/admin/i);
  });
});

describe('listing retired movements (DN-28)', () => {
  it('leaves them out of the pool by default', async () => {
    const alice = await createUser();
    const hers = await exercises().create({ ownerId: alice.id }, body());
    await exercises().archive({ ownerId: alice.id }, hers.id);

    const pool = await exercises().findAll(alice.id);

    expect(pool.map((e) => e.id)).not.toContain(hers.id);
  });

  it('includes them when the management screen asks', async () => {
    const alice = await createUser();
    const hers = await exercises().create({ ownerId: alice.id }, body());
    await exercises().archive({ ownerId: alice.id }, hers.id);

    const all = await exercises().findAll(alice.id, true);

    expect(all.map((e) => e.id)).toContain(hers.id);
  });

  it('still refuses another athlete’s movements either way', async () => {
    // The flag relaxes liveness, never ownership. Asked here because the two
    // clauses live in one helper, so a mistake in it would let both go.
    const alice = await createUser();
    const bob = await createUser();
    const his = await exercises().create({ ownerId: bob.id }, body());

    const all = await exercises().findAll(alice.id, true);

    expect(all.map((e) => e.id)).not.toContain(his.id);
  });

  it('carries global retired movements too, so an admin can bring one back', async () => {
    const alice = await createUser();
    const global = await exercises().create(ADMIN, body());
    await exercises().archive(ADMIN, global.id);

    const all = await exercises().findAll(alice.id, true);

    expect(all.map((e) => e.id)).toContain(global.id);
  });
});
