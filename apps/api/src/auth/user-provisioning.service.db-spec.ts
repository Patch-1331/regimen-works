import type { PrismaClient } from '@prisma/client';
import { JUST_WODS_PLAN_ID, JUST_WODS_WEEK_ID } from '../plans/just-wods';
import type { PrismaService } from '../prisma/prisma.service';
import { testPrisma, withSeparateConnections } from '../test-support/database';
import { UserProvisioningService } from './user-provisioning.service';

/**
 * The rows a signed-in user needs before anything else can reference them
 * (DN-99, DN-109). Replaces the mocked-Prisma spec this service used to have.
 *
 * That spec asserted the shape — `skipDuplicates: true` passed, `upsert`
 * never called — because, as it said itself, a fake Prisma cannot reproduce a
 * real race. DN-105 removed that limit: `withSeparateConnections` runs N
 * clients on N connections, which is what two concurrent HTTP requests are.
 * The race the service exists to survive is now asserted directly, and the
 * manual check the old spec cited in a comment ("8 parallel calls, 7 rejected
 * before, 0 after") is the test below.
 */

const TODAY = '2026-09-14';

/** A fresh service per call: `known` is per-instance, and a warm cache hides the writes. */
function service(client: PrismaClient = testPrisma()): UserProvisioningService {
  return new UserProvisioningService(
    client as unknown as PrismaService,
    () => TODAY,
  );
}

let sequence = 0;
/** A user id nothing has provisioned yet, since the cache outlives no test but the rows do. */
function newUserId(): string {
  sequence += 1;
  return `user_provisioning_${sequence}`;
}

describe('UserProvisioningService.ensure', () => {
  it('creates the user and their schedule rule', async () => {
    const userId = newUserId();

    await service().ensure(userId);

    expect(
      await testPrisma().user.findUnique({ where: { id: userId } }),
    ).not.toBeNull();
    expect(
      await testPrisma().scheduleRule.findUnique({ where: { userId } }),
    ).not.toBeNull();
  });

  it('leaves the schedule rule on its column defaults', async () => {
    // Provisioning writes the row, not an opinion about what is in it: the
    // defaults live in the schema, in one place.
    const userId = newUserId();

    await service().ensure(userId);

    expect(
      await testPrisma().scheduleRule.findUnique({ where: { userId } }),
    ).toMatchObject({
      warmupCooldownEnabled: false,
      autoStopAtCapEnabled: true,
    });
  });

  it('provisions no skill levels at all', async () => {
    // DN-86. A stored choice is the app claiming the athlete picked
    // something, and a row on every group was the worst version of that
    // guess. No row means the first WOD is the library's own prescription.
    const userId = newUserId();

    await service().ensure(userId);

    expect(await testPrisma().skillLevel.count()).toBe(0);
  });

  it('survives the first requests arriving together on separate connections', async () => {
    // Why the service is written the way it is. On a user's very first load
    // the web app fires several requests at once, so every one of them
    // arrives with a cold cache and they all reach the database together.
    // An upsert here 500s on `User_pkey`; createMany({ skipDuplicates })
    // compiles to INSERT ... ON CONFLICT DO NOTHING, where the loser is a
    // no-op.
    const userId = newUserId();

    const outcomes = await withSeparateConnections(8, (clients) =>
      Promise.allSettled(
        clients.map((client) => service(client).ensure(userId)),
      ),
    );

    const rejected = outcomes.filter((o) => o.status === 'rejected');
    expect(rejected.map((o) => String(o.reason))).toEqual([]);
    expect(await testPrisma().user.count()).toBe(1);
    expect(await testPrisma().scheduleRule.count()).toBe(1);
  });

  it('is a no-op for a user another process already provisioned', async () => {
    // A cold cache on a warm database: the second instance knows nothing of
    // the first, which is every API process after the one that served the
    // user's first request.
    const userId = newUserId();
    await service().ensure(userId);

    await expect(service().ensure(userId)).resolves.toBeUndefined();

    expect(await testPrisma().user.count()).toBe(1);
    expect(await testPrisma().scheduleRule.count()).toBe(1);
  });

  it('stops going to the database once it has provisioned a user', async () => {
    // The cache, proved by what does not happen: the rows are deleted out
    // from under the service, and a second ensure does not put them back --
    // which is only true if it never reached the database.
    const userId = newUserId();
    const provisioning = service();
    await provisioning.ensure(userId);
    await testPrisma().user.delete({ where: { id: userId } });

    await provisioning.ensure(userId);

    expect(await testPrisma().user.count()).toBe(0);
  });

  it('still provisions a second user', async () => {
    // The cache is per user, not a flag saying provisioning has run.
    const provisioning = service();
    const alice = newUserId();
    const bob = newUserId();

    await provisioning.ensure(alice);
    await provisioning.ensure(bob);

    expect(await testPrisma().user.count()).toBe(2);
  });
});

/**
 * Just WODs as a real program (DN-13). Every athlete is enrolled, so
 * `getToday` can keep one path once DN-16 reads the enrollment.
 *
 * Nothing reads it yet, which is the point of doing it first: these tests
 * assert the rows exist and stay singular, and the suites elsewhere in this
 * repo assert -- by continuing to pass -- that an enrolled athlete still
 * behaves exactly as an unenrolled one did.
 */
describe('UserProvisioningService.ensure, the Just WODs program', () => {
  it('creates the plan, its week and a slot for every weekday', async () => {
    // Created here rather than left to the deploy seed, because provisioning
    // cannot assume the seed has run -- these suites truncate every table
    // between tests, so a service that required a seeded plan would fail on a
    // foreign key in all of them.
    await service().ensure(newUserId());

    expect(
      await testPrisma().plan.findUnique({ where: { id: JUST_WODS_PLAN_ID } }),
    ).toMatchObject({
      name: 'Just WODs',
      scheduleMode: 'flexible',
      ownerId: null,
      minWeeks: null,
      maxWeeks: null,
      defaultWeeks: null,
    });
    expect(
      await testPrisma().planWeek.findUnique({
        where: { id: JUST_WODS_WEEK_ID },
      }),
    ).toMatchObject({ order: 0, phase: 'core' });

    const slots = await testPrisma().planSlot.findMany({
      where: { planWeekId: JUST_WODS_WEEK_ID },
      orderBy: { dayOfWeek: 'asc' },
    });
    expect(slots.map((s) => s.dayOfWeek)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(slots.every((s) => s.kind === 'wod_generated')).toBe(true);
    expect(slots.every((s) => s.allowNamed)).toBe(true);
  });

  it('enrolls the athlete, open-ended and active from today', async () => {
    const userId = newUserId();

    await service().ensure(userId);

    expect(
      await testPrisma().planEnrollment.findFirst({ where: { userId } }),
    ).toMatchObject({
      planId: JUST_WODS_PLAN_ID,
      startDate: TODAY,
      // Null is what stops resolveSlotForDate ever reporting past-end for
      // it: an open-ended program cycles its weeks instead of running out.
      weeks: null,
      status: 'active',
      completedAt: null,
    });
  });

  it('starts the athlete with no movement chosen anywhere', async () => {
    // The snapshot is empty because a new athlete has no SkillLevel rows
    // (DN-86), not because provisioning declined to look.
    const userId = newUserId();

    await service().ensure(userId);

    const enrollment = await testPrisma().planEnrollment.findFirstOrThrow({
      where: { userId },
    });
    expect(enrollment.startingMovements).toEqual({});
    expect(enrollment.summary).toBeNull();
  });

  it('backfills a user who predates programs', async () => {
    // The backfill, and the reason there is no separate script for one: an
    // existing athlete is a user row with no enrollment, which is the same
    // thing a half-provisioned new one is. Their next authenticated request
    // runs this path with a cold cache and fills the gap.
    const userId = newUserId();
    await testPrisma().user.create({ data: { id: userId } });
    await testPrisma().scheduleRule.create({ data: { userId } });

    await service().ensure(userId);

    expect(await testPrisma().planEnrollment.count({ where: { userId } })).toBe(
      1,
    );
    expect(await testPrisma().user.count()).toBe(1);
  });

  it('enrolls a second athlete in the same plan, not a second copy of it', async () => {
    const provisioning = service();

    await provisioning.ensure(newUserId());
    await provisioning.ensure(newUserId());

    expect(await testPrisma().plan.count()).toBe(1);
    expect(await testPrisma().planWeek.count()).toBe(1);
    expect(await testPrisma().planSlot.count()).toBe(7);
    expect(await testPrisma().planEnrollment.count()).toBe(2);
  });

  it('does not enroll twice when a cold cache meets a warm database', async () => {
    const userId = newUserId();
    await service().ensure(userId);

    await service().ensure(userId);

    expect(await testPrisma().planEnrollment.count({ where: { userId } })).toBe(
      1,
    );
    expect(await testPrisma().planSlot.count()).toBe(7);
  });

  it('survives concurrent first requests without a duplicate enrollment', async () => {
    // The row this skips is not a duplicate primary key -- `id` defaults to a
    // fresh cuid per call, so eight requests generate eight different ones.
    // What refuses the other seven is the partial unique index over active
    // enrollments, and this test is the proof that `skipDuplicates` compiles
    // to a bare ON CONFLICT DO NOTHING, which catches a partial index too.
    const userId = newUserId();

    const outcomes = await withSeparateConnections(8, (clients) =>
      Promise.allSettled(
        clients.map((client) => service(client).ensure(userId)),
      ),
    );

    const rejected = outcomes.filter((o) => o.status === 'rejected');
    expect(rejected.map((o) => String(o.reason))).toEqual([]);
    expect(await testPrisma().planEnrollment.count()).toBe(1);
    expect(await testPrisma().plan.count()).toBe(1);
    expect(await testPrisma().planSlot.count()).toBe(7);
  });

  it('leaves an athlete already running another program alone', async () => {
    // The same index that stops a duplicate also stops this one overwriting a
    // real program with the default, which matters the moment DN-14 can
    // enroll someone in something else: provisioning runs on every request,
    // not only the first.
    const userId = newUserId();
    await service().ensure(userId);
    const other = await testPrisma().plan.create({
      data: {
        name: 'Pull-Up Builder',
        summary: 'Six weeks to your first unassisted chin-up.',
        scheduleMode: 'fixed',
      },
    });
    await testPrisma().planEnrollment.deleteMany({ where: { userId } });
    await testPrisma().planEnrollment.create({
      data: { userId, planId: other.id, startDate: '2026-09-07', weeks: 6 },
    });

    await service().ensure(userId);

    const enrollments = await testPrisma().planEnrollment.findMany({
      where: { userId },
    });
    expect(enrollments).toHaveLength(1);
    expect(enrollments[0].planId).toBe(other.id);
  });
});
