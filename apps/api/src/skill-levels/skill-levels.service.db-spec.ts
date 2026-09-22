import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { testPrisma } from '../test-support/database';
import {
  createGroup,
  createSkillLevel,
  createUser,
} from '../test-support/fixtures';
import { SkillLevelsService } from './skill-levels.service';

/**
 * The athlete's standing choice per movement groups — what the scheduler
 * reaches for when it picks a movement, and what the completion screen
 * offers to update (DN-99, DN-108).
 *
 * This service already read as 100% statements before any of these existed,
 * because `app.e2e-spec.ts` walks through it. That is the happy path only: a
 * `findMany` missing its `where: { userId }` keeps every group green while
 * handing one athlete another's choices, which is the first case below.
 */

function service(): SkillLevelsService {
  return new SkillLevelsService(testPrisma() as unknown as PrismaService);
}

/** Three rungs on the pull line, so a ceiling of 2 exists to test against. */
function pullGroup() {
  return createGroup('pull', ['Negative chin-up', 'Chin-up', 'Pull-up']);
}

describe('SkillLevelsService.findAll', () => {
  it('shows the athlete only their own lines', async () => {
    const user = await createUser();
    const stranger = await createUser();
    await createSkillLevel(user.id, 'pull', 1);
    await createSkillLevel(stranger.id, 'squat', 3);

    expect(
      (await service().findAll(user.id)).map((row) => row.movementGroup),
    ).toEqual(['pull']);
  });

  it('orders the groups so the panel does not reshuffle between loads', async () => {
    const user = await createUser();
    await createSkillLevel(user.id, 'squat', 1);
    await createSkillLevel(user.id, 'hinge', 2);
    await createSkillLevel(user.id, 'pull', 0);

    expect(
      (await service().findAll(user.id)).map((row) => row.movementGroup),
    ).toEqual(['hinge', 'pull', 'squat']);
  });

  it('is empty for an athlete who has chosen nothing', async () => {
    // The ordinary case since DN-86 stopped provisioning a row per group.
    const user = await createUser();

    expect(await service().findAll(user.id)).toEqual([]);
  });

  it('hands back updatedAt as a string, not a Date', async () => {
    // The DTO crosses the wire as JSON; a Date here would serialise by
    // accident rather than by the shared schema's rule.
    const user = await createUser();
    const stored = await createSkillLevel(user.id, 'pull', 1);

    expect(await service().findAll(user.id)).toEqual([
      {
        id: stored.id,
        movementGroup: 'pull',
        rung: 1,
        updatedAt: stored.updatedAt.toISOString(),
      },
    ]);
  });
});

describe('SkillLevelsService.setRung', () => {
  it('records a first choice on a movementGroup the athlete has never set', async () => {
    // DN-86: provisioning no longer creates a row per group, so the first
    // choice has nothing to update. Refusing it would mean re-swapping the
    // same movement every session forever.
    const user = await createUser();
    await pullGroup();

    const saved = await service().setRung(user.id, 'pull', 2);

    expect(saved).toMatchObject({ movementGroup: 'pull', rung: 2 });
    expect(
      await testPrisma().skillLevel.findUnique({
        where: {
          userId_movementGroup: { userId: user.id, movementGroup: 'pull' },
        },
      }),
    ).toMatchObject({ rung: 2 });
  });

  it('moves an existing choice rather than stacking a second row', async () => {
    const user = await createUser();
    await pullGroup();
    await service().setRung(user.id, 'pull', 2);

    const saved = await service().setRung(user.id, 'pull', 1);

    expect(saved.rung).toBe(1);
    expect(await testPrisma().skillLevel.count()).toBe(1);
  });

  it('leaves another athlete on the same movementGroup where they were', async () => {
    // Enforced by the `userId_movementGroup` compound unique rather than by anything
    // in this method -- there is no way to write the upsert that scopes by
    // line alone, so no mutation of the service can make this fail. It is
    // here for the rewrite that replaces the upsert with something looser.
    const user = await createUser();
    const stranger = await createUser();
    await pullGroup();
    await service().setRung(stranger.id, 'pull', 2);

    await service().setRung(user.id, 'pull', 0);

    expect(
      (
        await testPrisma().skillLevel.findUnique({
          where: {
            userId_movementGroup: {
              userId: stranger.id,
              movementGroup: 'pull',
            },
          },
        })
      )?.rung,
    ).toBe(2);
  });

  it('refuses a movementGroup that is not a progression movementGroup', async () => {
    // Checked against the enum rather than against the rows: with an upsert
    // there is no missing row to catch the typo, so a misspelling would
    // quietly create a group nothing ever reads.
    const user = await createUser();

    await expect(service().setRung(user.id, 'pulll', 1)).rejects.toThrow(
      NotFoundException,
    );
    expect(await testPrisma().skillLevel.count()).toBe(0);
  });

  it('accepts the top rung that is actually seeded', async () => {
    const user = await createUser();
    await pullGroup();

    expect((await service().setRung(user.id, 'pull', 2)).rung).toBe(2);
  });

  it('refuses a rung past the last member of the group, and says where the top is', async () => {
    // Bounded so the scheduler never has to fall back on a rung with no
    // exercise seeded for it.
    const user = await createUser();
    await pullGroup();

    await expect(service().setRung(user.id, 'pull', 3)).rejects.toThrow(
      /max is 2/,
    );
    expect(await testPrisma().skillLevel.count()).toBe(0);
  });

  it('treats a movementGroup with nothing seeded as having a ceiling of rung 0', async () => {
    // `_max` over no rows is null, and the fallback makes that 0 rather than
    // letting every rung through.
    const user = await createUser();

    await expect(service().setRung(user.id, 'pull', 1)).rejects.toThrow(
      BadRequestException,
    );
  });
});
