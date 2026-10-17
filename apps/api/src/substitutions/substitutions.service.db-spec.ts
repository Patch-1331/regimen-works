import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { testPrisma } from '../test-support/database';
import {
  createAssignment,
  createExercise,
  createGroup,
  createProgram,
  createSkillLevel,
  createUser,
  createWod,
} from '../test-support/fixtures';
import { SECTION_CAP, SubstitutionsService } from './substitutions.service';

/**
 * The swap is the athlete's write path onto their own level, so the service
 * guards what the UI cannot: a day already trained, a movement from someone
 * else's WOD, and a target that is not scaling at all. The reps stay as
 * prescribed, which is why a target outside the group has to be refused — it would
 * leave a rep count that means nothing.
 *
 * Against a real database (DN-99) rather than a mocked Prisma client, which
 * replaces the mocked spec this used to have. The difference is what can be
 * asserted: that one row exists rather than that `upsert` was called, that
 * another user's swap survives a `clear` rather than that a `where` clause
 * mentioned `userId`, and — the case no mock reaches — that
 * `proposedRungChanges` reads its rows in the order its tie-break depends on.
 */

/**
 * A swap against a WOD movement, which is what every test in this file below
 * the prescribed-day block is about. The service takes the pair since DN-125,
 * because a day can be straight sets instead.
 */
function wodKey(wodMovementId: string) {
  return { wodMovementId, programSlotMovementId: null };
}

function service(): SubstitutionsService {
  return new SubstitutionsService(testPrisma() as unknown as PrismaService);
}

/** A pull group, a WOD using its middle member, and an assignment for it. */
async function pullDay(options: { status?: string } = {}) {
  const user = await createUser();
  const { members, fallback } = await createGroup(
    'pull',
    ['Negative chin-up', 'Chin-up', 'Pull-up'],
    { fallbackFor: 1 },
  );
  const wod = await createWod({
    dominantPattern: 'pull',
    movements: [{ exerciseId: members[0].id, reps: 30, order: 0 }],
  });
  const assignment = await createAssignment(user.id, {
    wodId: wod.id,
    ...(options.status ? { status: options.status } : {}),
  });
  return {
    user,
    members,
    fallback: fallback!,
    wod,
    assignment,
    movement: wod.movements[0],
  };
}

function storedSwaps(assignmentId: string) {
  return testPrisma().assignmentSubstitution.findMany({
    where: { assignmentId },
  });
}

describe('SubstitutionsService.set', () => {
  it("records a swap to another member of the movement's movementGroup", async () => {
    const { user, members, assignment, movement } = await pullDay();

    await service().set(
      user.id,
      assignment.id,
      wodKey(movement.id),
      members[1].id,
    );

    const swaps = await storedSwaps(assignment.id);
    expect(swaps).toHaveLength(1);
    expect(swaps[0]).toMatchObject({
      userId: user.id,
      wodMovementId: movement.id,
      exerciseId: members[1].id,
    });
  });

  it('allows the no-equipment alternative of a member of the movementGroup', async () => {
    const { user, fallback, assignment, movement } = await pullDay();

    await service().set(
      user.id,
      assignment.id,
      wodKey(movement.id),
      fallback.id,
    );

    // The alternative is outside the group itself — legal because a member points at it.
    expect((await storedSwaps(assignment.id))[0].exerciseId).toBe(fallback.id);
  });

  it('allows swapping back to what was prescribed', async () => {
    const { user, members, assignment, movement } = await pullDay();

    await service().set(
      user.id,
      assignment.id,
      wodKey(movement.id),
      members[0].id,
    );

    expect((await storedSwaps(assignment.id))[0].exerciseId).toBe(
      members[0].id,
    );
  });

  it('corrects the choice rather than stacking a second row', async () => {
    const { user, members, assignment, movement } = await pullDay();

    await service().set(
      user.id,
      assignment.id,
      wodKey(movement.id),
      members[1].id,
    );
    await service().set(
      user.id,
      assignment.id,
      wodKey(movement.id),
      members[2].id,
    );

    // The unique constraint would let a stacking insert fail loudly, but an
    // upsert on the wrong key would quietly leave two rows.
    const swaps = await storedSwaps(assignment.id);
    expect(swaps).toHaveLength(1);
    expect(swaps[0].exerciseId).toBe(members[2].id);
  });

  it('refuses an exercise that is not in the group', async () => {
    const { user, assignment, movement } = await pullDay();
    const { members: squats } = await createGroup('squat', ['Air squat']);

    await expect(
      service().set(user.id, assignment.id, wodKey(movement.id), squats[0].id),
    ).rejects.toThrow(BadRequestException);
    expect(await storedSwaps(assignment.id)).toHaveLength(0);
  });

  /**
   * The merged squat group (DN-140), end to end.
   *
   * This is the swap the issue exists for: the athlete standing in front of a
   * barbell, prescribed an air squat. Legality is group membership, so while
   * the bodyweight squats sat on `squat` and the loaded ones on `squat_loaded`
   * this call threw — the app refusing the kit in front of them. Nothing in
   * `assertLegalTarget` changed to allow it; one column did.
   *
   * Built from `createExercise` rather than `createGroup` because the point is
   * the `equipment` array, which is the thing the two members used to be split
   * on, and the fixture has no word for it.
   */
  describe('across the equipment split the merge removed (DN-140)', () => {
    async function squatDay() {
      const user = await createUser();
      const bodyweight = await createExercise({
        name: 'Air squat',
        pattern: 'squat',
        movementGroup: 'squat',
        equipment: [],
      });
      const loaded = await createExercise({
        name: 'Barbell back squat',
        pattern: 'squat',
        movementGroup: 'squat',
        equipment: ['barbell'],
      });
      const wod = await createWod({
        dominantPattern: 'squat',
        movements: [{ exerciseId: bodyweight.id, reps: 45, order: 0 }],
      });
      const assignment = await createAssignment(user.id, { wodId: wod.id });
      return {
        user,
        bodyweight,
        loaded,
        assignment,
        movement: wod.movements[0],
      };
    }

    it('swaps an air squat for a barbell back squat', async () => {
      const { user, loaded, assignment, movement } = await squatDay();

      await service().set(
        user.id,
        assignment.id,
        wodKey(movement.id),
        loaded.id,
      );

      expect((await storedSwaps(assignment.id))[0].exerciseId).toBe(loaded.id);
    });

    it('swaps a barbell back squat for an air squat', async () => {
      // The other direction, and not a formality: it is the swap an athlete
      // makes when the rack is taken. The group is unordered, so both have to
      // work off the same membership check (ADR-0004) -- a rule that only let
      // you add load would be the ladder this app does not have.
      const { user, bodyweight, loaded, assignment, movement } =
        await squatDay();

      await service().set(
        user.id,
        assignment.id,
        wodKey(movement.id),
        loaded.id,
      );
      await service().set(
        user.id,
        assignment.id,
        wodKey(movement.id),
        bodyweight.id,
      );

      expect((await storedSwaps(assignment.id))[0].exerciseId).toBe(
        bodyweight.id,
      );
    });
  });

  it('refuses another athlete’s movement, even sitting on the same movementGroup', async () => {
    // The group is built from a query, so an unscoped one makes every
    // athlete's private movements legal swap targets for everyone else
    // (DN-93). On the same group and at a free member, so nothing but the
    // ownership scope refuses it.
    const { user, assignment, movement } = await pullDay();
    const stranger = await createUser();
    const theirs = await createExercise({
      name: 'Ring row',
      pattern: 'pull',
      movementGroup: 'pull',
      ownerId: stranger.id,
    });

    await expect(
      service().set(user.id, assignment.id, wodKey(movement.id), theirs.id),
    ).rejects.toThrow(BadRequestException);
    expect(await storedSwaps(assignment.id)).toHaveLength(0);
  });

  /**
   * A cardio movement: off every group, and standing in front of its own
   * no-equipment alternative (DN-80). The pair the group gate used to refuse
   * outright.
   */
  async function cardioDay(options: { withAlternative?: boolean } = {}) {
    const user = await createUser();
    const highKnees = await testPrisma().exercise.create({
      data: {
        name: 'High knees',
        pattern: 'cardio',
        movementGroup: null,
      },
    });
    const doubleUnders = await testPrisma().exercise.create({
      data: {
        name: 'Double-unders',
        pattern: 'cardio',
        movementGroup: null,
        equipment: ['jump_rope'],
        ...(options.withAlternative === false
          ? {}
          : { fallbackExerciseId: highKnees.id }),
      },
    });
    const wod = await createWod({
      dominantPattern: 'cardio',
      movements: [{ exerciseId: doubleUnders.id, reps: 100, order: 0 }],
    });
    const assignment = await createAssignment(user.id, { wodId: wod.id });
    return {
      user,
      highKnees,
      doubleUnders,
      assignment,
      movement: wod.movements[0],
    };
  }

  it('allows the movement the equipment layer replaced, off every movementGroup', async () => {
    // The row the athlete is looking at says high knees; the workout said
    // double-unders, and today they have a rope (DN-110). There is no
    // substitution to clear -- the equipment layer moved this row during
    // resolution -- so taking the prescription back is a swap to the
    // movement's own exercise, and the service has to accept it on a
    // movement with no line to check it against.
    const { user, doubleUnders, assignment, movement } = await cardioDay();

    await service().set(
      user.id,
      assignment.id,
      wodKey(movement.id),
      doubleUnders.id,
    );

    expect((await storedSwaps(assignment.id))[0].exerciseId).toBe(
      doubleUnders.id,
    );
  });

  it('allows the alternative of a movement that is off every movementGroup', async () => {
    const { user, highKnees, assignment, movement } = await cardioDay();

    await service().set(
      user.id,
      assignment.id,
      wodKey(movement.id),
      highKnees.id,
    );

    // The case the group gate used to refuse: nothing to move between, but a
    // rope the athlete doesn't have today and somewhere real to go.
    expect((await storedSwaps(assignment.id))[0].exerciseId).toBe(highKnees.id);
  });

  it('refuses an unrelated target on a movement that is off every movementGroup', async () => {
    const { user, assignment, movement } = await cardioDay();
    const { members } = await createGroup('pull', ['Chin-up']);

    // With no line, the alternative is the whole of what this movement scales
    // to — everything else is a different workout at the prescribed reps.
    await expect(
      service().set(user.id, assignment.id, wodKey(movement.id), members[0].id),
    ).rejects.toThrow(BadRequestException);
    expect(await storedSwaps(assignment.id)).toHaveLength(0);
  });

  it('refuses any swap on an off-movementGroup movement with no alternative', async () => {
    const { user, highKnees, assignment, movement } = await cardioDay({
      withAlternative: false,
    });

    await expect(
      service().set(user.id, assignment.id, wodKey(movement.id), highKnees.id),
    ).rejects.toThrow(BadRequestException);
  });

  it.each(['completed', 'skipped'])('refuses a %s day', async (status) => {
    const { user, members, assignment, movement } = await pullDay({ status });

    // A swap says what the athlete is going to do; rewriting it afterwards
    // would put the record out of step with the session logged against it.
    await expect(
      service().set(user.id, assignment.id, wodKey(movement.id), members[1].id),
    ).rejects.toThrow(BadRequestException);
  });

  it('allows a swap while the session is in progress', async () => {
    const { user, members, assignment, movement } = await pullDay({
      status: 'in_progress',
    });

    await service().set(
      user.id,
      assignment.id,
      wodKey(movement.id),
      members[1].id,
    );

    expect(await storedSwaps(assignment.id)).toHaveLength(1);
  });

  it('404s on an assignment belonging to another athlete', async () => {
    const { members, assignment, movement } = await pullDay();
    const mallory = await createUser();

    await expect(
      service().set(
        mallory.id,
        assignment.id,
        wodKey(movement.id),
        members[1].id,
      ),
    ).rejects.toThrow(NotFoundException);
    expect(await storedSwaps(assignment.id)).toHaveLength(0);
  });

  it('404s on a movement that is not part of that day WOD', async () => {
    const { user, members, assignment } = await pullDay();
    const otherWod = await createWod({
      movements: [{ exerciseId: members[0].id, reps: 21, order: 0 }],
    });

    await expect(
      service().set(
        user.id,
        assignment.id,
        wodKey(otherWod.movements[0].id),
        members[1].id,
      ),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('SubstitutionsService.clear', () => {
  it('puts the movement back to what was prescribed', async () => {
    const { user, members, assignment, movement } = await pullDay();
    await service().set(
      user.id,
      assignment.id,
      wodKey(movement.id),
      members[1].id,
    );

    await service().clear(user.id, assignment.id, wodKey(movement.id));

    expect(await storedSwaps(assignment.id)).toHaveLength(0);
  });

  it('is a no-op when there was no swap to clear', async () => {
    const { user, assignment, movement } = await pullDay();

    await expect(
      service().clear(user.id, assignment.id, wodKey(movement.id)),
    ).resolves.toBeUndefined();
  });

  it('404s on an assignment belonging to another athlete', async () => {
    const { user, members, assignment, movement } = await pullDay();
    await service().set(
      user.id,
      assignment.id,
      wodKey(movement.id),
      members[1].id,
    );
    const mallory = await createUser();

    await expect(
      service().clear(mallory.id, assignment.id, wodKey(movement.id)),
    ).rejects.toThrow(NotFoundException);
    // The guard ran before the delete, so the swap is still there.
    expect(await storedSwaps(assignment.id)).toHaveLength(1);
  });
});

describe('SubstitutionsService.proposedMovementChanges', () => {
  it('404s on an assignment belonging to another athlete', async () => {
    const { assignment } = await pullDay();
    const mallory = await createUser();

    await expect(
      service().proposedMovementChanges(mallory.id, assignment.id),
    ).rejects.toThrow(NotFoundException);
  });

  it('proposes nothing when nothing was swapped', async () => {
    const { user, assignment } = await pullDay();

    expect(
      await service().proposedMovementChanges(user.id, assignment.id),
    ).toEqual([]);
  });

  it('proposes from null when the group has no standing choice yet', async () => {
    // The ordinary case for a first swap since DN-86 stopped provisioning
    // everyone a starting movement — and the first choice worth remembering.
    // What they were handed in the meantime is the group's default, which is
    // not something they chose and so not what they are moving from.
    const { user, members, assignment, movement } = await pullDay();
    await service().set(
      user.id,
      assignment.id,
      wodKey(movement.id),
      members[1].id,
    );

    expect(
      await service().proposedMovementChanges(user.id, assignment.id),
    ).toEqual([
      {
        movementGroup: 'pull',
        fromExerciseId: null,
        fromExerciseName: null,
        toExerciseId: members[1].id,
        toExerciseName: members[1].name,
      },
    ]);
  });

  it('proposes from the movement on record when there is one', async () => {
    const { user, members, assignment, movement } = await pullDay();
    await createSkillLevel(user.id, 'pull', members[0].id);
    await service().set(
      user.id,
      assignment.id,
      wodKey(movement.id),
      members[2].id,
    );

    const [proposal] = await service().proposedMovementChanges(
      user.id,
      assignment.id,
    );
    expect(proposal).toMatchObject({
      movementGroup: 'pull',
      fromExerciseId: members[0].id,
      fromExerciseName: members[0].name,
      toExerciseId: members[2].id,
    });
  });

  it('proposes an easier movement as readily as a harder one', async () => {
    // Remembering what the athlete picked is not the app demoting them.
    const { user, members, assignment, movement } = await pullDay();
    await createSkillLevel(user.id, 'pull', members[2].id);
    await service().set(
      user.id,
      assignment.id,
      wodKey(movement.id),
      members[0].id,
    );

    const [proposal] = await service().proposedMovementChanges(
      user.id,
      assignment.id,
    );
    expect(proposal).toMatchObject({
      fromExerciseId: members[2].id,
      toExerciseId: members[0].id,
    });
  });

  it('proposes nothing when the swap matches the standing choice', async () => {
    const { user, members, assignment, movement } = await pullDay();
    await createSkillLevel(user.id, 'pull', members[1].id);
    await service().set(
      user.id,
      assignment.id,
      wodKey(movement.id),
      members[1].id,
    );

    expect(
      await service().proposedMovementChanges(user.id, assignment.id),
    ).toEqual([]);
  });

  it('proposes nothing for a swap to the off-group alternative', async () => {
    // It is in no group, so there is no group's choice to move.
    const { user, fallback, assignment, movement } = await pullDay();
    await service().set(
      user.id,
      assignment.id,
      wodKey(movement.id),
      fallback.id,
    );

    expect(
      await service().proposedMovementChanges(user.id, assignment.id),
    ).toEqual([]);
  });

  it('takes the choice made most recently when one movementGroup was swapped twice', async () => {
    // The tie-break rests on `orderBy: { updatedAt: 'asc' }` in the query.
    // A mocked client returns whatever the fixture lists and proves nothing
    // about that clause; here the rows are ordered by the database.
    const user = await createUser();
    const { members } = await createGroup('pull', [
      'Negative chin-up',
      'Chin-up',
      'Pull-up',
    ]);
    const wod = await createWod({
      dominantPattern: 'pull',
      movements: [
        { exerciseId: members[0].id, reps: 30, order: 0 },
        { exerciseId: members[0].id, reps: 20, order: 1 },
      ],
    });
    const assignment = await createAssignment(user.id, { wodId: wod.id });

    await service().set(
      user.id,
      assignment.id,
      wodKey(wod.movements[0].id),
      members[2].id,
    );
    await service().set(
      user.id,
      assignment.id,
      wodKey(wod.movements[1].id),
      members[1].id,
    );

    // Stamp the timestamps apart so the intended order is unambiguous rather
    // than dependent on two writes landing in different milliseconds.
    await stampUpdatedAt(
      assignment.id,
      wod.movements[0].id,
      '2026-09-16T10:00:00Z',
    );
    await stampUpdatedAt(
      assignment.id,
      wod.movements[1].id,
      '2026-09-16T10:05:00Z',
    );

    const proposals = await service().proposedMovementChanges(
      user.id,
      assignment.id,
    );
    expect(proposals).toHaveLength(1);
    // The pull-up was chosen first and the chin-up second: the later one
    // wins, and there is no ordering it could have preferred instead.
    expect(proposals[0]).toMatchObject({ toExerciseId: members[1].id });
  });

  it('proposes once per movementGroup, in a stable order', async () => {
    const user = await createUser();
    const { members: pull } = await createGroup('pull', [
      'Negative chin-up',
      'Chin-up',
    ]);
    const { members: squat } = await createGroup('squat', [
      'Air squat',
      'Pistol',
    ]);
    const wod = await createWod({
      movements: [
        { exerciseId: squat[0].id, reps: 40, order: 0 },
        { exerciseId: pull[0].id, reps: 30, order: 1 },
      ],
    });
    const assignment = await createAssignment(user.id, { wodId: wod.id });

    await service().set(
      user.id,
      assignment.id,
      wodKey(wod.movements[0].id),
      squat[1].id,
    );
    await service().set(
      user.id,
      assignment.id,
      wodKey(wod.movements[1].id),
      pull[1].id,
    );

    const proposals = await service().proposedMovementChanges(
      user.id,
      assignment.id,
    );
    expect(proposals.map((p) => p.movementGroup)).toEqual(['pull', 'squat']);
  });

  it('ignores another athlete swaps on the same movement', async () => {
    const { user, members, assignment, movement } = await pullDay();
    const mallory = await createUser();
    const malloryAssignment = await createAssignment(mallory.id, {
      wodId: assignment.wodId!,
      date: '2026-09-17',
    });
    await service().set(
      mallory.id,
      malloryAssignment.id,
      wodKey(movement.id),
      members[2].id,
    );
    await service().set(
      user.id,
      assignment.id,
      wodKey(movement.id),
      members[1].id,
    );

    const proposals = await service().proposedMovementChanges(
      user.id,
      assignment.id,
    );
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ toExerciseId: members[1].id });
  });
});

/**
 * A prescribed day (DN-125): a program slot authoring `pull, 5x3` and an
 * assignment pointing at it, with no WOD anywhere in sight.
 *
 * `pinned` authors the specific-exercise form instead of the group form -- the
 * two halves of ProgramSlotMovement's xor, and the legality rule reads them
 * differently.
 */
async function prescribedDay(options: { pinned?: string } = {}) {
  const user = await createUser();
  const { members, fallback } = await createGroup(
    'pull',
    ['Negative chin-up', 'Chin-up', 'Pull-up'],
    { fallbackFor: 1 },
  );
  const program = await createProgram({
    weeks: {
      create: [
        {
          order: 0,
          phase: 'core',
          slots: {
            create: [
              {
                dayOfWeek: 3,
                kind: 'movements',
                movements: {
                  create: [
                    {
                      order: 0,
                      movementGroup: options.pinned ? null : 'pull',
                      exerciseId: options.pinned ?? null,
                      sets: 5,
                      reps: 3,
                      restSeconds: 90,
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
    },
  });
  const slot = await testPrisma().programSlot.findFirstOrThrow({
    where: { programWeek: { programId: program.id } },
    include: { movements: true },
  });
  const assignment = await testPrisma().dailyAssignment.create({
    data: {
      userId: user.id,
      date: '2026-09-16',
      status: 'scheduled',
      programSlotId: slot.id,
    },
  });
  return {
    user,
    members,
    fallback: fallback!,
    assignment,
    movement: slot.movements[0],
  };
}

/** The key the endpoint builds for a prescribed movement. */
function prescribedKey(programSlotMovementId: string) {
  return { wodMovementId: null, programSlotMovementId };
}

/**
 * A prescribed day is swappable on the same terms a WOD day is (DN-125): the
 * app decides what you do, you decide how hard it is. Everything the service
 * guards is the same question asked against a different column -- is this
 * movement part of *today*, and is the target scaling rather than a different
 * session -- so these say the answers did not change when the day did.
 */
describe('SubstitutionsService, on a prescribed day', () => {
  it('records a swap keyed by the prescribed movement', async () => {
    const { user, members, assignment, movement } = await prescribedDay();

    await service().set(
      user.id,
      assignment.id,
      prescribedKey(movement.id),
      members[2].id,
    );

    expect(await storedSwaps(assignment.id)).toMatchObject([
      {
        wodMovementId: null,
        programSlotMovementId: movement.id,
        exerciseId: members[2].id,
      },
    ]);
  });

  it('corrects the choice rather than stacking a second row', async () => {
    const { user, members, assignment, movement } = await prescribedDay();

    await service().set(
      user.id,
      assignment.id,
      prescribedKey(movement.id),
      members[2].id,
    );
    await service().set(
      user.id,
      assignment.id,
      prescribedKey(movement.id),
      members[0].id,
    );

    const stored = await storedSwaps(assignment.id);
    expect(stored).toHaveLength(1);
    expect(stored[0].exerciseId).toBe(members[0].id);
  });

  it('allows the no-equipment alternative of a member of the movementGroup', async () => {
    // A group-prescribed row names no exercise, so the whole group and every
    // alternative hanging off it is a legal target -- which is what lets an
    // athlete dropped outside the group by equipment stay off it on purpose.
    const { user, fallback, assignment, movement } = await prescribedDay();

    await service().set(
      user.id,
      assignment.id,
      prescribedKey(movement.id),
      fallback.id,
    );

    expect(await storedSwaps(assignment.id)).toHaveLength(1);
  });

  it('refuses a target off the prescribed movementGroup', async () => {
    const { user, assignment, movement } = await prescribedDay();
    const squat = await createExercise({
      name: 'Air squat',
      movementGroup: 'squat',
    });

    await expect(
      service().set(
        user.id,
        assignment.id,
        prescribedKey(movement.id),
        squat.id,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it("refuses a movement from a slot today's assignment does not point at", async () => {
    // The prescribed-day half of "is this movement part of today?". Without
    // it, any program's slot in the database would be swappable against any
    // athlete's day.
    const { user, members, assignment } = await prescribedDay();
    const elsewhere = await prescribedDay();

    await expect(
      service().set(
        user.id,
        assignment.id,
        prescribedKey(elsewhere.movement.id),
        members[2].id,
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('refuses a swap on a day already trained', async () => {
    const { user, members, assignment, movement } = await prescribedDay();
    await testPrisma().dailyAssignment.update({
      where: { id: assignment.id },
      data: { status: 'completed' },
    });

    await expect(
      service().set(
        user.id,
        assignment.id,
        prescribedKey(movement.id),
        members[2].id,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('holds an exercise-pinned row to that exercise own group', async () => {
    // The other half of ProgramSlotMovement's xor. A pinned row names an
    // exercise, so the group is read from it exactly as a WOD movement's is.
    const { members } = await createGroup('squat', ['Box squat', 'Air squat']);
    const {
      user,
      members: pullRungs,
      assignment,
      movement,
    } = await prescribedDay({ pinned: members[0].id });

    await expect(
      service().set(
        user.id,
        assignment.id,
        prescribedKey(movement.id),
        pullRungs[2].id,
      ),
    ).rejects.toThrow(BadRequestException);
    await service().set(
      user.id,
      assignment.id,
      prescribedKey(movement.id),
      members[1].id,
    );
    expect(await storedSwaps(assignment.id)).toHaveLength(1);
  });

  it('clears the swap through its own key', async () => {
    const { user, members, assignment, movement } = await prescribedDay();
    await service().set(
      user.id,
      assignment.id,
      prescribedKey(movement.id),
      members[2].id,
    );

    await service().clear(user.id, assignment.id, prescribedKey(movement.id));

    expect(await storedSwaps(assignment.id)).toHaveLength(0);
  });

  it('refuses a row naming neither movement, and one naming both', async () => {
    // The CHECK, which is the database's half of the rule the request schema
    // states. A swap attached to nothing is not a swap, and one attached to
    // two movements cannot say which the athlete tapped.
    const { user, members, assignment, movement } = await prescribedDay();
    const wod = await createWod({
      movements: [{ exerciseId: members[0].id, reps: 30, order: 0 }],
    });

    await expect(
      testPrisma().assignmentSubstitution.create({
        data: {
          userId: user.id,
          assignmentId: assignment.id,
          exerciseId: members[2].id,
        },
      }),
    ).rejects.toThrow(/AssignmentSubstitution_movement_xor/);
    await expect(
      testPrisma().assignmentSubstitution.create({
        data: {
          userId: user.id,
          assignmentId: assignment.id,
          exerciseId: members[2].id,
          programSlotMovementId: movement.id,
          wodMovementId: wod.movements[0].id,
        },
      }),
    ).rejects.toThrow(/AssignmentSubstitution_movement_xor/);
  });

  it('holds one swap per prescribed movement per day', async () => {
    // The composite unique standing in for a partial index. Two prescribed
    // rows on the same day each carry their own swap; the same row twice
    // cannot.
    const { user, members, assignment, movement } = await prescribedDay();

    await testPrisma().assignmentSubstitution.create({
      data: {
        userId: user.id,
        assignmentId: assignment.id,
        programSlotMovementId: movement.id,
        exerciseId: members[2].id,
      },
    });

    await expect(
      testPrisma().assignmentSubstitution.create({
        data: {
          userId: user.id,
          assignmentId: assignment.id,
          programSlotMovementId: movement.id,
          exerciseId: members[0].id,
        },
      }),
    ).rejects.toThrow(/assignmentId_programSlotMovementId/);
  });
});

async function stampUpdatedAt(
  assignmentId: string,
  wodMovementId: string,
  iso: string,
) {
  await testPrisma().$executeRaw`
    UPDATE "AssignmentSubstitution"
    SET "updatedAt" = ${new Date(iso)}
    WHERE "assignmentId" = ${assignmentId} AND "wodMovementId" = ${wodMovementId}
  `;
}

/**
 * A WOD naming a barbell bench press, for an athlete who lists `equipment`,
 * and the library the swap panel draws from around it (DN-170): a curated
 * push-up and a curated variation that loads differently, an uncurated
 * twin, a harder push-up, a dumbbell press and a harder ring fly. Every
 * row described the way the library import writes them.
 */
async function benchDay(
  options: { equipment?: string[]; fallbackId?: string } = {},
) {
  const user = await createUser();
  await testPrisma().scheduleRule.create({
    data: { userId: user.id, equipment: options.equipment ?? [] },
  });
  const described = {
    pattern: 'push',
    movementGroup: null,
    category: 'strength',
    level: 'beginner',
    primaryMuscles: ['chest'],
    secondaryMuscles: ['shoulders', 'triceps'],
    force: 'push',
    mechanic: 'compound',
  };
  const bench = await createExercise({
    ...described,
    name: 'Barbell bench press',
    equipment: ['barbell', 'bench'],
    fallbackExerciseId: options.fallbackId ?? null,
  });
  await createExercise({ ...described, name: 'Pushups', curated: true });
  await createExercise({
    ...described,
    name: 'Knee push-up',
    curated: true,
    mechanic: 'isolation',
  });
  await createExercise({ ...described, name: 'Decline push-up' });
  await createExercise({
    ...described,
    name: 'Archer push-up',
    level: 'expert',
  });
  await createExercise({
    ...described,
    name: 'Dumbbell bench press',
    equipment: ['dumbbell', 'bench'],
  });
  await createExercise({
    ...described,
    name: 'Ring fly',
    level: 'expert',
    equipment: ['suspension_trainer'],
  });
  const wod = await createWod({
    dominantPattern: 'push',
    movements: [{ exerciseId: bench.id, reps: 30, order: 0 }],
  });
  const assignment = await createAssignment(user.id, { wodId: wod.id });
  return { user, bench, described, assignment, movement: wod.movements[0] };
}

const names = (rows: { name: string }[]) => rows.map((r) => r.name);

async function exerciseNamed(name: string) {
  return testPrisma().exercise.findFirstOrThrow({ where: { name } });
}

describe('SubstitutionsService.options (DN-170)', () => {
  it('splits the library into what can be done, what is harder, and what needs kit', async () => {
    const { user, assignment, movement } = await benchDay();

    const options = await service().options(
      user.id,
      assignment.id,
      wodKey(movement.id),
    );

    // Curated first, then by score. Matched against the bench press as the
    // WOD wrote it, though equipment serves push-ups in its place.
    expect(names(options.main)).toEqual([
      'Pushups',
      'Knee push-up',
      'Decline push-up',
    ]);
    expect(names(options.harder)).toEqual(['Archer push-up']);
    expect(names(options.needsEquipment)).toEqual(['Dumbbell bench press']);
    expect(options.needsEquipment[0]).toMatchObject({
      level: 'beginner',
      equipment: ['dumbbell', 'bench'],
      isFallback: false,
    });
  });

  it('lists a match in the main list once its kit is listed', async () => {
    const { user, assignment, movement } = await benchDay({
      equipment: ['dumbbell', 'bench'],
    });

    const options = await service().options(
      user.id,
      assignment.id,
      wodKey(movement.id),
    );

    expect(names(options.main)).toContain('Dumbbell bench press');
    expect(options.needsEquipment).toEqual([]);
  });

  it('offers a harder move needing unlisted kit nowhere', async () => {
    const { user, assignment, movement } = await benchDay();

    const options = await service().options(
      user.id,
      assignment.id,
      wodKey(movement.id),
    );

    const all = [...options.main, ...options.harder, ...options.needsEquipment];
    expect(names(all)).not.toContain('Ring fly');
  });

  it('heads the main list with the hand-written fallback', async () => {
    const fallback = await createExercise({ name: 'Band press' });
    const { user, assignment, movement } = await benchDay({
      fallbackId: fallback.id,
    });

    const options = await service().options(
      user.id,
      assignment.id,
      wodKey(movement.id),
    );

    expect(options.main[0]).toMatchObject({
      name: 'Band press',
      isFallback: true,
    });
  });

  it('lists no more than eight of a section', async () => {
    const { user, described, assignment, movement } = await benchDay();
    for (let i = 0; i < 10; i++) {
      await createExercise({ ...described, name: `Push-up ${i}` });
    }

    const options = await service().options(
      user.id,
      assignment.id,
      wodKey(movement.id),
    );

    expect(options.main).toHaveLength(SECTION_CAP);
  });

  it("offers the athlete's own exercises and never another athlete's", async () => {
    const { user, described, assignment, movement } = await benchDay();
    const stranger = await createUser();
    await createExercise({
      ...described,
      name: 'Their push-up',
      ownerId: stranger.id,
    });
    await createExercise({
      ...described,
      name: 'My push-up',
      ownerId: user.id,
    });

    const options = await service().options(
      user.id,
      assignment.id,
      wodKey(movement.id),
    );

    expect(names(options.main)).toContain('My push-up');
    expect(names(options.main)).not.toContain('Their push-up');
  });

  it("matches against the athlete's remembered choice in the group", async () => {
    const user = await createUser();
    const described = {
      pattern: 'push',
      movementGroup: 'push_horizontal',
      category: 'strength',
      primaryMuscles: ['chest'],
      secondaryMuscles: ['shoulders', 'triceps'],
      force: 'push',
      mechanic: 'compound',
    };
    const written = await createExercise({
      ...described,
      name: 'Incline push-up',
      level: 'beginner',
    });
    const chosen = await createExercise({
      ...described,
      name: 'Archer push-up',
      level: 'expert',
    });
    await createSkillLevel(user.id, 'push_horizontal', chosen.id);
    const wod = await createWod({
      dominantPattern: 'push',
      movements: [{ exerciseId: written.id, reps: 30, order: 0 }],
    });
    const assignment = await createAssignment(user.id, { wodId: wod.id });

    const options = await service().options(
      user.id,
      assignment.id,
      wodKey(wod.movements[0].id),
    );

    // Against the archer push-up the athlete trains, the written one is
    // easier, and nothing is harder.
    expect(names(options.main)).toEqual(['Incline push-up']);
    expect(options.harder).toEqual([]);
  });

  it('offers a group-prescribed slot its group, though nothing in it is described', async () => {
    // The group vouches for its members (ADR-0004); the muscle match has
    // nothing to go on here, so this is the group alone.
    const { user, members, assignment, movement } = await prescribedDay();

    const options = await service().options(
      user.id,
      assignment.id,
      prescribedKey(movement.id),
    );

    // Matched against the group's default, the first member.
    expect(names(options.main).sort()).toEqual(
      [members[1].name, members[2].name].sort(),
    );
    expect(options.harder).toEqual([]);
    expect(options.needsEquipment).toEqual([]);
  });

  it('offers nothing where the library has nothing to match on', async () => {
    const user = await createUser();
    const ungrouped = { movementGroup: null };
    const undescribed = await createExercise({
      ...ungrouped,
      name: 'Mystery move',
    });
    await createExercise({ ...ungrouped, name: 'Another mystery' });
    const wod = await createWod({
      dominantPattern: 'push',
      movements: [{ exerciseId: undescribed.id, reps: 30, order: 0 }],
    });
    const assignment = await createAssignment(user.id, { wodId: wod.id });

    const options = await service().options(
      user.id,
      assignment.id,
      wodKey(wod.movements[0].id),
    );

    expect(options).toEqual({ main: [], harder: [], needsEquipment: [] });
  });

  it("refuses another athlete's assignment", async () => {
    const { assignment, movement } = await benchDay();
    const stranger = await createUser();

    await expect(
      service().options(stranger.id, assignment.id, wodKey(movement.id)),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('SubstitutionsService.set, against the swap panel (DN-170)', () => {
  it.each([
    ['the main list', 'Decline push-up'],
    ['the harder options', 'Archer push-up'],
    ['what needs equipment', 'Dumbbell bench press'],
  ])('accepts a move from %s', async (_, name) => {
    const { user, assignment, movement } = await benchDay();
    const target = await exerciseNamed(name);

    await service().set(user.id, assignment.id, wodKey(movement.id), target.id);

    expect((await storedSwaps(assignment.id))[0].exerciseId).toBe(target.id);
  });

  it('accepts a match past the cap, which is only not listed', async () => {
    const { user, described, assignment, movement } = await benchDay();
    for (let i = 0; i < 10; i++) {
      await createExercise({ ...described, name: `Push-up ${i}` });
    }
    const last = await exerciseNamed('Push-up 9');

    await service().set(user.id, assignment.id, wodKey(movement.id), last.id);

    expect((await storedSwaps(assignment.id))[0].exerciseId).toBe(last.id);
  });

  it('still refuses what the panel never offers', async () => {
    const { user, assignment, movement } = await benchDay();
    const ringFly = await exerciseNamed('Ring fly');
    const unrelated = await createExercise({
      name: 'Calf raise',
      category: 'strength',
      level: 'beginner',
      primaryMuscles: ['calves'],
    });

    for (const target of [ringFly, unrelated]) {
      await expect(
        service().set(user.id, assignment.id, wodKey(movement.id), target.id),
      ).rejects.toThrow(BadRequestException);
    }
  });

  it('never writes the equipment a pick needs into Settings', async () => {
    const { user, assignment, movement } = await benchDay();
    const dumbbellBench = await exerciseNamed('Dumbbell bench press');

    await service().set(
      user.id,
      assignment.id,
      wodKey(movement.id),
      dumbbellBench.id,
    );

    const rule = await testPrisma().scheduleRule.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(rule.equipment).toEqual([]);
  });
});
