import type { PrismaService } from '../prisma/prisma.service';
import { testPrisma } from '../test-support/database';
import {
  createAssignment,
  createExercise,
  createSkillLevel,
  createUser,
  createWod,
} from '../test-support/fixtures';
import { MovementResolutionService } from './movement-resolution.service';

/**
 * The three resolution layers, driven through a real database (DN-99).
 *
 * `scheduler.logic.spec.ts` already proves each layer in isolation, and the
 * composition with hand-built maps. What only a database reaches is the part
 * this service owns: which rows it loads to build those maps. An equipment
 * layer handed the wrong substitute map degrades a movement to nothing, or
 * silently fails to degrade it at all, while every pure test stays green.
 *
 * So these are weighted towards the loading: a substitute that is off every
 * progression line (the shape the seed actually uses), ownership read from the
 * athlete's own rule row rather than anyone else's, and the default that
 * applies when there is no row at all.
 */

function service(): MovementResolutionService {
  return new MovementResolutionService(
    testPrisma() as unknown as PrismaService,
  );
}

/**
 * A WOD of one bar movement with an off-ladder substitute, plus an athlete and
 * their assignment for it — the pull-up / Supermans shape the seed ships.
 */
async function barDay(options: { equipment?: string[] } = {}) {
  const user = await createUser();
  if (options.equipment !== undefined) {
    await testPrisma().scheduleRule.create({
      data: { userId: user.id, equipment: options.equipment },
    });
  }

  const alt = await createExercise({
    name: 'Supermans + reverse snow angels',
    pattern: 'pull',
    line: null,
    rung: null,
  });
  const pullUp = await createExercise({
    name: 'Pull-up',
    pattern: 'pull',
    line: 'pull',
    rung: 3,
    equipment: ['bar'],
    altExerciseId: alt.id,
  });
  const wod = await createWod({
    dominantPattern: 'pull',
    movements: [{ exerciseId: pullUp.id, reps: 30, order: 0 }],
  });
  const assignment = await createAssignment(user.id, { wodId: wod.id });

  return { user, alt, pullUp, wod, assignment };
}

function resolveDay(day: Awaited<ReturnType<typeof barDay>>) {
  return service().resolve(day.user.id, day.assignment.id, day.wod.movements);
}

describe('MovementResolutionService and equipment', () => {
  it('leaves the movement alone for an athlete who owns the bar', async () => {
    const day = await barDay({ equipment: ['bar'] });

    const resolved = await resolveDay(day);

    expect(resolved[0].exercise.id).toBe(day.pullUp.id);
  });

  it('falls to the substitute for an athlete who does not', async () => {
    const day = await barDay({ equipment: [] });

    const resolved = await resolveDay(day);

    expect(resolved[0].exercise.id).toBe(day.alt.id);
  });

  it('finds a substitute that sits off every progression line', async () => {
    // The map the rung layer builds only holds lined exercises, and the seed's
    // substitutes are deliberately off-ladder. Reusing that map here would
    // leave every real substitute unreachable while the pure tests pass.
    const day = await barDay({ equipment: [] });

    const resolved = await resolveDay(day);

    expect(resolved[0].exercise.line).toBeNull();
    expect(resolved[0].exercise.name).toBe('Supermans + reverse snow angels');
  });

  it('keeps the movement row and its reps, changing only the exercise', async () => {
    const day = await barDay({ equipment: [] });

    const resolved = await resolveDay(day);

    expect(resolved[0].id).toBe(day.wod.movements[0].id);
    expect(resolved[0].reps).toBe(30);
  });

  it('owns the bar by default, for an athlete with no rule row', async () => {
    // Provisioning writes the row on first sign-in, so this is the absent-row
    // path. It has to agree with the column default (DN-81): read as owning
    // nothing, a missing row would quietly cost this athlete every bar
    // movement in the library.
    const day = await barDay();

    expect(
      await testPrisma().scheduleRule.findUnique({
        where: { userId: day.user.id },
      }),
    ).toBeNull();
    expect((await resolveDay(day))[0].exercise.id).toBe(day.pullUp.id);
  });

  it('reads the athlete own ownership, not another athlete', async () => {
    const day = await barDay({ equipment: [] });
    const other = await createUser();
    await testPrisma().scheduleRule.create({
      data: { userId: other.id, equipment: ['bar'] },
    });

    expect((await resolveDay(day))[0].exercise.id).toBe(day.alt.id);
  });

  it('checks the remembered choice rather than what the library prescribed', async () => {
    // The order the layers run in, asserted where it bites: the WOD prescribes
    // a movement needing nothing, and the athlete's own standing choice on
    // that line is the one that needs a bar. Run the other way round, the
    // check sees an untagged prescription, passes it, and then the choice
    // layer hands them a pull-up they cannot do.
    //
    // The prescribed movement has to be ON the line for this to mean anything
    // -- an off-ladder one is left alone by the choice layer, and then both
    // orderings agree.
    const day = await barDay({ equipment: [] });
    const ringRow = await createExercise({
      name: 'Ring row',
      pattern: 'pull',
      line: 'pull',
      rung: 0,
    });
    await testPrisma().wodMovement.update({
      where: { id: day.wod.movements[0].id },
      data: { exerciseId: ringRow.id },
    });
    await createSkillLevel(day.user.id, 'pull', 3);

    const wod = await testPrisma().wod.findUniqueOrThrow({
      where: { id: day.wod.id },
      include: { movements: { include: { exercise: true } } },
    });

    const resolved = await service().resolve(
      day.user.id,
      day.assignment.id,
      wod.movements,
    );

    // Choice takes it to the pull-up, equipment drops it to the pull-up's own
    // substitute -- not back to the ring row, which nothing pointed at.
    expect(resolved[0].exercise.id).toBe(day.alt.id);
  });

  it("lets today's swap stand even when the athlete owns nothing for it", async () => {
    // The athlete with no bar at home who is training somewhere that has one.
    // Ownership shapes what they are offered; it does not overrule what they
    // just tapped.
    const day = await barDay({ equipment: [] });
    await testPrisma().assignmentSubstitution.create({
      data: {
        userId: day.user.id,
        assignmentId: day.assignment.id,
        wodMovementId: day.wod.movements[0].id,
        exerciseId: day.pullUp.id,
      },
    });

    const resolved = await resolveDay(day);

    expect(resolved[0].exercise.id).toBe(day.pullUp.id);
    expect(resolved[0].isSwapped).toBe(true);
  });

  it('passes an unperformable movement through when its substitute is gone', async () => {
    // A hole in the movement list is worse than a movement the athlete has to
    // scale themselves. DN-83 is what stops this arising from the seed.
    const day = await barDay({ equipment: [] });
    await testPrisma().exercise.update({
      where: { id: day.pullUp.id },
      data: { altExerciseId: null },
    });

    const wod = await testPrisma().wod.findUniqueOrThrow({
      where: { id: day.wod.id },
      include: { movements: { include: { exercise: true } } },
    });

    const resolved = await service().resolve(
      day.user.id,
      day.assignment.id,
      wod.movements,
    );

    expect(resolved[0].exercise.id).toBe(day.pullUp.id);
  });

  it('marks a degraded movement with what was prescribed', async () => {
    // The row changed under the athlete without them asking, which is exactly
    // the case DN-88 added prescribedName for.
    const day = await barDay({ equipment: [] });

    const resolved = await resolveDay(day);

    expect(resolved[0].isSwapped).toBe(false);
    expect(resolved[0].prescribedName).toBe('Pull-up');
  });

  it('resolves a mixed WOD movement by movement', async () => {
    const user = await createUser();
    await testPrisma().scheduleRule.create({
      data: { userId: user.id, equipment: ['bar'] },
    });

    const highKnees = await createExercise({
      name: 'High knees',
      pattern: 'cardio',
      line: null,
      rung: null,
    });
    const doubleUnder = await createExercise({
      name: 'Double-under',
      pattern: 'cardio',
      line: null,
      rung: null,
      equipment: ['jump_rope'],
      altExerciseId: highKnees.id,
    });
    const pullUp = await createExercise({
      name: 'Pull-up',
      pattern: 'pull',
      line: 'pull',
      rung: 3,
      equipment: ['bar'],
    });
    const wod = await createWod({
      movements: [
        { exerciseId: pullUp.id, reps: 10, order: 0 },
        { exerciseId: doubleUnder.id, reps: 50, order: 1 },
      ],
    });
    const assignment = await createAssignment(user.id, { wodId: wod.id });

    const resolved = await service().resolve(
      user.id,
      assignment.id,
      wod.movements,
    );

    expect(resolved.map((m) => m.exercise.name)).toEqual([
      'Pull-up',
      'High knees',
    ]);
  });
});
