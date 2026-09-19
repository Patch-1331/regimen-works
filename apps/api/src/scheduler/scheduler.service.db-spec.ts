import type { PrismaClient } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { testPrisma } from '../test-support/database';
import {
  createAssignment,
  createEnrollment,
  createExercise,
  createPlan,
  createSkillLevel,
  createUser,
  createWod,
} from '../test-support/fixtures';
import { WodsService } from '../wods/wods.service';
import { MovementResolutionService } from './movement-resolution.service';
import { SchedulerService } from './scheduler.service';

/**
 * The Today plate: what the scheduler decides, and — the part this file was
 * written for — what the athlete is actually handed once equipment ownership
 * has had its say (DN-79).
 *
 * Against a real database (DN-99) and through the real
 * `MovementResolutionService` rather than a stub, because the thing most
 * worth pinning down here is *wiring*: the order the three resolution layers
 * run in, and the fallback for an athlete with no `ScheduleRule` row. The
 * pure spec in `scheduler.logic.spec.ts` composes the layers itself, so it
 * fixes the semantics of each layer and can say nothing about the order this
 * service composes them in. That is what these cases are for.
 */

function service(
  client: PrismaClient = testPrisma(),
  rng: () => number = Math.random,
): SchedulerService {
  const prisma = client as unknown as PrismaService;
  return new SchedulerService(
    prisma,
    new WodsService(prisma),
    new MovementResolutionService(prisma),
    rng,
  );
}

const TODAY = '2026-09-16';

/**
 * A pull ladder where the rungs disagree about equipment, which is what makes
 * the layer ordering observable: rung 0 needs nothing, the two above it need
 * a bar, and the bar rungs fall back to a row under the table.
 */
async function pullLadder() {
  const row = await createExercise({
    name: 'Row under table',
    pattern: 'pull',
    line: null,
    rung: null,
  });
  const negative = await createExercise({
    name: 'Negative chin-up',
    pattern: 'pull',
    line: 'pull',
    rung: 0,
  });
  const chinUp = await createExercise({
    name: 'Chin-up',
    pattern: 'pull',
    line: 'pull',
    rung: 1,
    equipment: ['bar'],
    altExerciseId: row.id,
  });
  const pullUp = await createExercise({
    name: 'Pull-up',
    pattern: 'pull',
    line: 'pull',
    rung: 2,
    equipment: ['bar'],
    altExerciseId: row.id,
  });
  return { row, negative, chinUp, pullUp };
}

/**
 * An athlete with today's WOD already assigned, so `getToday` takes its
 * existing-assignment leg and the WOD under test is the one the test chose
 * rather than whatever `pickWod` lands on.
 */
async function assignedDay(
  prescribedId: string,
  options: { equipment?: string[]; withRule?: boolean } = {},
) {
  const user = await createUser();
  if (options.withRule ?? true) {
    await testPrisma().scheduleRule.create({
      data: {
        userId: user.id,
        ...(options.equipment ? { equipment: options.equipment } : {}),
      },
    });
  }
  const wod = await createWod({
    dominantPattern: 'pull',
    movements: [{ exerciseId: prescribedId, reps: 30, order: 0 }],
  });
  const assignment = await createAssignment(user.id, {
    wodId: wod.id,
    date: TODAY,
  });
  return { user, wod, assignment, movement: wod.movements[0] };
}

/** The single movement as the athlete is served it today. */
async function servedMovement(userId: string) {
  const today = await service().getToday(userId, TODAY);
  return today.assignment!.wod!.movements[0];
}

/**
 * A line where *every* rung needs the same piece of equipment (DN-115) — the
 * rope and box pairs. Every other line in the library has a bodyweight rung,
 * so this is the first shape where the athlete's remembered choice cannot
 * itself be the way out.
 */
async function ropeLadder() {
  const highKnees = await createExercise({
    name: 'High knees',
    pattern: 'cardio',
    line: null,
    rung: null,
  });
  const single = await createExercise({
    name: 'Single-unders',
    pattern: 'cardio',
    line: 'cardio_rope',
    rung: 0,
    equipment: ['jump_rope'],
    altExerciseId: highKnees.id,
  });
  const double = await createExercise({
    name: 'Double-unders',
    pattern: 'cardio',
    line: 'cardio_rope',
    rung: 1,
    equipment: ['jump_rope'],
    altExerciseId: highKnees.id,
  });
  return { highKnees, single, double };
}

describe('SchedulerService on a line where every rung needs the kit', () => {
  it('honours the remembered choice for an athlete who owns the rope', async () => {
    const { single, double } = await ropeLadder();
    const { user } = await assignedDay(double.id, {
      equipment: ['jump_rope'],
    });
    await createSkillLevel(user.id, 'cardio_rope', 0);

    const movement = await servedMovement(user.id);

    // The case the line was added for: they own a rope and cannot yet turn
    // doubles, so they get singles rather than having the rope taken off them.
    expect(movement.exercise.name).toBe(single.name);
    expect(movement.prescribedName).toBe(double.name);
    expect(movement.prescribedReason).toBe('remembered_choice');
  });

  it('falls to the alternative, not to a lower rung, for an athlete with no rope', async () => {
    const { highKnees, double } = await ropeLadder();
    const { user } = await assignedDay(double.id, { equipment: [] });
    await createSkillLevel(user.id, 'cardio_rope', 0);

    const movement = await servedMovement(user.id);

    // Their remembered rung needs the rope too, so the choice layer moves
    // them to a movement they still cannot do and the equipment layer has to
    // catch it. On every other line rung 0 needs nothing, which is why this
    // composition was never exercised before.
    expect(movement.exercise.name).toBe(highKnees.name);
    expect(movement.prescribedReason).toBe('equipment');
  });
});

describe('SchedulerService equipment resolution', () => {
  it('serves the prescribed movement to an athlete who owns the bar', async () => {
    const { pullUp } = await pullLadder();
    const { user } = await assignedDay(pullUp.id, { equipment: ['bar'] });

    expect((await servedMovement(user.id)).exercise.name).toBe('Pull-up');
  });

  it('drops a bar movement to its alternative for an athlete who owns no bar', async () => {
    const { pullUp } = await pullLadder();
    const { user } = await assignedDay(pullUp.id, { equipment: [] });

    const movement = await servedMovement(user.id);

    expect(movement.exercise.name).toBe('Row under table');
    expect(movement.reps).toBe(30); // reps as prescribed — only the exercise moved
  });

  it('names what the library prescribed when equipment moved it', async () => {
    // The same courtesy the remembered choice gets (DN-88): a movement the
    // athlete did not choose and did not expect should say what it replaced.
    const { pullUp } = await pullLadder();
    const { user } = await assignedDay(pullUp.id, { equipment: [] });

    const movement = await servedMovement(user.id);

    expect(movement.prescribedName).toBe('Pull-up');
    expect(movement.prescribedReason).toBe('equipment');
    expect(movement.isSwapped).toBe(false);
  });

  it('carries the prescribed exercise id, not only its name', async () => {
    // A name is something to read; the id is something to offer back
    // (DN-110). Without it the screen can tell an athlete standing in a gym
    // what the workout asked for and give them no way to take it, because
    // the alternative is shared between movements and cannot be read
    // backwards.
    const { pullUp } = await pullLadder();
    const { user } = await assignedDay(pullUp.id, { equipment: [] });

    expect((await servedMovement(user.id)).prescribedId).toBe(pullUp.id);
  });

  it('carries the id of what the choice layer replaced, too', async () => {
    const { chinUp } = await pullLadder();
    const { user } = await assignedDay(chinUp.id, { equipment: ['bar'] });
    await createSkillLevel(user.id, 'pull', 0);

    // The library's movement, not the rung they chose: it is the one thing
    // on this row they have no other way back to.
    expect((await servedMovement(user.id)).prescribedId).toBe(chinUp.id);
  });

  it('tells an equipment substitution apart from a remembered choice', async () => {
    // The two arrive through the same field and the screen says different
    // words for them, so the field has to distinguish them. Here the choice
    // layer alone moved the row -- rung 0 needs nothing, and the athlete owns
    // a bar besides.
    const { negative, chinUp } = await pullLadder();
    const { user } = await assignedDay(chinUp.id, { equipment: ['bar'] });
    await createSkillLevel(user.id, 'pull', 0);

    const movement = await servedMovement(user.id);

    expect(movement.exercise.name).toBe(negative.name);
    expect(movement.prescribedName).toBe('Chin-up');
    expect(movement.prescribedReason).toBe('remembered_choice');
  });

  it('blames equipment, not the athlete, when both layers moved a row', async () => {
    // Their standing choice landed on a bar they do not own, so what they are
    // looking at is the app standing down -- calling that their pick would be
    // the one reading that is untrue.
    const { negative } = await pullLadder();
    const { user } = await assignedDay(negative.id, { equipment: [] });
    await createSkillLevel(user.id, 'pull', 2);

    const movement = await servedMovement(user.id);

    expect(movement.exercise.name).toBe('Row under table');
    expect(movement.prescribedName).toBe('Negative chin-up');
    expect(movement.prescribedReason).toBe('equipment');
  });

  it('names no prescription and no reason on an untouched movement', async () => {
    const { negative } = await pullLadder();
    const { user } = await assignedDay(negative.id, { equipment: ['bar'] });

    const movement = await servedMovement(user.id);

    expect(movement.prescribedName).toBeNull();
    expect(movement.prescribedId).toBeNull();
    expect(movement.prescribedReason).toBeNull();
  });

  it('reads an athlete with no rule row as the baseline, not as owning nothing', async () => {
    // DN-81's default has to hold on the scheduling path too. Read the other
    // way round, a missing row would quietly cost this athlete every bar
    // movement in the library.
    const { pullUp } = await pullLadder();
    const { user } = await assignedDay(pullUp.id, { withRule: false });

    expect((await servedMovement(user.id)).exercise.name).toBe('Pull-up');
  });

  it('gives a fresh rule row the same baseline the column default claims', async () => {
    // Nothing links DEFAULT_EQUIPMENT to the column default in
    // schema.prisma, so the drift between them is asserted rather than
    // assumed — here on the path that acts on it.
    const { pullUp } = await pullLadder();
    const { user } = await assignedDay(pullUp.id);

    expect((await servedMovement(user.id)).exercise.name).toBe('Pull-up');
  });

  it('leaves a movement with no alternative in place rather than dropping it', async () => {
    // A hole in the movement list is worse than a movement the athlete has to
    // sort out for themselves. DN-83 is what stops this gap existing.
    const muscleUp = await createExercise({
      name: 'Bar muscle-up',
      pattern: 'pull',
      line: null,
      rung: null,
      equipment: ['bar'],
    });
    const { user } = await assignedDay(muscleUp.id, { equipment: [] });

    const today = await service().getToday(user.id, TODAY);

    expect(today.assignment!.wod!.movements).toHaveLength(1);
    expect(today.assignment!.wod!.movements[0].exercise.name).toBe(
      'Bar muscle-up',
    );
  });

  it('serves an untagged movement to an athlete who owns nothing', async () => {
    const { negative } = await pullLadder();
    const { user } = await assignedDay(negative.id, { equipment: [] });

    expect((await servedMovement(user.id)).exercise.name).toBe(
      'Negative chin-up',
    );
  });
});

describe('SchedulerService resolution ordering', () => {
  it('checks equipment against the remembered choice, not the prescription', async () => {
    // The prescription is on rung 0 and needs nothing; the athlete's standing
    // choice is rung 2, which needs a bar they do not own. Equipment has to
    // see what the choice resolved to — run the other way round it would find
    // nothing to fault in the prescription and hand them a Pull-up.
    const { negative, pullUp } = await pullLadder();
    const { user } = await assignedDay(negative.id, { equipment: [] });
    await createSkillLevel(user.id, 'pull', 2);

    const movement = await servedMovement(user.id);

    expect(movement.exercise.name).toBe('Row under table');
    expect(movement.exercise.id).not.toBe(pullUp.id);
  });

  it("lets today's swap stand on equipment the athlete does not own", async () => {
    // The athlete wins. Tapping into a bar movement having ticked no bar says
    // something ownership should not argue with — no bar at home is not no
    // bar in a hotel gym.
    const { chinUp, pullUp } = await pullLadder();
    const { user, assignment, movement } = await assignedDay(pullUp.id, {
      equipment: [],
    });
    await testPrisma().assignmentSubstitution.create({
      data: {
        userId: user.id,
        assignmentId: assignment.id,
        wodMovementId: movement.id,
        exerciseId: chinUp.id,
      },
    });

    const served = await servedMovement(user.id);

    expect(served.exercise.name).toBe('Chin-up');
    expect(served.isSwapped).toBe(true);
  });

  // Equipment moved this row and then the athlete swapped it -- the day
  // DN-116 is about. The plate still says nothing, but the silence now lives
  // in the payload rather than in the resolver, and the session snapshot
  // keeps the fallback underneath.
  it('does not name a prescription on a row the athlete swapped themselves', async () => {
    const { chinUp, pullUp } = await pullLadder();
    const { user, assignment, movement } = await assignedDay(pullUp.id, {
      equipment: [],
    });
    await testPrisma().assignmentSubstitution.create({
      data: {
        userId: user.id,
        assignmentId: assignment.id,
        wodMovementId: movement.id,
        exerciseId: chinUp.id,
      },
    });

    const served = await servedMovement(user.id);
    expect(served.prescribedName).toBeNull();
    expect(served.prescribedReason).toBeNull();
    // And no id either, so the panel offers the prescription once -- through
    // revert, which clears the substitution -- rather than twice (DN-110).
    expect(served.prescribedId).toBeNull();
  });

  it('resolves one athlete equipment without reaching for another', async () => {
    const { pullUp } = await pullLadder();
    const { user: barless } = await assignedDay(pullUp.id, { equipment: [] });
    const { user: owner } = await assignedDay(pullUp.id, {
      equipment: ['bar'],
    });

    expect((await servedMovement(barless.id)).exercise.name).toBe(
      'Row under table',
    );
    expect((await servedMovement(owner.id)).exercise.name).toBe('Pull-up');
  });
});

describe('SchedulerService.getToday', () => {
  it('generates an assignment on a day that has not been decided yet', async () => {
    const user = await createUser();
    const { negative } = await pullLadder();
    await createWod({
      dominantPattern: 'pull',
      movements: [{ exerciseId: negative.id, reps: 30, order: 0 }],
    });

    const today = await service().getToday(user.id, TODAY);

    expect(today.isRestDay).toBe(false);
    expect(today.assignment?.status).toBe('scheduled');
    // Written down, not just returned — tomorrow's read has to find it.
    const stored = await testPrisma().dailyAssignment.findUnique({
      where: { userId_date: { userId: user.id, date: TODAY } },
    });
    expect(stored?.wodId).toBe(today.assignment!.wod!.id);
  });

  it('resolves equipment on a newly generated assignment too', async () => {
    // Both legs of getToday run the resolver; only one of them is exercised
    // by every other case in this file.
    const user = await createUser();
    const { pullUp } = await pullLadder();
    await testPrisma().scheduleRule.create({
      data: { userId: user.id, equipment: [] },
    });
    await createWod({
      dominantPattern: 'pull',
      movements: [{ exerciseId: pullUp.id, reps: 30, order: 0 }],
    });

    const today = await service().getToday(user.id, TODAY);

    expect(today.assignment!.wod!.movements[0].exercise.name).toBe(
      'Row under table',
    );
  });

  it('returns the existing assignment rather than generating a second one', async () => {
    const { negative } = await pullLadder();
    const { user, wod } = await assignedDay(negative.id);

    const today = await service().getToday(user.id, TODAY);

    expect(today.assignment!.wod!.id).toBe(wod.id);
    expect(
      await testPrisma().dailyAssignment.count({ where: { userId: user.id } }),
    ).toBe(1);
  });

  it('reports a rest day when today is not one of the training days', async () => {
    const user = await createUser();
    // TODAY is a Wednesday, and this athlete trains Mon/Tue (DN-12).
    await testPrisma().scheduleRule.create({
      data: { userId: user.id, trainingDays: [1, 2] },
    });
    const { negative } = await pullLadder();
    await createWod({
      dominantPattern: 'pull',
      movements: [{ exerciseId: negative.id, reps: 30, order: 0 }],
    });

    const today = await service().getToday(user.id, TODAY);

    expect(today.isRestDay).toBe(true);
    expect(today.assignment).toBeNull();
  });

  it('trains on a training day however full the week already is', async () => {
    const user = await createUser();
    // Every day picked, so Wednesday is a training day no matter what else
    // the week holds. Under the quota this replaced, three assignments
    // already banked would have made today a rest day.
    await testPrisma().scheduleRule.create({
      data: { userId: user.id, trainingDays: [0, 1, 2, 3, 4, 5, 6] },
    });
    const { negative } = await pullLadder();
    await createWod({
      dominantPattern: 'pull',
      movements: [{ exerciseId: negative.id, reps: 30, order: 0 }],
    });
    await createAssignment(user.id, { date: '2026-09-14' });
    await createAssignment(user.id, { date: '2026-09-15' });

    const today = await service().getToday(user.id, TODAY);

    expect(today.isRestDay).toBe(false);
    expect(today.assignment).not.toBeNull();
  });

  it('reports a skipped day as rest rather than as a workout', async () => {
    const { negative } = await pullLadder();
    const { user, assignment } = await assignedDay(negative.id);
    await testPrisma().dailyAssignment.update({
      where: { id: assignment.id },
      data: { status: 'skipped' },
    });

    const today = await service().getToday(user.id, TODAY);

    expect(today.isRestDay).toBe(true);
    expect(today.assignment).toBeNull();
  });

  it('leaves the checklists off while the setting is off', async () => {
    const { negative } = await pullLadder();
    const { user } = await assignedDay(negative.id);

    const today = await service().getToday(user.id, TODAY);

    expect(today.warmupCooldownEnabled).toBe(false);
    expect(today.warmup).toBeNull();
    expect(today.cooldown).toBeNull();
  });

  it("builds the checklists from the served WOD's pattern once enabled", async () => {
    const { negative } = await pullLadder();
    const { user } = await assignedDay(negative.id);
    await testPrisma().scheduleRule.update({
      where: { userId: user.id },
      data: { warmupCooldownEnabled: true },
    });
    await createExercise({
      name: 'Arm circles',
      pattern: 'pull',
      phase: 'warmup',
      line: null,
      rung: null,
    });
    await createExercise({
      name: 'Lat stretch',
      pattern: 'pull',
      phase: 'cooldown',
      line: null,
      rung: null,
    });

    const today = await service().getToday(user.id, TODAY);

    expect(today.warmup).not.toBeNull();
    expect(today.cooldown).not.toBeNull();
    expect(today.warmup!.map((item) => item.name)).toContain('Arm circles');
  });
});

describe('SchedulerService.skipToday', () => {
  it('marks a day that already had a WOD as rest', async () => {
    const { negative } = await pullLadder();
    const { user, assignment } = await assignedDay(negative.id);

    const result = await service().skipToday(user.id, TODAY);

    expect(result.isRestDay).toBe(true);
    expect(
      (
        await testPrisma().dailyAssignment.findUnique({
          where: { id: assignment.id },
        })
      )?.status,
    ).toBe('skipped');
  });

  it('marks a day that was never generated as rest', async () => {
    // The upsert's create leg: skipping before ever opening Today.
    const user = await createUser();

    await service().skipToday(user.id, TODAY);

    const stored = await testPrisma().dailyAssignment.findUnique({
      where: { userId_date: { userId: user.id, date: TODAY } },
    });
    expect(stored?.status).toBe('skipped');
    expect(stored?.wodId).toBeNull();
  });
});

describe('SchedulerService.getScheduleCap', () => {
  it("counts the athlete's own training days", async () => {
    const user = await createUser();
    await testPrisma().scheduleRule.create({
      data: { userId: user.id, trainingDays: [1, 3, 5] },
    });

    // Derived from the days rather than read from a column of its own (DN-12).
    expect(await service().getScheduleCap(user.id)).toEqual({
      maxDaysPerWeek: 3,
    });
  });

  it('follows the days when they change, having nowhere else to read from', async () => {
    const user = await createUser();
    await testPrisma().scheduleRule.create({
      data: { userId: user.id, trainingDays: [1, 3, 5] },
    });

    await testPrisma().scheduleRule.update({
      where: { userId: user.id },
      data: { trainingDays: [1, 2, 4, 5] },
    });

    expect(await service().getScheduleCap(user.id)).toEqual({
      maxDaysPerWeek: 4,
    });
  });

  it('reports the default cap for an athlete with no rule row', async () => {
    const user = await createUser();

    expect(await service().getScheduleCap(user.id)).toEqual({
      maxDaysPerWeek: 5,
    });
  });
});

/**
 * The floor under per-movement substitution (DN-82).
 *
 * Substituting movement by movement is the right default and it has a limit:
 * a rope workout handed to someone with no rope becomes entirely high knees,
 * which is a workout but no longer *that* workout — and the cooldown rule is
 * then tracking it under a name describing none of what was trained.
 *
 * These go through `getToday`'s generating leg rather than an assigned day,
 * because what is under test is which WODs `pickWod` was allowed to see.
 */
describe('SchedulerService equipment floor', () => {
  /** A rope WOD, a bodyweight WOD, and the high knees the rope falls to. */
  async function library() {
    const highKnees = await createExercise({
      name: 'High knees',
      pattern: 'cardio',
      line: null,
      rung: null,
    });
    const doubleUnders = await createExercise({
      name: 'Double-unders',
      pattern: 'cardio',
      line: null,
      rung: null,
      equipment: ['jump_rope'],
      altExerciseId: highKnees.id,
    });
    const airSquat = await createExercise({
      name: 'Air squat',
      pattern: 'squat',
      line: 'squat',
      rung: 0,
    });

    const ropeWod = await createWod({
      name: 'Rope Trick',
      dominantPattern: 'cardio',
      movements: [{ exerciseId: doubleUnders.id, reps: 30, order: 0 }],
    });
    const squatWod = await createWod({
      name: 'Squat Sixty',
      dominantPattern: 'squat',
      movements: [{ exerciseId: airSquat.id, reps: 20, order: 0 }],
    });
    return { highKnees, doubleUnders, airSquat, ropeWod, squatWod };
  }

  async function athleteOwning(equipment: string[]) {
    const user = await createUser();
    await testPrisma().scheduleRule.create({
      data: { userId: user.id, equipment },
    });
    return user;
  }

  it('does not offer a WOD whose identifying movement needs kit they lack', async () => {
    const { squatWod } = await library();
    const user = await athleteOwning([]);

    const today = await service().getToday(user.id, TODAY);

    // Only one candidate survives the floor, so this holds whatever `pickWod`
    // would otherwise have rolled.
    expect(today.assignment!.wod!.name).toBe(squatWod.name);
  });

  it('offers it once they own the piece', async () => {
    const { ropeWod, doubleUnders } = await library();
    await testPrisma().wod.deleteMany({ where: { name: 'Squat Sixty' } });
    const user = await athleteOwning(['jump_rope']);

    const today = await service().getToday(user.id, TODAY);

    expect(today.assignment!.wod!.name).toBe(ropeWod.name);
    // And nothing is substituted away from them.
    expect(today.assignment!.wod!.movements[0].exercise.name).toBe(
      doubleUnders.name,
    );
  });

  it('still hands over a workout when nothing in the library is performable', async () => {
    // The rule that keeps this safe above `pickWod`'s relaxation ladder: the
    // filter hands back the unfiltered pool rather than emptying it, and
    // per-movement substitution carries the day. A degraded workout beats no
    // workout, and `pickWod` throws on an empty list.
    const { ropeWod, highKnees } = await library();
    await testPrisma().wod.deleteMany({ where: { name: 'Squat Sixty' } });
    const user = await athleteOwning([]);

    const today = await service().getToday(user.id, TODAY);

    expect(today.assignment!.wod!.name).toBe(ropeWod.name);
    expect(today.assignment!.wod!.movements[0].exercise.name).toBe(
      highKnees.name,
    );
  });

  it('keeps a WOD whose pattern the athlete already trains on bodyweight', async () => {
    // The case that makes the floor read the *remembered choice* rather than
    // the prescription. This athlete owns no bar and settled on the ladder's
    // bodyweight rung weeks ago, so nothing of theirs is being substituted
    // for equipment — dropping their pull WODs would be the app arguing with
    // a choice they already made.
    const { negative, pullUp } = await pullLadder();
    await library();
    await testPrisma().wod.deleteMany({ where: { name: 'Squat Sixty' } });
    await testPrisma().wod.updateMany({
      where: { name: 'Rope Trick' },
      data: { name: 'Alpha Rope' },
    });
    // Named to sort first, and the roll pinned to the front of the pool: read
    // the prescription instead of the remembered choice and the pull WOD is
    // dropped, the floor hands back both, and this lands on the rope WOD
    // instead. Without both pins the broken path can pass on candidate order
    // alone.
    const pullWod = await createWod({
      name: 'Zulu Pull',
      dominantPattern: 'pull',
      movements: [{ exerciseId: pullUp.id, reps: 30, order: 0 }],
    });

    const user = await athleteOwning([]);
    await createSkillLevel(user.id, 'pull', 0);

    const random = jest.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const today = await service().getToday(user.id, TODAY);
      expect(today.assignment!.wod!.name).toBe(pullWod.name);
      expect(today.assignment!.wod!.movements[0].exercise.name).toBe(
        negative.name,
      );
    } finally {
      random.mockRestore();
    }
  });
});

describe('SchedulerService reads the stored pattern cooldown', () => {
  /**
   * The wiring between `ScheduleRule.patternCooldownDays` and `pickWod`
   * (DN-119). `scheduler.logic.spec.ts` fixes what the cooldown *means*; only
   * a test that goes through the service can say the stored number is the one
   * that reaches it, and until the rng seam existed no such test could be
   * written — the pick was unpinnable, so replacing the stored value with a
   * literal left every suite passing.
   *
   * The library below is shaped so the two cooldowns disagree. Most are not:
   * `pickWod`'s format-alternation step re-collapses the pool to the same
   * single answer under both, which is what defeated the first attempts at
   * this test.
   */
  async function libraryAndHistory(cooldownDays: number) {
    const move = await createExercise({ line: null, rung: null });

    // Yesterday's workout: an EMOM in the squat pattern.
    const helen = await createWod({
      name: 'Helen',
      type: 'emom',
      dominantPattern: 'squat',
      movements: [{ exerciseId: move.id, reps: 10, order: 0 }],
    });
    // Both AMRAPs, so format alternation keeps both of them.
    const alpha = await createWod({
      name: 'Alpha Wod',
      type: 'amrap',
      dominantPattern: 'squat',
      movements: [{ exerciseId: move.id, reps: 10, order: 0 }],
    });
    const bravo = await createWod({
      name: 'Bravo Wod',
      type: 'amrap',
      dominantPattern: 'pull',
      movements: [{ exerciseId: move.id, reps: 10, order: 0 }],
    });

    const user = await createUser();
    await testPrisma().scheduleRule.create({
      data: { userId: user.id, patternCooldownDays: cooldownDays },
    });
    await createAssignment(user.id, { date: '2026-09-15', wodId: helen.id });

    return { user, alpha, bravo };
  }

  /** Pinned to the first of whatever pool survives, so the pool is what is measured. */
  const always0 = () => 0;

  it('honours a stored cooldown, which rules out yesterday’s pattern', async () => {
    const { user, bravo } = await libraryAndHistory(5);

    const today = await service(testPrisma(), always0).getToday(user.id, TODAY);

    // Helen is out by name and Alpha Wod by pattern, both inside the 5-day
    // window, so the squat WOD cannot come round again today.
    expect(today.assignment!.wod!.name).toBe(bravo.name);
  });

  it('rolls the randomness it was given, not Math.random', async () => {
    // Without this, reverting the seam does not fail the two cases above --
    // it makes them flaky, because the pool they leave has two members and
    // the real Math.random agrees with a pinned 0 about half the time. A
    // coin-flip failure is worse than no test: it reads as an infra problem
    // and gets re-run rather than read.
    const { user } = await libraryAndHistory(0);
    let rolls = 0;
    const counting = () => {
      rolls += 1;
      return 0;
    };

    await service(testPrisma(), counting).getToday(user.id, TODAY);

    expect(rolls).toBe(1);
  });

  it('honours a stored 0, which rules out nothing', async () => {
    const { user, alpha } = await libraryAndHistory(0);

    const today = await service(testPrisma(), always0).getToday(user.id, TODAY);

    // Off means yesterday's squat pattern is eligible again, so the pool is
    // both AMRAPs and the pinned roll takes the first by name.
    expect(today.assignment!.wod!.name).toBe(alpha.name);
  });
});

/**
 * The program half of the plate (DN-16): `getToday` resolving the day
 * through the active enrollment.
 *
 * Same real database as everything above, and for the same reason turned to
 * a different question: almost everything this resolution decides is a fact
 * about rows -- which enrollment is active, what the authored week says
 * about this weekday, which columns the new assignment carries, and whether
 * a finished run is still active afterwards. A mock would assert that Prisma
 * was called and leave every one of those unanswered.
 */

// 2026-09-14 is a Monday, so 09-19 is the Saturday of that same week and
// 09-21 the Monday after. Every date below is a weekday somebody checked.
const MONDAY = '2026-09-14';
const SATURDAY = '2026-09-19';
const NEXT_MONDAY = '2026-09-21';

/** An athlete who trains Mon–Fri, stated rather than defaulted. */
async function athlete(trainingDays = [1, 2, 3, 4, 5]) {
  const user = await createUser();
  await testPrisma().scheduleRule.create({
    data: { userId: user.id, trainingDays },
  });
  return user;
}

/** A plan whose single core week authors `kind` on every weekday. */
async function everyDayPlan(
  kind: string,
  slotOverrides: Record<string, unknown> = {},
  planOverrides: Record<string, unknown> = {},
) {
  return createPlan({
    ...planOverrides,
    weeks: {
      create: [
        {
          order: 0,
          phase: 'core',
          slots: {
            create: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
              dayOfWeek,
              kind,
              ...slotOverrides,
            })),
          },
        },
      ],
    },
  });
}

/** The scheduler with the draw pinned, so a failure is about the day the
 * program chose rather than about which of two equally valid WODs the roll
 * landed on (DN-119). */
function programService(): SchedulerService {
  return service(testPrisma(), () => 0);
}

describe('SchedulerService.getToday, under a program', () => {
  it('keeps the pre-programs behaviour for an athlete with no enrollment', async () => {
    // The floor this whole change has to stand on: nothing about an athlete
    // who has never touched a program may move.
    const user = await athlete();
    await createWod();

    const today = await programService().getToday(user.id, MONDAY);

    expect(today.plan).toBeNull();
    expect(today.isRestDay).toBe(false);
    expect(today.assignment).not.toBeNull();
  });

  it('still rests on a day the athlete does not train, with no enrollment', async () => {
    const user = await athlete();

    const today = await programService().getToday(user.id, SATURDAY);

    expect(today).toMatchObject({
      isRestDay: true,
      assignment: null,
      plan: null,
    });
  });

  it('defers to the athlete’s training days on a flexible program', async () => {
    // Just WODs is exactly this shape: seven authored days, flexible, so the
    // athlete's own schedule still decides. If this failed, enrolling
    // everyone in DN-13 would have silently turned every day into a training
    // day for every athlete in the app.
    const user = await athlete();
    const plan = await everyDayPlan('wod_generated', { allowNamed: true });
    await createEnrollment(user.id, {
      planId: plan.id,
      startDate: MONDAY,
      weeks: null,
    });
    await createWod();

    const saturday = await programService().getToday(user.id, SATURDAY);

    expect(saturday.isRestDay).toBe(true);
    // The program is still context even on a day it is not running: the
    // athlete is in week 1 of it whether or not they train on Saturday.
    expect(saturday.plan).toMatchObject({ name: plan.name, week: 1 });
    // Null rather than the slot's own kind -- the day is off because the
    // athlete said so, not because the program planned a rest.
    expect(saturday.plan?.slotKind).toBeNull();
  });

  it('overrides them on a fixed program, whose slots are the schedule', async () => {
    const user = await athlete();
    const plan = await everyDayPlan(
      'wod_generated',
      { allowNamed: true },
      { scheduleMode: 'fixed', minDaysPerWeek: null, maxDaysPerWeek: null },
    );
    await createEnrollment(user.id, {
      planId: plan.id,
      startDate: MONDAY,
      weeks: null,
    });
    await createWod();

    const saturday = await programService().getToday(user.id, SATURDAY);

    expect(saturday.isRestDay).toBe(false);
    expect(saturday.assignment).not.toBeNull();
  });

  it('rests on an authored rest day, and says the program planned it', async () => {
    const user = await athlete();
    const plan = await everyDayPlan('rest');
    await createEnrollment(user.id, {
      planId: plan.id,
      startDate: MONDAY,
      weeks: null,
    });

    const today = await programService().getToday(user.id, MONDAY);

    expect(today.isRestDay).toBe(true);
    expect(today.plan?.slotKind).toBe('rest');
  });

  it('trains the WOD the program pinned', async () => {
    const user = await athlete();
    const pinned = await createWod({ name: 'Fran', isNamed: true });
    // A second WOD in the library, so passing cannot be an accident of there
    // being only one thing to pick.
    await createWod({ name: 'Cindy' });
    const plan = await everyDayPlan('wod_pinned', { wodId: pinned.id });
    await createEnrollment(user.id, {
      planId: plan.id,
      startDate: MONDAY,
      weeks: null,
    });

    const today = await programService().getToday(user.id, MONDAY);

    expect(today.assignment?.wod!.id).toBe(pinned.id);
    expect(today.plan?.slotKind).toBe('wod_pinned');
  });

  it('honours a generated slot’s pattern', async () => {
    const user = await athlete();
    await createWod({ name: 'Push day', dominantPattern: 'push' });
    const pull = await createWod({ name: 'Pull day', dominantPattern: 'pull' });
    const plan = await everyDayPlan('wod_generated', {
      pattern: 'pull',
      allowNamed: true,
    });
    await createEnrollment(user.id, {
      planId: plan.id,
      startDate: MONDAY,
      weeks: null,
    });

    const today = await programService().getToday(user.id, MONDAY);

    expect(today.assignment?.wod!.id).toBe(pull.id);
  });

  it('would rather break the slot than hand over kit the athlete lacks', async () => {
    // The ordering of the two narrowings, which is only observable when they
    // disagree (DN-16). The athlete owns no bar; the slot asks for pull; the
    // only pull WOD in the library needs a bar.
    //
    // Equipment first: the bar WOD is dropped, the pattern finds nothing left
    // and relaxes, and the athlete trains the push WOD they can actually do.
    // Slot first: the pool is the bar WOD alone, and the equipment floor --
    // which never empties a pool -- has no choice but to hand it back. The
    // athlete opens Today and is prescribed a pull-up with no bar in the room.
    //
    // Equipment is a physical fact and the slot is an authorial preference,
    // so the preference is the one that gives way.
    const bar = await createExercise({
      name: 'Pull-up over a bar',
      pattern: 'pull',
      line: null,
      rung: null,
      equipment: ['bar'],
    });
    const user = await createUser();
    await testPrisma().scheduleRule.create({
      data: { userId: user.id, trainingDays: [1, 2, 3, 4, 5], equipment: [] },
    });
    await createWod({
      name: 'Barbelled pull day',
      dominantPattern: 'pull',
      movements: [{ exerciseId: bar.id, reps: 30, order: 0 }],
    });
    const push = await createWod({ name: 'Push day', dominantPattern: 'push' });
    const plan = await everyDayPlan('wod_generated', {
      pattern: 'pull',
      allowNamed: true,
    });
    await createEnrollment(user.id, {
      planId: plan.id,
      startDate: MONDAY,
      weeks: null,
    });

    const today = await programService().getToday(user.id, MONDAY);

    expect(today.assignment?.wod!.id).toBe(push.id);
  });

  it('keeps a named WOD off a slot that did not ask for one', async () => {
    // `allowNamed` defaults false for a reason: a benchmark landing in the
    // middle of a progression block is the surprise that default prevents.
    const user = await athlete();
    await createWod({ name: 'Fran', isNamed: true, dominantPattern: 'pull' });
    const plain = await createWod({ name: 'Plain', dominantPattern: 'pull' });
    const plan = await everyDayPlan('wod_generated', { pattern: 'pull' });
    await createEnrollment(user.id, {
      planId: plan.id,
      startDate: MONDAY,
      weeks: null,
    });

    const today = await programService().getToday(user.id, MONDAY);

    expect(today.assignment?.wod!.id).toBe(plain.id);
  });

  it('records which slot of which run produced the day', async () => {
    // The three columns exist so History and the completion card can say "day
    // 17 of 24" without recomputing a date difference per row.
    const user = await athlete();
    const plan = await everyDayPlan('wod_generated', { allowNamed: true });
    const enrollment = await createEnrollment(user.id, {
      planId: plan.id,
      startDate: MONDAY,
      weeks: null,
    });
    await createWod();

    await programService().getToday(user.id, NEXT_MONDAY);

    const stored = await testPrisma().dailyAssignment.findFirstOrThrow({
      where: { userId: user.id, date: NEXT_MONDAY },
    });
    expect(stored.enrollmentId).toBe(enrollment.id);
    expect(stored.planDayIndex).toBe(7);
    expect(stored.planSlotId).not.toBeNull();
  });

  it('leaves the plan columns null on a day no program produced', async () => {
    const user = await athlete();
    await createWod();

    await programService().getToday(user.id, MONDAY);

    const stored = await testPrisma().dailyAssignment.findFirstOrThrow({
      where: { userId: user.id, date: MONDAY },
    });
    expect(stored.enrollmentId).toBeNull();
    expect(stored.planSlotId).toBeNull();
    expect(stored.planDayIndex).toBeNull();
  });

  it('counts the athlete’s week from one', async () => {
    const user = await athlete();
    const plan = await everyDayPlan('wod_generated', { allowNamed: true });
    await createEnrollment(user.id, {
      planId: plan.id,
      startDate: MONDAY,
      weeks: null,
    });
    await createWod();

    const today = await programService().getToday(user.id, NEXT_MONDAY);

    expect(today.plan).toMatchObject({ week: 2, totalWeeks: null });
  });
});

describe('SchedulerService.getToday, at the edges of a run', () => {
  it('falls back before the start date without touching the enrollment', async () => {
    // How enrolling on Thursday to start Monday works: one active
    // enrollment, and the days in between are ordinary Just WODs days.
    const user = await athlete();
    const plan = await everyDayPlan('rest');
    const enrollment = await createEnrollment(user.id, {
      planId: plan.id,
      startDate: NEXT_MONDAY,
      weeks: 4,
    });
    await createWod();

    const today = await programService().getToday(user.id, MONDAY);

    expect(today.plan).toBeNull();
    // A rest-authored program did not make today a rest day, because it has
    // not started: the athlete trains.
    expect(today.assignment).not.toBeNull();
    expect(
      await testPrisma().planEnrollment.findUniqueOrThrow({
        where: { id: enrollment.id },
      }),
    ).toMatchObject({ status: 'active', completedAt: null });
  });

  it('completes a run past its last day and falls back the same request', async () => {
    // Completed on read rather than by a nightly job: the day a program ends
    // is a day the athlete opens Today, and nobody needs the row flipped
    // before then.
    const user = await athlete();
    const plan = await everyDayPlan('rest');
    const enrollment = await createEnrollment(user.id, {
      planId: plan.id,
      startDate: MONDAY,
      weeks: 1,
    });
    await createWod();

    const today = await programService().getToday(user.id, NEXT_MONDAY);

    expect(
      await testPrisma().planEnrollment.findUniqueOrThrow({
        where: { id: enrollment.id },
      }),
    ).toMatchObject({ status: 'completed' });
    expect(today.plan).toBeNull();
    // The rest-authored program no longer decides the day, so the athlete's
    // own training days do: Monday is one.
    expect(today.assignment).not.toBeNull();
  });

  it('is unchanged by a second request once the run has completed', async () => {
    const user = await athlete();
    const plan = await everyDayPlan('rest');
    const enrollment = await createEnrollment(user.id, {
      planId: plan.id,
      startDate: MONDAY,
      weeks: 1,
    });
    await createWod();
    await programService().getToday(user.id, NEXT_MONDAY);
    const completedAt = (
      await testPrisma().planEnrollment.findUniqueOrThrow({
        where: { id: enrollment.id },
      })
    ).completedAt;

    await programService().getToday(user.id, NEXT_MONDAY);

    // `updateMany` is scoped to active rows, so the second pass cannot
    // re-stamp a completion the athlete already has.
    expect(
      await testPrisma().planEnrollment.findUniqueOrThrow({
        where: { id: enrollment.id },
      }),
    ).toMatchObject({ completedAt });
  });

  it('ignores an enrollment that is not active', async () => {
    const user = await athlete();
    const plan = await everyDayPlan('rest');
    await createEnrollment(user.id, {
      planId: plan.id,
      startDate: MONDAY,
      weeks: null,
      status: 'completed',
    });
    await createWod();

    const today = await programService().getToday(user.id, MONDAY);

    expect(today.plan).toBeNull();
    expect(today.assignment).not.toBeNull();
  });

  it('reports the program alongside a day already decided', async () => {
    // The plan block is recomputed rather than read off the stored row, so it
    // is there on the second visit of the day too.
    const user = await athlete();
    const plan = await everyDayPlan('wod_generated', { allowNamed: true });
    await createEnrollment(user.id, {
      planId: plan.id,
      startDate: MONDAY,
      weeks: null,
    });
    await createWod();
    await programService().getToday(user.id, MONDAY);

    const again = await programService().getToday(user.id, MONDAY);

    expect(again.plan).toMatchObject({ name: plan.name, week: 1 });
    expect(again.assignment).not.toBeNull();
  });
});

describe('SchedulerService.skipToday', () => {
  it('keeps reporting the program the athlete is still on', async () => {
    // Skipping a day is not leaving the program, so the strip that says which
    // week they are in is still true afterwards.
    const user = await athlete();
    const plan = await everyDayPlan('wod_generated', { allowNamed: true });
    await createEnrollment(user.id, {
      planId: plan.id,
      startDate: MONDAY,
      weeks: null,
    });

    const skipped = await programService().skipToday(user.id, MONDAY);

    expect(skipped.isRestDay).toBe(true);
    expect(skipped.plan).toMatchObject({ name: plan.name, week: 1 });
  });

  it('reports no program for an athlete who has none', async () => {
    const user = await athlete();

    expect((await programService().skipToday(user.id, MONDAY)).plan).toBeNull();
  });
});

/**
 * A fixed program, whose slot layout *is* the schedule (DN-16). The CHECK
 * `Plan_schedule_mode_bounds` refuses day bounds on one, so both are nulled
 * here rather than inherited from the fixture's flexible defaults.
 */
async function fixedPlan(kind = 'wod_generated') {
  return everyDayPlan(
    kind,
    { allowNamed: true },
    { scheduleMode: 'fixed', minDaysPerWeek: null, maxDaysPerWeek: null },
  );
}

describe('SchedulerService makeup days (DN-17)', () => {
  describe('the offer', () => {
    it('offers the session on a rest day while the week is short', async () => {
      const user = await athlete();
      await createWod();
      await createAssignment(user.id, { date: MONDAY, status: 'completed' });

      const today = await programService().getToday(user.id, SATURDAY);

      expect(today.isRestDay).toBe(true);
      expect(today.makeup).toEqual({
        sessionsThisWeek: 5,
        completedThisWeek: 1,
      });
    });

    it('offers nothing on a training day', async () => {
      const user = await athlete();
      await createWod();

      expect(
        (await programService().getToday(user.id, MONDAY)).makeup,
      ).toBeNull();
    });

    it('offers nothing once the week’s sessions are done', async () => {
      const user = await athlete([1, 2]);
      await createWod();
      await createAssignment(user.id, { date: MONDAY, status: 'completed' });
      await createAssignment(user.id, {
        date: '2026-09-15',
        status: 'completed',
      });

      expect(
        (await programService().getToday(user.id, SATURDAY)).makeup,
      ).toBeNull();
    });

    it('counts only finished sessions, not scheduled ones', async () => {
      // A scheduled day is the app's expectation, not the athlete's work.
      // Counting it would make every week look finished before it was.
      const user = await athlete();
      await createWod();
      await createAssignment(user.id, { date: MONDAY, status: 'scheduled' });
      await createAssignment(user.id, {
        date: '2026-09-15',
        status: 'skipped',
      });

      expect(
        (await programService().getToday(user.id, SATURDAY)).makeup,
      ).toMatchObject({ completedThisWeek: 0 });
    });

    it('carries nothing across the week boundary', async () => {
      // Last week's five completions do not settle this week. Carrying debt
      // -- or credit -- forward turns the app into something the athlete is
      // behind on, which is the thing this feature exists not to do.
      const user = await athlete();
      await createWod();
      for (const date of [
        '2026-09-07',
        '2026-09-08',
        '2026-09-09',
        '2026-09-10',
        '2026-09-11',
      ]) {
        await createAssignment(user.id, { date, status: 'completed' });
      }

      expect(
        (await programService().getToday(user.id, SATURDAY)).makeup,
      ).toEqual({ sessionsThisWeek: 5, completedThisWeek: 0 });
    });

    it('opts a fixed program out entirely', async () => {
      // Its slot layout is the schedule, and compacting Thursday and Friday
      // into the weekend would defeat the reason it was fixed.
      const user = await athlete();
      await createWod();
      const plan = await fixedPlan('rest');
      await createEnrollment(user.id, {
        planId: plan.id,
        startDate: MONDAY,
        weeks: null,
      });

      const today = await programService().getToday(user.id, SATURDAY);

      expect(today.isRestDay).toBe(true);
      expect(today.makeup).toBeNull();
    });

    it('still offers under a flexible program, which defers to the athlete', async () => {
      const user = await athlete();
      await createWod();
      const plan = await everyDayPlan('wod_generated', { allowNamed: true });
      await createEnrollment(user.id, {
        planId: plan.id,
        startDate: MONDAY,
        weeks: null,
      });

      expect(
        (await programService().getToday(user.id, SATURDAY)).makeup,
      ).toMatchObject({ sessionsThisWeek: 5 });
    });

    it('stands on a day the athlete marked as rest', async () => {
      // They changed their mind. The row already says skipped, and the week
      // is still short.
      const user = await athlete();
      await createWod();
      await programService().skipToday(user.id, MONDAY);

      const today = await programService().getToday(user.id, MONDAY);

      expect(today.isRestDay).toBe(true);
      expect(today.makeup).toMatchObject({ completedThisWeek: 0 });
    });

    it('is reported by skipToday itself, not only on the next read', async () => {
      const user = await athlete();
      await createWod();

      expect(
        (await programService().skipToday(user.id, SATURDAY)).makeup,
      ).toMatchObject({ sessionsThisWeek: 5 });
    });
  });

  describe('taking it', () => {
    it('hands over a real session on a rest day', async () => {
      const user = await athlete();
      const wod = await createWod();

      const today = await programService().trainMakeup(user.id, SATURDAY);

      expect(today.isRestDay).toBe(false);
      expect(today.assignment).toMatchObject({ status: 'scheduled' });
      expect(today.assignment.wod!.id).toBe(wod.id);
      // Taken, so there is nothing left to offer.
      expect(today.makeup).toBeNull();
    });

    it('records the day so the next read is the same session', async () => {
      const user = await athlete();
      await createWod();

      const taken = await programService().trainMakeup(user.id, SATURDAY);
      const reread = await programService().getToday(user.id, SATURDAY);

      expect(reread.isRestDay).toBe(false);
      expect(reread.assignment?.id).toBe(taken.assignment.id);
    });

    it('turns a day marked as rest back into a training day', async () => {
      // The row already exists, and (userId, date) is unique -- so this has
      // to update rather than insert a second one.
      const user = await athlete();
      await createWod();
      await programService().skipToday(user.id, SATURDAY);

      const taken = await programService().trainMakeup(user.id, SATURDAY);

      expect(taken.isRestDay).toBe(false);
      expect(
        await testPrisma().dailyAssignment.count({
          where: { userId: user.id, date: SATURDAY },
        }),
      ).toBe(1);
    });

    it('refuses on a training day, which has a session already', async () => {
      const user = await athlete();
      await createWod();

      await expect(
        programService().trainMakeup(user.id, MONDAY),
      ).rejects.toThrow(/no makeup session/i);
    });

    it('refuses once the week is done', async () => {
      const user = await athlete([1]);
      await createWod();
      await createAssignment(user.id, { date: MONDAY, status: 'completed' });

      await expect(
        programService().trainMakeup(user.id, SATURDAY),
      ).rejects.toThrow(/no makeup session/i);
    });

    it('refuses under a fixed program', async () => {
      // The offer is suppressed on the screen, so a request arriving anyway
      // is a stale client -- and answering it would train the athlete on a
      // day the program deliberately kept clear.
      const user = await athlete();
      await createWod();
      const plan = await fixedPlan('rest');
      await createEnrollment(user.id, {
        planId: plan.id,
        startDate: MONDAY,
        weeks: null,
      });

      await expect(
        programService().trainMakeup(user.id, SATURDAY),
      ).rejects.toThrow(/no makeup session/i);
    });

    it('writes nothing when it refuses', async () => {
      const user = await athlete();
      await createWod();

      await programService()
        .trainMakeup(user.id, MONDAY)
        .catch(() => undefined);

      expect(
        await testPrisma().dailyAssignment.count({
          where: { userId: user.id, date: MONDAY },
        }),
      ).toBe(0);
    });

    it('hands over the session the program authored for that weekday', async () => {
      // The point of resolving against a full week rather than the athlete's
      // training days: a flexible program has a session waiting behind the
      // day they chose off, and that is the one a makeup should deliver.
      //
      // The draw is pinned to the *other* WOD on purpose. Resolving against
      // the athlete's days instead would make Saturday a rest day, fall
      // through to generation, and hand back whatever the roll chose -- so a
      // draw that agreed with the authored slot would pass either way and
      // prove nothing.
      const user = await athlete();
      const authored = await createWod({ name: 'Authored Saturday' });
      const rolled = await createWod({ name: 'Something else entirely' });
      const plan = await everyDayPlan('wod_pinned', { wodId: authored.id });
      await createEnrollment(user.id, {
        planId: plan.id,
        startDate: MONDAY,
        weeks: null,
      });

      const taken = await service(testPrisma(), () => 0.999).trainMakeup(
        user.id,
        SATURDAY,
      );

      expect(taken.assignment.wod!.id).toBe(authored.id);
      expect(taken.assignment.wod!.id).not.toBe(rolled.id);
      expect(taken.plan).toMatchObject({ name: plan.name });
    });

    it('records which program day it was, the way a scheduled day does', async () => {
      const user = await athlete();
      await createWod();
      const plan = await everyDayPlan('wod_generated', { allowNamed: true });
      await createEnrollment(user.id, {
        planId: plan.id,
        startDate: MONDAY,
        weeks: null,
      });

      const taken = await programService().trainMakeup(user.id, SATURDAY);

      const row = await testPrisma().dailyAssignment.findUnique({
        where: { id: taken.assignment.id },
      });
      expect(row).toMatchObject({ planDayIndex: 5 });
      expect(row?.enrollmentId).not.toBeNull();
      expect(row?.planSlotId).not.toBeNull();
    });
  });
});

/**
 * A prescribed day: straight sets rather than a WOD (DN-19).
 *
 * Through the real resolver and a real database, because what is worth
 * pinning down is the same thing the rest of this file is about — wiring. The
 * pure decisions (which rung, what happens when the library cannot answer)
 * are fixed in `prescription.spec.ts`; these say that a program authoring a
 * line ends up handing this athlete a movement with a name on it, and that
 * the day is recorded as a day.
 */
describe('SchedulerService.getToday, on a prescribed day', () => {
  /** A pull ladder whose upper rung needs a bar and falls back off the line. */
  async function pullRungs() {
    const alt = await createExercise({
      name: 'Row under table',
      pattern: 'pull',
      line: null,
      rung: null,
    });
    const ring = await createExercise({
      name: 'Ring row',
      pattern: 'pull',
      line: 'pull',
      rung: 0,
    });
    const chinUp = await createExercise({
      name: 'Chin-up',
      pattern: 'pull',
      line: 'pull',
      rung: 1,
      equipment: ['pull_up_bar'],
      altExerciseId: alt.id,
    });
    return { alt, ring, chinUp };
  }

  /** A program that prescribes `pull, 5x3, rest 90s` every day of the week. */
  async function prescribingPlan(
    movements: Record<string, unknown>[] = [
      { order: 0, line: 'pull', sets: 5, reps: 3, restSeconds: 90 },
    ],
  ) {
    return everyDayPlan('movements', { movements: { create: movements } });
  }

  async function enrolled(user: { id: string }, planId: string) {
    return createEnrollment(user.id, {
      planId,
      startDate: MONDAY,
      weeks: null,
    });
  }

  it('hands over the prescription instead of a WOD', async () => {
    const { ring } = await pullRungs();
    const user = await athlete();
    await enrolled(user, (await prescribingPlan()).id);

    const today = await programService().getToday(user.id, TODAY);

    expect(today.isRestDay).toBe(false);
    expect(today.assignment!.wod).toBeNull();
    expect(today.assignment!.prescription).toMatchObject({
      movements: [
        {
          line: 'pull',
          sets: 5,
          reps: 3,
          restSeconds: 90,
          exercise: { id: ring.id, name: ring.name },
          // The rung is not a substitution. A program that asked for "pull"
          // and handed over a ring row did exactly what it said, and naming
          // it as a replacement would tell the athlete something was taken
          // away from them.
          prescribedName: null,
          prescribedReason: null,
        },
      ],
    });
  });

  it('meets the athlete at the rung they train the line at', async () => {
    // The whole reason a program authors a line: one program, written once,
    // fits the athlete on rung 0 and the one on rung 1.
    const { chinUp } = await pullRungs();
    const user = await athlete();
    await createSkillLevel(user.id, 'pull', 1);
    await testPrisma().scheduleRule.update({
      where: { userId: user.id },
      data: { equipment: ['pull_up_bar'] },
    });
    await enrolled(user, (await prescribingPlan()).id);

    const today = await programService().getToday(user.id, TODAY);

    expect(today.assignment!.prescription!.movements[0].exercise.id).toBe(
      chinUp.id,
    );
  });

  it('drops off the line for an athlete who owns none of the kit, and says so', async () => {
    // Equipment is the one layer that replaced something the athlete was told
    // about, so it is the one that gets named. The rung is not a substitution:
    // a program that asked for "pull" and handed over a row did what it said.
    const { alt, chinUp } = await pullRungs();
    const user = await athlete();
    await createSkillLevel(user.id, 'pull', 1);
    await enrolled(user, (await prescribingPlan()).id);

    const today = await programService().getToday(user.id, TODAY);

    expect(today.assignment!.prescription!.movements[0]).toMatchObject({
      exercise: { id: alt.id },
      prescribedName: chinUp.name,
      prescribedReason: 'equipment',
      // What the *program* asked for survives the fallback: the line is the
      // session's intent, and a screen showing only the substitute could not
      // say what the day was for.
      line: 'pull',
    });
  });

  it('records the day as an assignment with no WOD on it', async () => {
    const { ring } = await pullRungs();
    const user = await athlete();
    await enrolled(user, (await prescribingPlan()).id);

    const today = await programService().getToday(user.id, TODAY);

    const row = await testPrisma().dailyAssignment.findUnique({
      where: { id: today.assignment!.id },
    });
    expect(row).toMatchObject({ wodId: null, status: 'scheduled' });
    expect(row?.planSlotId).not.toBeNull();
    expect(row?.enrollmentId).not.toBeNull();
    expect(ring.id).toBeTruthy();
  });

  it('reads the recorded day back rather than writing a second one', async () => {
    // The WOD-less row used to collapse to `assignment: null` on the way
    // back out, which would have turned a prescribed day into a blank screen
    // on every reload.
    await pullRungs();
    const user = await athlete();
    await enrolled(user, (await prescribingPlan()).id);

    const first = await programService().getToday(user.id, TODAY);
    const again = await programService().getToday(user.id, TODAY);

    expect(again.assignment!.id).toBe(first.assignment!.id);
    expect(again.assignment!.prescription!.movements).toHaveLength(1);
    expect(
      await testPrisma().dailyAssignment.count({ where: { userId: user.id } }),
    ).toBe(1);
  });

  it('prescribes the movements in the order they were authored', async () => {
    await pullRungs();
    await createExercise({
      name: 'Air squat',
      pattern: 'squat',
      line: 'squat',
      rung: 0,
    });
    const user = await athlete();
    await enrolled(
      user,
      (
        await prescribingPlan([
          { order: 1, line: 'squat', sets: 3, reps: 10, restSeconds: 60 },
          { order: 0, line: 'pull', sets: 5, reps: 3, restSeconds: 90 },
        ])
      ).id,
    );

    const today = await programService().getToday(user.id, TODAY);

    expect(
      today.assignment!.prescription!.movements.map((m) => m.line),
    ).toEqual(['pull', 'squat']);
  });

  it('generates a WOD rather than an empty day when nothing resolves', async () => {
    // The line exists in the enum but not in this athlete's library. An
    // authoring or library gap costs them the session it described, not the
    // day.
    const wod = await createWod();
    const user = await athlete();
    await enrolled(user, (await prescribingPlan()).id);

    const today = await programService().getToday(user.id, TODAY);

    expect(today.assignment!.prescription).toBeNull();
    expect(today.assignment!.wod!.id).toBe(wod.id);
  });

  it('hands over the prescription when the day is taken as a makeup', async () => {
    // A makeup resolves against the whole week (DN-17), so a flexible
    // program's Saturday session is whatever it authored -- including straight
    // sets.
    const { ring } = await pullRungs();
    const user = await athlete();
    await enrolled(user, (await prescribingPlan()).id);

    const taken = await programService().trainMakeup(user.id, SATURDAY);

    expect(taken.assignment.wod).toBeNull();
    expect(taken.assignment.prescription!.movements[0].exercise.id).toBe(
      ring.id,
    );
  });
});
