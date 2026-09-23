import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { testPrisma } from '../test-support/database';
import {
  createExercise,
  createGroup,
  createSkillLevel,
  createUser,
} from '../test-support/fixtures';
import { SkillLevelsService } from './skill-levels.service';

/**
 * The athlete's standing choice per movement group — what the scheduler
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

/** Three members on the pull group, so there is somewhere to move between. */
function pullGroup() {
  return createGroup('pull', ['Negative chin-up', 'Chin-up', 'Pull-up']);
}

describe('SkillLevelsService.findAll', () => {
  it('shows the athlete only their own groups', async () => {
    const user = await createUser();
    const stranger = await createUser();
    const { members } = await pullGroup();
    const squat = await createExercise({ movementGroup: 'squat' });
    await createSkillLevel(user.id, 'pull', members[1].id);
    await createSkillLevel(stranger.id, 'squat', squat.id);

    expect(
      (await service().findAll(user.id)).map((row) => row.movementGroup),
    ).toEqual(['pull']);
  });

  it('orders the groups so the panel does not reshuffle between loads', async () => {
    const user = await createUser();
    for (const group of ['squat', 'hinge', 'pull']) {
      const exercise = await createExercise({ movementGroup: group });
      await createSkillLevel(user.id, group, exercise.id);
    }

    expect(
      (await service().findAll(user.id)).map((row) => row.movementGroup),
    ).toEqual(['hinge', 'pull', 'squat']);
  });

  it('is empty for an athlete who has chosen nothing', async () => {
    // The ordinary case since DN-86 stopped provisioning a row per group.
    const user = await createUser();

    expect(await service().findAll(user.id)).toEqual([]);
  });

  it('names the movement, so a screen does not need a second request', async () => {
    // The DTO also crosses the wire as JSON, so `updatedAt` is asserted as a
    // string: a Date here would serialise by accident rather than by the
    // shared schema's rule.
    const user = await createUser();
    const { members } = await pullGroup();
    const stored = await createSkillLevel(user.id, 'pull', members[1].id);

    expect(await service().findAll(user.id)).toEqual([
      {
        id: stored.id,
        movementGroup: 'pull',
        exerciseId: members[1].id,
        exerciseName: members[1].name,
        updatedAt: stored.updatedAt.toISOString(),
      },
    ]);
  });
});

describe('SkillLevelsService.setChoice', () => {
  it('records a first choice in a group the athlete has never set', async () => {
    // DN-86: provisioning no longer creates a row per group, so the first
    // choice has nothing to update. Refusing it would mean re-swapping the
    // same movement every session forever.
    const user = await createUser();
    const { members } = await pullGroup();

    const saved = await service().setChoice(user.id, 'pull', members[2].id);

    expect(saved).toMatchObject({
      movementGroup: 'pull',
      exerciseId: members[2].id,
      exerciseName: members[2].name,
    });
    expect(
      await testPrisma().skillLevel.findUnique({
        where: {
          userId_movementGroup: { userId: user.id, movementGroup: 'pull' },
        },
      }),
    ).toMatchObject({ exerciseId: members[2].id });
  });

  it('moves an existing choice rather than stacking a second row', async () => {
    const user = await createUser();
    const { members } = await pullGroup();
    await service().setChoice(user.id, 'pull', members[2].id);

    const saved = await service().setChoice(user.id, 'pull', members[1].id);

    expect(saved.exerciseId).toBe(members[1].id);
    expect(await testPrisma().skillLevel.count()).toBe(1);
  });

  it('leaves another athlete in the same group where they were', async () => {
    // Enforced by the `userId_movementGroup` compound unique rather than by
    // anything in this method -- there is no way to write the upsert that
    // scopes by group alone, so no mutation of the service can make this
    // fail. It is here for the rewrite that replaces the upsert with
    // something looser.
    const user = await createUser();
    const stranger = await createUser();
    const { members } = await pullGroup();
    await service().setChoice(stranger.id, 'pull', members[2].id);

    await service().setChoice(user.id, 'pull', members[0].id);

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
      )?.exerciseId,
    ).toBe(members[2].id);
  });

  it('refuses a group that is not a movement group', async () => {
    // Checked against the enum rather than against the rows: with an upsert
    // there is no missing row to catch the typo, so a misspelling would
    // quietly create a group nothing ever reads.
    const user = await createUser();

    await expect(
      service().setChoice(user.id, 'pulll', 'whatever'),
    ).rejects.toThrow(NotFoundException);
    expect(await testPrisma().skillLevel.count()).toBe(0);
  });

  // The three checks that replaced the rung ceiling (DN-139). A number could
  // only ever be in range or out of it; a foreign key can be any of these.
  it('refuses a movement that does not exist', async () => {
    const user = await createUser();
    await pullGroup();

    await expect(
      service().setChoice(user.id, 'pull', 'no-such-exercise'),
    ).rejects.toThrow(NotFoundException);
    expect(await testPrisma().skillLevel.count()).toBe(0);
  });

  it("refuses another athlete's private movement, as though it were not there", async () => {
    // A 404 rather than a 403: telling the caller that a movement exists but
    // is not theirs is itself a leak of someone else's library (DN-93).
    const user = await createUser();
    const stranger = await createUser();
    const theirs = await createExercise({
      movementGroup: 'pull',
      ownerId: stranger.id,
    });

    await expect(
      service().setChoice(user.id, 'pull', theirs.id),
    ).rejects.toThrow(NotFoundException);
    expect(await testPrisma().skillLevel.count()).toBe(0);
  });

  it('refuses a movement from a different group than the one being set', async () => {
    // The check the rung ceiling could not make: rung 1 of pull and rung 1 of
    // squat were the same number, so nothing stopped a pull row being set
    // from a squat movement's position.
    const user = await createUser();
    await pullGroup();
    const squat = await createExercise({ movementGroup: 'squat' });

    await expect(
      service().setChoice(user.id, 'pull', squat.id),
    ).rejects.toThrow(BadRequestException);
    expect(await testPrisma().skillLevel.count()).toBe(0);
  });

  it('accepts a movement wherever it sits in the group, including last', async () => {
    // There is no ceiling any more, and no bottom either: the members are a
    // set the athlete picks from, not a ladder they climb (ADR-0004).
    const user = await createUser();
    const { members } = await pullGroup();

    for (const member of members) {
      expect(
        (await service().setChoice(user.id, 'pull', member.id)).exerciseId,
      ).toBe(member.id);
    }
  });
});
