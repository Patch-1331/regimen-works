import type { PrismaService } from '../prisma/prisma.service';
import { UserProvisioningService } from './user-provisioning.service';

/**
 * Provisioning runs on a user's very first authenticated request, and the web
 * app fires several of those at once — so every one of them arrives with a
 * cold `known` cache and they all write together.
 *
 * `upsert` does not survive that: Postgres raises a unique violation when two
 * transactions insert the same key simultaneously rather than turning the
 * loser into an update, so parallel first requests 500 on `User_pkey` and the
 * user gets a blank screen. Verified against real Postgres at the time of the
 * fix — 8 parallel calls, 7 rejected before, 0 after.
 *
 * A fake Prisma can't reproduce a real race, so what these lock in is the
 * shape that makes the race impossible: every write is an insert that skips
 * duplicates (INSERT ... ON CONFLICT DO NOTHING), never an upsert.
 */

const ALICE = 'user_alice';

function prismaWith() {
  const calls: Record<string, unknown[]> = {};
  const record = (key: string) =>
    jest.fn((args: unknown) => {
      (calls[key] ??= []).push(args);
      return Promise.resolve({ count: 1 });
    });

  const prisma = {
    user: { createMany: record('user'), upsert: record('user.upsert') },
    scheduleRule: {
      createMany: record('scheduleRule'),
      upsert: record('scheduleRule.upsert'),
    },
    skillLevel: {
      createMany: record('skillLevel'),
      upsert: record('skillLevel.upsert'),
    },
    // Records the order the operations were handed over in, which is what the
    // foreign keys depend on.
    $transaction: jest.fn((ops: unknown[]) => Promise.resolve(ops)),
  };

  return {
    service: new UserProvisioningService(prisma as unknown as PrismaService),
    prisma,
    calls,
  };
}

describe('UserProvisioningService.ensure', () => {
  it('creates the user and their schedule rule', async () => {
    const { service, calls } = prismaWith();
    await service.ensure(ALICE);

    expect(calls['user']).toHaveLength(1);
    expect(calls['scheduleRule']).toHaveLength(1);
  });

  // DN-86. Provisioning a rung is the app deciding what someone can do before
  // it has seen them train, and rung 0 on all eight lines is the worst version
  // of that guess. No row means `applyCurrentRung` leaves the WOD as the
  // library wrote it, which is the honest starting point.
  it('provisions no skill levels, so the first WOD is the library’s own prescription', async () => {
    const { service, calls, prisma } = prismaWith();
    await service.ensure(ALICE);

    expect(calls['skillLevel']).toBeUndefined();
    expect(prisma.skillLevel.createMany).not.toHaveBeenCalled();
  });

  it('skips duplicates on every write, so a concurrent insert is a no-op not a 500', async () => {
    const { service, calls } = prismaWith();
    await service.ensure(ALICE);

    for (const model of ['user', 'scheduleRule']) {
      expect(calls[model][0]).toMatchObject({ skipDuplicates: true });
    }
  });

  it('never upserts — upsert is what raced', async () => {
    const { service, prisma } = prismaWith();
    await service.ensure(ALICE);

    expect(prisma.user.upsert).not.toHaveBeenCalled();
    expect(prisma.scheduleRule.upsert).not.toHaveBeenCalled();
    expect(prisma.skillLevel.upsert).not.toHaveBeenCalled();
  });

  it('writes in one transaction, user first, so the foreign keys resolve', async () => {
    const { service, prisma } = prismaWith();
    await service.ensure(ALICE);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const ops = prisma.$transaction.mock.calls[0][0];
    expect(ops).toHaveLength(2);
    // ScheduleRule carries a foreign key to User, so the User insert has to be
    // built — and so run — before it.
    expect(prisma.user.createMany.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.scheduleRule.createMany.mock.invocationCallOrder[0],
    );
  });

  it('goes to the database once per user, then serves the cache', async () => {
    const { service, calls } = prismaWith();
    await service.ensure(ALICE);
    await service.ensure(ALICE);
    expect(calls['user']).toHaveLength(1);
  });

  it('still provisions a different user', async () => {
    const { service, calls } = prismaWith();
    await service.ensure(ALICE);
    await service.ensure('user_bob');
    expect(calls['user']).toHaveLength(2);
  });
});
