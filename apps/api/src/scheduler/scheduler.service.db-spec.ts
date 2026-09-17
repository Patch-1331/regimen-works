import type { PrismaClient } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { testPrisma } from '../test-support/database';
import {
  createAssignment,
  createExercise,
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

function service(client: PrismaClient = testPrisma()): SchedulerService {
  const prisma = client as unknown as PrismaService;
  return new SchedulerService(
    prisma,
    new WodsService(prisma),
    new MovementResolutionService(prisma),
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
  return today.assignment!.wod.movements[0];
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

    expect(today.assignment!.wod.movements).toHaveLength(1);
    expect(today.assignment!.wod.movements[0].exercise.name).toBe(
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
    expect(stored?.wodId).toBe(today.assignment!.wod.id);
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

    expect(today.assignment!.wod.movements[0].exercise.name).toBe(
      'Row under table',
    );
  });

  it('returns the existing assignment rather than generating a second one', async () => {
    const { negative } = await pullLadder();
    const { user, wod } = await assignedDay(negative.id);

    const today = await service().getToday(user.id, TODAY);

    expect(today.assignment!.wod.id).toBe(wod.id);
    expect(
      await testPrisma().dailyAssignment.count({ where: { userId: user.id } }),
    ).toBe(1);
  });

  it('reports a rest day once the week is at its cap', async () => {
    const user = await createUser();
    await testPrisma().scheduleRule.create({
      data: { userId: user.id, maxDaysPerWeek: 2 },
    });
    const { negative } = await pullLadder();
    await createWod({
      dominantPattern: 'pull',
      movements: [{ exerciseId: negative.id, reps: 30, order: 0 }],
    });
    // TODAY is a Wednesday; these are the Monday and Tuesday of its week.
    await createAssignment(user.id, { date: '2026-09-14' });
    await createAssignment(user.id, { date: '2026-09-15' });

    const today = await service().getToday(user.id, TODAY);

    expect(today.isRestDay).toBe(true);
    expect(today.assignment).toBeNull();
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
  it("reports the athlete's own cap", async () => {
    const user = await createUser();
    await testPrisma().scheduleRule.create({
      data: { userId: user.id, maxDaysPerWeek: 3 },
    });

    expect(await service().getScheduleCap(user.id)).toEqual({
      maxDaysPerWeek: 3,
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
    expect(today.assignment!.wod.name).toBe(squatWod.name);
  });

  it('offers it once they own the piece', async () => {
    const { ropeWod, doubleUnders } = await library();
    await testPrisma().wod.deleteMany({ where: { name: 'Squat Sixty' } });
    const user = await athleteOwning(['jump_rope']);

    const today = await service().getToday(user.id, TODAY);

    expect(today.assignment!.wod.name).toBe(ropeWod.name);
    // And nothing is substituted away from them.
    expect(today.assignment!.wod.movements[0].exercise.name).toBe(
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

    expect(today.assignment!.wod.name).toBe(ropeWod.name);
    expect(today.assignment!.wod.movements[0].exercise.name).toBe(
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
      expect(today.assignment!.wod.name).toBe(pullWod.name);
      expect(today.assignment!.wod.movements[0].exercise.name).toBe(
        negative.name,
      );
    } finally {
      random.mockRestore();
    }
  });
});
