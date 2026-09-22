import { testPrisma, withSeparateConnections } from '../test-support/database';
import {
  createAssignment,
  createEnrollment,
  createExercise,
  createPlan,
  createUser,
  createWod,
} from '../test-support/fixtures';

/**
 * The half of DN-9's schema that schema.prisma cannot hold.
 *
 * Nothing reads these models yet, so there is no service to test through --
 * but the constraints are the reason this issue is a migration and not four
 * model blocks. A partial unique index, two CHECKs and a composite foreign key
 * are invisible to Prisma's schema file, which means `prisma migrate dev` will
 * offer to drop them on the next change to any of these models, and a suite
 * that never exercised them would agree that dropping was fine.
 *
 * Read them as the specification the migration's comments describe in prose.
 */

/** Postgres error codes, so a test asserts which rule refused the write. */
const UNIQUE_VIOLATION = /Unique constraint|duplicate key/i;
const CHECK_VIOLATION = /violates check constraint|constraint failed/i;

describe('one active enrollment per athlete', () => {
  it('refuses a second active enrollment', async () => {
    const user = await createUser();
    await createEnrollment(user.id);

    await expect(createEnrollment(user.id)).rejects.toThrow(UNIQUE_VIOLATION);
  });

  it('allows a new one once the first is completed', async () => {
    const user = await createUser();
    const first = await createEnrollment(user.id);
    await testPrisma().planEnrollment.update({
      where: { id: first.id },
      data: { status: 'completed', completedAt: new Date() },
    });

    await expect(createEnrollment(user.id)).resolves.toBeDefined();
  });

  it('lets completed enrollments pile up, since they are a list the athlete keeps', async () => {
    const user = await createUser();
    await createEnrollment(user.id, { status: 'completed' });
    await createEnrollment(user.id, { status: 'completed' });

    expect(
      await testPrisma().planEnrollment.count({ where: { userId: user.id } }),
    ).toBe(2);
  });

  it('does not confine two athletes to one program between them', async () => {
    const [one, two] = [await createUser(), await createUser()];
    await createEnrollment(one.id);

    await expect(createEnrollment(two.id)).resolves.toBeDefined();
  });

  it('survives two tabs starting a program at the same moment', async () => {
    // The race the index exists for. Through the shared client these would
    // serialise on one connection and both succeed; two connections is what
    // two HTTP requests actually are (DN-105).
    const user = await createUser();
    const plan = await createPlan();

    const results = await withSeparateConnections(2, (clients) =>
      Promise.allSettled(
        clients.map((client) =>
          client.planEnrollment.create({
            data: {
              userId: user.id,
              planId: plan.id,
              startDate: '2026-09-16',
              weeks: 6,
            },
          }),
        ),
      ),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      await testPrisma().planEnrollment.count({
        where: { userId: user.id, status: 'active' },
      }),
    ).toBe(1);
  });
});

describe('a pinned slot has something pinned', () => {
  /** A slot on a throwaway plan, so each call is independent of the last. */
  async function slot(overrides: Record<string, unknown>) {
    const plan = await createPlan({
      weeks: { create: [{ order: 0, phase: 'core' }] },
    });
    const week = await testPrisma().planWeek.findFirstOrThrow({
      where: { planId: plan.id },
    });
    return testPrisma().planSlot.create({
      data: { planWeekId: week.id, dayOfWeek: 1, kind: 'rest', ...overrides },
    });
  }

  it('refuses a wod_pinned slot with no WOD', async () => {
    await expect(slot({ kind: 'wod_pinned' })).rejects.toThrow(CHECK_VIOLATION);
  });

  it('refuses a rest day that points at a WOD', async () => {
    const wod = await createWod();
    await expect(slot({ kind: 'rest', wodId: wod.id })).rejects.toThrow(
      CHECK_VIOLATION,
    );
  });

  it('refuses a wod_generated slot that pins one anyway', async () => {
    const wod = await createWod();
    await expect(
      slot({ kind: 'wod_generated', pattern: 'pull', wodId: wod.id }),
    ).rejects.toThrow(CHECK_VIOLATION);
  });

  it('accepts the two coherent shapes', async () => {
    const wod = await createWod();
    await expect(
      slot({ kind: 'wod_pinned', wodId: wod.id }),
    ).resolves.toBeDefined();
    await expect(
      slot({ kind: 'wod_generated', pattern: 'pull' }),
    ).resolves.toBeDefined();
  });

  it('refuses to delete a WOD a slot has pinned', async () => {
    // The foreign key is ON DELETE SET NULL, which alone would quietly empty
    // the slot. The CHECK turns that nulling into a failure, so the delete is
    // refused instead -- archiving is the answer here as everywhere else in
    // this library.
    const wod = await createWod();
    await slot({ kind: 'wod_pinned', wodId: wod.id });

    await expect(
      testPrisma().wod.delete({ where: { id: wod.id } }),
    ).rejects.toThrow(CHECK_VIOLATION);
  });
});

describe('the two schedule modes stay distinguishable', () => {
  it('refuses a fixed program carrying a days-per-week range', async () => {
    await expect(
      createPlan({
        scheduleMode: 'fixed',
        minDaysPerWeek: 3,
        maxDaysPerWeek: 5,
      }),
    ).rejects.toThrow(CHECK_VIOLATION);
  });

  it('refuses a flexible program missing either bound', async () => {
    await expect(createPlan({ maxDaysPerWeek: null })).rejects.toThrow(
      CHECK_VIOLATION,
    );
    await expect(createPlan({ minDaysPerWeek: null })).rejects.toThrow(
      CHECK_VIOLATION,
    );
  });

  it('accepts a fixed program that carries neither', async () => {
    await expect(
      createPlan({
        scheduleMode: 'fixed',
        minDaysPerWeek: null,
        maxDaysPerWeek: null,
      }),
    ).resolves.toBeDefined();
  });

  it('refuses a mode that is neither', async () => {
    // Not a third rule: the CHECK is written as two implications, so a value
    // outside the pair satisfies neither branch. Worth pinning, because that
    // is the behaviour a String column would otherwise leave to the writer.
    await expect(createPlan({ scheduleMode: 'whenever' })).rejects.toThrow(
      CHECK_VIOLATION,
    );
  });
});

describe('plan names', () => {
  it('refuses two global plans of the same name', async () => {
    await createPlan({ name: 'Just WODs' });

    await expect(createPlan({ name: 'Just WODs' })).rejects.toThrow(
      UNIQUE_VIOLATION,
    );
  });

  it('lets an athlete name their own plan after a global one', async () => {
    const user = await createUser();
    await createPlan({ name: 'Just WODs' });

    await expect(
      createPlan({ name: 'Just WODs', ownerId: user.id }),
    ).resolves.toBeDefined();
  });

  it('refuses one athlete two plans of the same name', async () => {
    const user = await createUser();
    await createPlan({ name: 'Mine', ownerId: user.id });

    await expect(
      createPlan({ name: 'Mine', ownerId: user.id }),
    ).rejects.toThrow(UNIQUE_VIOLATION);
  });
});

describe("an assignment cannot claim another athlete's enrollment", () => {
  it('refuses the cross-user write', async () => {
    const [mine, theirs] = [await createUser(), await createUser()];
    const enrollment = await createEnrollment(theirs.id);

    await expect(
      createAssignment(mine.id, { enrollmentId: enrollment.id }),
    ).rejects.toThrow(/foreign key|Foreign key/i);
  });

  it("accepts the athlete's own", async () => {
    const user = await createUser();
    const enrollment = await createEnrollment(user.id);

    const assignment = await createAssignment(user.id, {
      enrollmentId: enrollment.id,
      planDayIndex: 4,
    });
    expect(assignment.enrollmentId).toBe(enrollment.id);
  });

  it('refuses to delete an enrollment a trained day points at', async () => {
    // The guarantee is that a trained day is never separated from the program
    // it was part of, nor deleted along with it. NO ACTION, RESTRICT and even
    // the SET NULL Prisma would default to all deliver that here -- SET NULL
    // because `userId` is half this key and NOT NULL, so there is no null to
    // set. CASCADE is the one that does not, and is what this pins against.
    const user = await createUser();
    const enrollment = await createEnrollment(user.id);
    await createAssignment(user.id, { enrollmentId: enrollment.id });

    await expect(
      testPrisma().planEnrollment.delete({ where: { id: enrollment.id } }),
    ).rejects.toThrow();
  });

  it('still deletes an athlete who has both an enrollment and a day pointing at it', async () => {
    // The refusal above must not make an athlete undeletable. Both rows go in
    // one cascading statement from User, so the referencing day is gone by the
    // time the enrollment's own delete is checked.
    const user = await createUser();
    const enrollment = await createEnrollment(user.id);
    await createAssignment(user.id, { enrollmentId: enrollment.id });

    await testPrisma().user.delete({ where: { id: user.id } });

    expect(await testPrisma().planEnrollment.count()).toBe(0);
    expect(await testPrisma().dailyAssignment.count()).toBe(0);
  });

  it('refuses to delete a slot a trained day points at', async () => {
    // The same guarantee on the other program foreign key: editing a program
    // people are running archives rather than deletes.
    const user = await createUser();
    const plan = await createPlan({
      weeks: { create: [{ order: 0, phase: 'core' }] },
    });
    const week = await testPrisma().planWeek.findFirstOrThrow({
      where: { planId: plan.id },
    });
    const planSlot = await testPrisma().planSlot.create({
      data: { planWeekId: week.id, dayOfWeek: 1, kind: 'wod_generated' },
    });
    await createAssignment(user.id, { planSlotId: planSlot.id });

    await expect(
      testPrisma().planSlot.delete({ where: { id: planSlot.id } }),
    ).rejects.toThrow();
  });
});

/**
 * The prescription on a `movements` day (DN-19).
 *
 * Two CHECKs, both of them about rows nothing in the app can produce yet:
 * there is no program editor, and no seeded plan authors a `movements` slot.
 * That is exactly why they are written now -- the first author of one of
 * these rows will be a migration or a seed script, and neither gets a code
 * review that catches "sets: 0".
 */
describe('a prescribed movement names one movement and prescribes work', () => {
  /** A prescription row on a throwaway slot, so each call stands alone. */
  async function prescribe(overrides: Record<string, unknown> = {}) {
    const plan = await createPlan({
      weeks: {
        create: [
          {
            order: 0,
            phase: 'core',
            slots: { create: [{ dayOfWeek: 1, kind: 'movements' }] },
          },
        ],
      },
    });
    const planSlot = await testPrisma().planSlot.findFirstOrThrow({
      where: { planWeek: { planId: plan.id } },
    });
    return testPrisma().planSlotMovement.create({
      data: {
        planSlotId: planSlot.id,
        order: 0,
        movementGroup: 'pull',
        sets: 5,
        reps: 3,
        restSeconds: 90,
        ...overrides,
      },
    });
  }

  it('accepts a movement prescribed by movementGroup', async () => {
    await expect(prescribe()).resolves.toMatchObject({ movementGroup: 'pull' });
  });

  it('accepts a movement pinned to a specific exercise', async () => {
    const exercise = await createExercise();
    await expect(
      prescribe({ movementGroup: null, exerciseId: exercise.id }),
    ).resolves.toMatchObject({ exerciseId: exercise.id });
  });

  it('refuses a prescription naming no movement at all', async () => {
    // Sets and reps for nothing. The athlete would be handed a count with no
    // instruction attached.
    await expect(prescribe({ movementGroup: null })).rejects.toThrow(
      CHECK_VIOLATION,
    );
  });

  it('refuses a prescription naming both a movementGroup and an exercise', async () => {
    // "Pull at your rung" and "this exact exercise" are different
    // instructions, and a reader picking one would be guessing at the author.
    const exercise = await createExercise();
    await expect(
      prescribe({ movementGroup: 'pull', exerciseId: exercise.id }),
    ).rejects.toThrow(CHECK_VIOLATION);
  });

  it('refuses zero sets, and zero reps', async () => {
    await expect(prescribe({ sets: 0 })).rejects.toThrow(CHECK_VIOLATION);
    await expect(prescribe({ reps: 0 })).rejects.toThrow(CHECK_VIOLATION);
  });

  it('refuses negative rest, and accepts none at all', async () => {
    // 0 says "straight through" out loud, which is a real prescription; -30
    // is arithmetic the rest of the stack would carry.
    await expect(prescribe({ restSeconds: -30 })).rejects.toThrow(
      CHECK_VIOLATION,
    );
    await expect(prescribe({ restSeconds: 0 })).resolves.toBeDefined();
  });

  it('refuses two movements in the same position', async () => {
    const first = await prescribe();
    await expect(
      testPrisma().planSlotMovement.create({
        data: {
          planSlotId: first.planSlotId,
          order: 0,
          movementGroup: 'squat',
          sets: 3,
          reps: 8,
          restSeconds: 60,
        },
      }),
    ).rejects.toThrow(UNIQUE_VIOLATION);
  });

  it('refuses to delete an exercise a slot has pinned', async () => {
    // Same shape as the pinned-WOD rule above: the foreign key is ON DELETE
    // SET NULL, and the CHECK turns that nulling into a refusal. Archiving is
    // the answer here too.
    const exercise = await createExercise();
    await prescribe({ movementGroup: null, exerciseId: exercise.id });

    await expect(
      testPrisma().exercise.delete({ where: { id: exercise.id } }),
    ).rejects.toThrow(CHECK_VIOLATION);
  });

  it('takes the prescription with the slot when a program is deleted', async () => {
    // Cascade here, unlike the assignment rules: a slot's prescription is
    // part of the slot rather than a record of anything the athlete did.
    const row = await prescribe();
    await testPrisma().planSlot.delete({ where: { id: row.planSlotId } });

    expect(
      await testPrisma().planSlotMovement.findUnique({ where: { id: row.id } }),
    ).toBeNull();
  });
});
