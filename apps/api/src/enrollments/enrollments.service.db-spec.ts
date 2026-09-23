import { NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { testPrisma } from '../test-support/database';
import {
  createAssignment,
  createEnrollment,
  createGroup,
  createPlan,
  createSkillLevel,
  createUser,
} from '../test-support/fixtures';
import { EnrollmentsService } from './enrollments.service';

/**
 * Finishing a program (DN-18).
 *
 * Against a real database, because almost everything worth pinning down here
 * is a query: which rows a completed run counts as its own, which enrollment
 * the card is owed for, and the guards that make a second tap harmless. The
 * arithmetic of the summary itself is fixed by
 * `enrollment-summary.logic.spec.ts` and deliberately not re-asserted here.
 */

function service(client: PrismaClient = testPrisma()): EnrollmentsService {
  return new EnrollmentsService(client as unknown as PrismaService);
}

const TODAY = '2026-10-26';

/** The group the design's card is written against: pull, three members. */
async function pullGroup() {
  return createGroup('pull', [
    'Negative chin-up',
    'Band-assisted chin-up',
    'Chin-up',
  ]);
}

async function completedRun(
  userId: string,
  overrides: Record<string, unknown> = {},
) {
  return createEnrollment(userId, {
    status: 'completed',
    completedAt: new Date('2026-10-20T10:00:00.000Z'),
    summary: { weeks: 6, sessions: 24, movementChanges: [] },
    ...overrides,
  });
}

describe('EnrollmentsService.completeRun', () => {
  it('retires the run and stamps when it ended', async () => {
    const user = await createUser();
    const enrollment = await createEnrollment(user.id);

    await service().completeRun(user.id, enrollment.id);

    const after = await testPrisma().planEnrollment.findUniqueOrThrow({
      where: { id: enrollment.id },
    });
    expect(after.status).toBe('completed');
    expect(after.completedAt).not.toBeNull();
  });

  it('counts only the sessions trained on this enrollment', async () => {
    const user = await createUser();
    const enrollment = await createEnrollment(user.id);
    // Two finished program days, plus a day the athlete skipped, a day still
    // scheduled, and a Just WODs day from before the program started. Only
    // the first two are this program's.
    await createAssignment(user.id, {
      enrollmentId: enrollment.id,
      status: 'completed',
      date: '2026-09-16',
    });
    await createAssignment(user.id, {
      enrollmentId: enrollment.id,
      status: 'completed',
      date: '2026-09-17',
    });
    await createAssignment(user.id, {
      enrollmentId: enrollment.id,
      status: 'skipped',
      date: '2026-09-18',
    });
    await createAssignment(user.id, {
      enrollmentId: enrollment.id,
      status: 'scheduled',
      date: '2026-09-19',
    });
    await createAssignment(user.id, {
      status: 'completed',
      date: '2026-09-01',
    });

    await service().completeRun(user.id, enrollment.id);

    const after = await testPrisma().planEnrollment.findUniqueOrThrow({
      where: { id: enrollment.id },
    });
    expect(after.summary).toMatchObject({ weeks: 6, sessions: 2 });
  });

  it('reports what moved, named at both ends', async () => {
    const user = await createUser();
    const { members } = await pullGroup();
    const enrollment = await createEnrollment(user.id, {
      startingMovements: { pull: members[0].id },
    });
    await createSkillLevel(user.id, 'pull', members[2].id);

    await service().completeRun(user.id, enrollment.id);

    const after = await testPrisma().planEnrollment.findUniqueOrThrow({
      where: { id: enrollment.id },
    });
    expect(after.summary).toMatchObject({
      movementChanges: [
        {
          movementGroup: 'pull',
          fromExerciseId: members[0].id,
          toExerciseId: members[2].id,
          fromName: members[0].name,
          toName: members[2].name,
        },
      ],
    });
  });

  it('writes a summary for a program nobody trained', async () => {
    // DN-18's last task. Enrolled, never opened, weeks ran out: still a
    // finished run, and the card has to have figures to show.
    const user = await createUser();
    const enrollment = await createEnrollment(user.id);

    await service().completeRun(user.id, enrollment.id);

    const after = await testPrisma().planEnrollment.findUniqueOrThrow({
      where: { id: enrollment.id },
    });
    expect(after.summary).toEqual({
      weeks: 6,
      sessions: 0,
      movementChanges: [],
    });
  });

  it('leaves a run that is already completed alone', async () => {
    // The race two requests arriving together produce. The loser must not
    // overwrite the winner's completedAt with a later one.
    const user = await createUser();
    const enrollment = await completedRun(user.id);
    const before = enrollment.completedAt;

    await service().completeRun(user.id, enrollment.id);

    const after = await testPrisma().planEnrollment.findUniqueOrThrow({
      where: { id: enrollment.id },
    });
    expect(after.completedAt).toEqual(before);
  });

  it('will not complete another athlete’s run', async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const enrollment = await createEnrollment(owner.id);

    await service().completeRun(stranger.id, enrollment.id);

    const after = await testPrisma().planEnrollment.findUniqueOrThrow({
      where: { id: enrollment.id },
    });
    expect(after.status).toBe('active');
  });

  it('survives a starting snapshot that does not parse', async () => {
    // jsonb holds whatever is put in it. The day a program ends is not the
    // day to throw at the athlete.
    const user = await createUser();
    const enrollment = await createEnrollment(user.id, {
      startingMovements: { pull: 7 },
    });

    await expect(
      service().completeRun(user.id, enrollment.id),
    ).resolves.toBeUndefined();
    const after = await testPrisma().planEnrollment.findUniqueOrThrow({
      where: { id: enrollment.id },
    });
    expect(after.status).toBe('completed');
  });
});

describe('EnrollmentsService.cardFor', () => {
  it('offers the run that just finished', async () => {
    const user = await createUser();
    const plan = await createPlan({ name: 'Pull-Up Builder' });
    const enrollment = await completedRun(user.id, { planId: plan.id });

    await expect(service().cardFor(user.id)).resolves.toMatchObject({
      enrollmentId: enrollment.id,
      planId: plan.id,
      planName: 'Pull-Up Builder',
      summary: { weeks: 6, sessions: 24 },
    });
  });

  it('offers nothing while the program is still running', async () => {
    const user = await createUser();
    await createEnrollment(user.id);

    await expect(service().cardFor(user.id)).resolves.toBeNull();
  });

  it('offers nothing once the card has been dismissed', async () => {
    const user = await createUser();
    await completedRun(user.id, { summaryDismissedAt: new Date() });

    await expect(service().cardFor(user.id)).resolves.toBeNull();
  });

  it('offers only the most recent of two finished runs', async () => {
    // An athlete back after a long absence wants to train, not to work
    // through a queue of congratulations.
    const user = await createUser();
    await completedRun(user.id, {
      completedAt: new Date('2026-05-01T10:00:00.000Z'),
    });
    const recent = await completedRun(user.id, {
      completedAt: new Date('2026-10-20T10:00:00.000Z'),
    });

    await expect(service().cardFor(user.id)).resolves.toMatchObject({
      enrollmentId: recent.id,
    });
  });

  it('offers nothing for a run retired before figures were kept', async () => {
    // DN-16 completed runs on read with no summary attached. Those are real
    // finished programs with nothing to show, not cards with zeroes in them.
    const user = await createUser();
    await completedRun(user.id, { summary: undefined });

    await expect(service().cardFor(user.id)).resolves.toBeNull();
  });

  it('offers nothing for another athlete’s finished run', async () => {
    const owner = await createUser();
    const stranger = await createUser();
    await completedRun(owner.id);

    await expect(service().cardFor(stranger.id)).resolves.toBeNull();
  });
});

describe('EnrollmentsService.listCompleted', () => {
  it('lists finished runs, most recent first', async () => {
    const user = await createUser();
    const older = await completedRun(user.id, {
      completedAt: new Date('2026-05-01T10:00:00.000Z'),
    });
    const newer = await completedRun(user.id, {
      completedAt: new Date('2026-10-20T10:00:00.000Z'),
    });

    const listed = await service().listCompleted(user.id);

    expect(listed.map((p) => p.enrollmentId)).toEqual([newer.id, older.id]);
  });

  it('still lists a run whose card has been dismissed', async () => {
    // Dismissing puts the prompt away, not the record.
    const user = await createUser();
    const enrollment = await completedRun(user.id, {
      summaryDismissedAt: new Date(),
    });

    const listed = await service().listCompleted(user.id);

    expect(listed.map((p) => p.enrollmentId)).toEqual([enrollment.id]);
  });

  it('leaves out the program still running', async () => {
    const user = await createUser();
    await createEnrollment(user.id);

    await expect(service().listCompleted(user.id)).resolves.toEqual([]);
  });

  it('leaves out a run with no figures', async () => {
    const user = await createUser();
    await completedRun(user.id, { summary: undefined });

    await expect(service().listCompleted(user.id)).resolves.toEqual([]);
  });

  it('lists nothing belonging to another athlete', async () => {
    const owner = await createUser();
    const stranger = await createUser();
    await completedRun(owner.id);

    await expect(service().listCompleted(stranger.id)).resolves.toEqual([]);
  });
});

describe('EnrollmentsService.dismiss', () => {
  it('puts the card away', async () => {
    const user = await createUser();
    const enrollment = await completedRun(user.id);

    await service().dismiss(user.id, enrollment.id);

    await expect(service().cardFor(user.id)).resolves.toBeNull();
  });

  it('is happy to be asked twice', async () => {
    const user = await createUser();
    const enrollment = await completedRun(user.id);

    await service().dismiss(user.id, enrollment.id);

    await expect(
      service().dismiss(user.id, enrollment.id),
    ).resolves.toBeUndefined();
  });

  it('refuses another athlete’s run', async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const enrollment = await completedRun(owner.id);

    await expect(service().dismiss(stranger.id, enrollment.id)).rejects.toThrow(
      NotFoundException,
    );
    const after = await testPrisma().planEnrollment.findUniqueOrThrow({
      where: { id: enrollment.id },
    });
    expect(after.summaryDismissedAt).toBeNull();
  });

  it('refuses a program that has not finished', async () => {
    const user = await createUser();
    const enrollment = await createEnrollment(user.id);

    await expect(service().dismiss(user.id, enrollment.id)).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('EnrollmentsService.runAgain', () => {
  it('starts the same program over from today', async () => {
    const user = await createUser();
    const plan = await createPlan();
    const previous = await completedRun(user.id, {
      planId: plan.id,
      weeks: 8,
    });

    const { enrollmentId } = await service().runAgain(
      user.id,
      previous.id,
      TODAY,
    );

    const created = await testPrisma().planEnrollment.findUniqueOrThrow({
      where: { id: enrollmentId },
    });
    expect(created).toMatchObject({
      planId: plan.id,
      weeks: 8,
      status: 'active',
      startDate: TODAY,
    });
  });

  it('snapshots where the athlete stands now, not where they started', async () => {
    // The point of running it again is to run it from here. Carrying the old
    // starting members forward would make the second run's card claim the first
    // run's progress a second time.
    const user = await createUser();
    const { members } = await pullGroup();
    await createSkillLevel(user.id, 'pull', members[2].id);
    const previous = await completedRun(user.id, {
      startingMovements: { pull: members[0].id },
    });

    const { enrollmentId } = await service().runAgain(
      user.id,
      previous.id,
      TODAY,
    );

    const created = await testPrisma().planEnrollment.findUniqueOrThrow({
      where: { id: enrollmentId },
    });
    expect(created.startingMovements).toEqual({ pull: members[2].id });
  });

  it('puts the card away as part of the same answer', async () => {
    const user = await createUser();
    const previous = await completedRun(user.id);

    await service().runAgain(user.id, previous.id, TODAY);

    await expect(service().cardFor(user.id)).resolves.toBeNull();
  });

  it('keeps the run already under way rather than enrolling twice', async () => {
    // Two taps, or a tap by an athlete who has since started something else.
    // The partial unique index would refuse the second active row anyway.
    const user = await createUser();
    const previous = await completedRun(user.id);
    const active = await createEnrollment(user.id);

    const { enrollmentId } = await service().runAgain(
      user.id,
      previous.id,
      TODAY,
    );

    expect(enrollmentId).toBe(active.id);
    await expect(
      testPrisma().planEnrollment.count({
        where: { userId: user.id, status: 'active' },
      }),
    ).resolves.toBe(1);
  });

  it('refuses another athlete’s run', async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const previous = await completedRun(owner.id);

    await expect(
      service().runAgain(stranger.id, previous.id, TODAY),
    ).rejects.toThrow(NotFoundException);
    await expect(
      testPrisma().planEnrollment.count({ where: { userId: stranger.id } }),
    ).resolves.toBe(0);
  });

  it('refuses a program that has not finished', async () => {
    const user = await createUser();
    const enrollment = await createEnrollment(user.id);

    await expect(
      service().runAgain(user.id, enrollment.id, TODAY),
    ).rejects.toThrow(NotFoundException);
  });
});
