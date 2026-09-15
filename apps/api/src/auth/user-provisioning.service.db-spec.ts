import type { PrismaClient } from '@prisma/client';
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

/** A fresh service per call: `known` is per-instance, and a warm cache hides the writes. */
function service(client: PrismaClient = testPrisma()): UserProvisioningService {
  return new UserProvisioningService(client as unknown as PrismaService);
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
    // DN-86. A rung is the app forming an opinion about someone it has never
    // seen train, and rung 0 on every line was the worst version of that
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
