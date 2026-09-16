import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { testPrisma } from '../test-support/database';
import {
  createAssignment,
  createLadder,
  createSkillLevel,
  createUser,
  createWod,
} from '../test-support/fixtures';
import { SubstitutionsService } from './substitutions.service';

/**
 * The swap is the athlete's write path onto their own level, so the service
 * guards what the UI cannot: a day already trained, a movement from someone
 * else's WOD, and a target that is not scaling at all. The reps stay as
 * prescribed, which is why an off-ladder target has to be refused — it would
 * leave a rep count that means nothing.
 *
 * Against a real database (DN-99) rather than a mocked Prisma client, which
 * replaces the mocked spec this used to have. The difference is what can be
 * asserted: that one row exists rather than that `upsert` was called, that
 * another user's swap survives a `clear` rather than that a `where` clause
 * mentioned `userId`, and — the case no mock reaches — that
 * `proposedRungChanges` reads its rows in the order its tie-break depends on.
 */

function service(): SubstitutionsService {
  return new SubstitutionsService(testPrisma() as unknown as PrismaService);
}

/** A pull ladder, a WOD using its middle rung, and an assignment for it. */
async function pullDay(options: { status?: string } = {}) {
  const user = await createUser();
  const { rungs, alt } = await createLadder(
    'pull',
    ['Negative chin-up', 'Chin-up', 'Pull-up'],
    { altFor: 1 },
  );
  const wod = await createWod({
    dominantPattern: 'pull',
    movements: [{ exerciseId: rungs[0].id, reps: 30, order: 0 }],
  });
  const assignment = await createAssignment(user.id, {
    wodId: wod.id,
    ...(options.status ? { status: options.status } : {}),
  });
  return {
    user,
    rungs,
    alt: alt!,
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
  it('records a swap to another rung on the movement line', async () => {
    const { user, rungs, assignment, movement } = await pullDay();

    await service().set(user.id, assignment.id, movement.id, rungs[1].id);

    const swaps = await storedSwaps(assignment.id);
    expect(swaps).toHaveLength(1);
    expect(swaps[0]).toMatchObject({
      userId: user.id,
      wodMovementId: movement.id,
      exerciseId: rungs[1].id,
    });
  });

  it('allows the no-equipment alternative of a rung on the line', async () => {
    const { user, alt, assignment, movement } = await pullDay();

    await service().set(user.id, assignment.id, movement.id, alt.id);

    // The alternative is off the line itself — legal because a rung points at it.
    expect((await storedSwaps(assignment.id))[0].exerciseId).toBe(alt.id);
  });

  it('allows swapping back to what was prescribed', async () => {
    const { user, rungs, assignment, movement } = await pullDay();

    await service().set(user.id, assignment.id, movement.id, rungs[0].id);

    expect((await storedSwaps(assignment.id))[0].exerciseId).toBe(rungs[0].id);
  });

  it('corrects the choice rather than stacking a second row', async () => {
    const { user, rungs, assignment, movement } = await pullDay();

    await service().set(user.id, assignment.id, movement.id, rungs[1].id);
    await service().set(user.id, assignment.id, movement.id, rungs[2].id);

    // The unique constraint would let a stacking insert fail loudly, but an
    // upsert on the wrong key would quietly leave two rows.
    const swaps = await storedSwaps(assignment.id);
    expect(swaps).toHaveLength(1);
    expect(swaps[0].exerciseId).toBe(rungs[2].id);
  });

  it('refuses an exercise that is not on the ladder', async () => {
    const { user, assignment, movement } = await pullDay();
    const { rungs: squats } = await createLadder('squat', ['Air squat']);

    await expect(
      service().set(user.id, assignment.id, movement.id, squats[0].id),
    ).rejects.toThrow(BadRequestException);
    expect(await storedSwaps(assignment.id)).toHaveLength(0);
  });

  /**
   * A cardio movement: off every line, and standing in front of its own
   * no-equipment alternative (DN-80). The pair the line gate used to refuse
   * outright.
   */
  async function cardioDay(options: { withAlternative?: boolean } = {}) {
    const user = await createUser();
    const highKnees = await testPrisma().exercise.create({
      data: { name: 'High knees', pattern: 'cardio', line: null, rung: null },
    });
    const doubleUnders = await testPrisma().exercise.create({
      data: {
        name: 'Double-unders',
        pattern: 'cardio',
        line: null,
        rung: null,
        equipment: ['jump_rope'],
        ...(options.withAlternative === false
          ? {}
          : { altExerciseId: highKnees.id }),
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

  it('allows the alternative of a movement that is off every line', async () => {
    const { user, highKnees, assignment, movement } = await cardioDay();

    await service().set(user.id, assignment.id, movement.id, highKnees.id);

    // The case the line gate used to refuse: no ladder to move along, but a
    // rope the athlete doesn't have today and somewhere real to go.
    expect((await storedSwaps(assignment.id))[0].exerciseId).toBe(highKnees.id);
  });

  it('refuses an unrelated target on a movement that is off every line', async () => {
    const { user, assignment, movement } = await cardioDay();
    const { rungs } = await createLadder('pull', ['Chin-up']);

    // With no line, the alternative is the whole of what this movement scales
    // to — everything else is a different workout at the prescribed reps.
    await expect(
      service().set(user.id, assignment.id, movement.id, rungs[0].id),
    ).rejects.toThrow(BadRequestException);
    expect(await storedSwaps(assignment.id)).toHaveLength(0);
  });

  it('refuses any swap on an off-line movement with no alternative', async () => {
    const { user, highKnees, assignment, movement } = await cardioDay({
      withAlternative: false,
    });

    await expect(
      service().set(user.id, assignment.id, movement.id, highKnees.id),
    ).rejects.toThrow(BadRequestException);
  });

  it.each(['completed', 'skipped'])('refuses a %s day', async (status) => {
    const { user, rungs, assignment, movement } = await pullDay({ status });

    // A swap says what the athlete is going to do; rewriting it afterwards
    // would put the record out of step with the session logged against it.
    await expect(
      service().set(user.id, assignment.id, movement.id, rungs[1].id),
    ).rejects.toThrow(BadRequestException);
  });

  it('allows a swap while the session is in progress', async () => {
    const { user, rungs, assignment, movement } = await pullDay({
      status: 'in_progress',
    });

    await service().set(user.id, assignment.id, movement.id, rungs[1].id);

    expect(await storedSwaps(assignment.id)).toHaveLength(1);
  });

  it('404s on an assignment belonging to another athlete', async () => {
    const { rungs, assignment, movement } = await pullDay();
    const mallory = await createUser();

    await expect(
      service().set(mallory.id, assignment.id, movement.id, rungs[1].id),
    ).rejects.toThrow(NotFoundException);
    expect(await storedSwaps(assignment.id)).toHaveLength(0);
  });

  it('404s on a movement that is not part of that day WOD', async () => {
    const { user, rungs, assignment } = await pullDay();
    const otherWod = await createWod({
      movements: [{ exerciseId: rungs[0].id, reps: 21, order: 0 }],
    });

    await expect(
      service().set(
        user.id,
        assignment.id,
        otherWod.movements[0].id,
        rungs[1].id,
      ),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('SubstitutionsService.clear', () => {
  it('puts the movement back to what was prescribed', async () => {
    const { user, rungs, assignment, movement } = await pullDay();
    await service().set(user.id, assignment.id, movement.id, rungs[1].id);

    await service().clear(user.id, assignment.id, movement.id);

    expect(await storedSwaps(assignment.id)).toHaveLength(0);
  });

  it('is a no-op when there was no swap to clear', async () => {
    const { user, assignment, movement } = await pullDay();

    await expect(
      service().clear(user.id, assignment.id, movement.id),
    ).resolves.toBeUndefined();
  });

  it('404s on an assignment belonging to another athlete', async () => {
    const { user, rungs, assignment, movement } = await pullDay();
    await service().set(user.id, assignment.id, movement.id, rungs[1].id);
    const mallory = await createUser();

    await expect(
      service().clear(mallory.id, assignment.id, movement.id),
    ).rejects.toThrow(NotFoundException);
    // The guard ran before the delete, so the swap is still there.
    expect(await storedSwaps(assignment.id)).toHaveLength(1);
  });
});

describe('SubstitutionsService.proposedRungChanges', () => {
  it('404s on an assignment belonging to another athlete', async () => {
    const { assignment } = await pullDay();
    const mallory = await createUser();

    await expect(
      service().proposedRungChanges(mallory.id, assignment.id),
    ).rejects.toThrow(NotFoundException);
  });

  it('proposes nothing when nothing was swapped', async () => {
    const { user, assignment } = await pullDay();

    expect(await service().proposedRungChanges(user.id, assignment.id)).toEqual(
      [],
    );
  });

  it('proposes from null when the line has no standing choice yet', async () => {
    // The ordinary case for a first swap since DN-86 stopped provisioning
    // everyone at rung 0 — and the first choice worth remembering.
    const { user, rungs, assignment, movement } = await pullDay();
    await service().set(user.id, assignment.id, movement.id, rungs[1].id);

    expect(await service().proposedRungChanges(user.id, assignment.id)).toEqual(
      [
        {
          line: 'pull',
          fromRung: null,
          toRung: 1,
          exerciseId: rungs[1].id,
          exerciseName: rungs[1].name,
        },
      ],
    );
  });

  it('proposes from the rung on record when there is one', async () => {
    const { user, rungs, assignment, movement } = await pullDay();
    await createSkillLevel(user.id, 'pull', 0);
    await service().set(user.id, assignment.id, movement.id, rungs[2].id);

    const [proposal] = await service().proposedRungChanges(
      user.id,
      assignment.id,
    );
    expect(proposal).toMatchObject({ line: 'pull', fromRung: 0, toRung: 2 });
  });

  it('proposes an easier movement as readily as a harder one', async () => {
    // Remembering what the athlete picked is not the app demoting them.
    const { user, rungs, assignment, movement } = await pullDay();
    await createSkillLevel(user.id, 'pull', 2);
    await service().set(user.id, assignment.id, movement.id, rungs[0].id);

    const [proposal] = await service().proposedRungChanges(
      user.id,
      assignment.id,
    );
    expect(proposal).toMatchObject({ fromRung: 2, toRung: 0 });
  });

  it('proposes nothing when the swap matches the standing choice', async () => {
    const { user, rungs, assignment, movement } = await pullDay();
    await createSkillLevel(user.id, 'pull', 1);
    await service().set(user.id, assignment.id, movement.id, rungs[1].id);

    expect(await service().proposedRungChanges(user.id, assignment.id)).toEqual(
      [],
    );
  });

  it('proposes nothing for a swap to the off-ladder alternative', async () => {
    // It carries no rung, so there is no position on the line to remember.
    const { user, alt, assignment, movement } = await pullDay();
    await service().set(user.id, assignment.id, movement.id, alt.id);

    expect(await service().proposedRungChanges(user.id, assignment.id)).toEqual(
      [],
    );
  });

  it('takes the choice made most recently when one line was swapped twice', async () => {
    // The tie-break rests on `orderBy: { updatedAt: 'asc' }` in the query.
    // A mocked client returns whatever the fixture lists and proves nothing
    // about that clause; here the rows are ordered by the database.
    const user = await createUser();
    const { rungs } = await createLadder('pull', [
      'Negative chin-up',
      'Chin-up',
      'Pull-up',
    ]);
    const wod = await createWod({
      dominantPattern: 'pull',
      movements: [
        { exerciseId: rungs[0].id, reps: 30, order: 0 },
        { exerciseId: rungs[0].id, reps: 20, order: 1 },
      ],
    });
    const assignment = await createAssignment(user.id, { wodId: wod.id });

    await service().set(
      user.id,
      assignment.id,
      wod.movements[0].id,
      rungs[2].id,
    );
    await service().set(
      user.id,
      assignment.id,
      wod.movements[1].id,
      rungs[1].id,
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

    const proposals = await service().proposedRungChanges(
      user.id,
      assignment.id,
    );
    expect(proposals).toHaveLength(1);
    // The pull-up was chosen first and the chin-up second: the later one wins,
    // even though it is the lower rung.
    expect(proposals[0]).toMatchObject({ toRung: 1, exerciseId: rungs[1].id });
  });

  it('proposes once per line, in a stable order', async () => {
    const user = await createUser();
    const { rungs: pull } = await createLadder('pull', [
      'Negative chin-up',
      'Chin-up',
    ]);
    const { rungs: squat } = await createLadder('squat', [
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
      wod.movements[0].id,
      squat[1].id,
    );
    await service().set(
      user.id,
      assignment.id,
      wod.movements[1].id,
      pull[1].id,
    );

    const proposals = await service().proposedRungChanges(
      user.id,
      assignment.id,
    );
    expect(proposals.map((p) => p.line)).toEqual(['pull', 'squat']);
  });

  it('ignores another athlete swaps on the same movement', async () => {
    const { user, rungs, assignment, movement } = await pullDay();
    const mallory = await createUser();
    const malloryAssignment = await createAssignment(mallory.id, {
      wodId: assignment.wodId!,
      date: '2026-09-17',
    });
    await service().set(
      mallory.id,
      malloryAssignment.id,
      movement.id,
      rungs[2].id,
    );
    await service().set(user.id, assignment.id, movement.id, rungs[1].id);

    const proposals = await service().proposedRungChanges(
      user.id,
      assignment.id,
    );
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ toRung: 1 });
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
