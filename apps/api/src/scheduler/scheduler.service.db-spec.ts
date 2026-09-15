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
 * What the Today plate is served, against a real database.
 *
 * DN-79 pulled this file forward from the Test Coverage backlog deliberately:
 * the equipment layer changes what this service hands the athlete, and tests
 * written to the old shape would have been rewritten alongside it. Written
 * with the change, they are the specification for it.
 *
 * `movement-resolution.service.db-spec.ts` covers the resolution itself. What
 * is left here is everything around it — that the day is decided once and then
 * read back, that the week's cap and a skipped day short-circuit before any
 * WOD is picked, and, the part that matters for equipment, that the resolution
 * reaches both the day it is generated and every read afterwards. A layer
 * applied on generation but not on read would show an athlete a movement they
 * cannot do the moment they reload.
 */

const TODAY = '2026-09-16';

function service(): SchedulerService {
  const prisma = testPrisma() as unknown as PrismaService;
  return new SchedulerService(
    prisma,
    new WodsService(prisma),
    new MovementResolutionService(prisma),
  );
}

/** The only WOD in the library: one bar movement with an off-ladder substitute. */
async function barLibrary() {
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
  return { alt, pullUp, wod };
}

async function athlete(equipment: string[]) {
  const user = await createUser();
  await testPrisma().scheduleRule.create({
    data: { userId: user.id, equipment },
  });
  return user;
}

describe('SchedulerService.getToday', () => {
  it('generates the day when nothing has been decided yet', async () => {
    const { wod } = await barLibrary();
    const user = await athlete(['bar']);

    const today = await service().getToday(user.id, TODAY);

    expect(today.isRestDay).toBe(false);
    expect(today.assignment?.wod.id).toBe(wod.id);
    expect(today.assignment?.status).toBe('scheduled');
    expect(await testPrisma().dailyAssignment.count()).toBe(1);
  });

  it('decides the day once, then reads it back', async () => {
    await barLibrary();
    const user = await athlete(['bar']);

    const first = await service().getToday(user.id, TODAY);
    const second = await service().getToday(user.id, TODAY);

    expect(second.assignment?.id).toBe(first.assignment?.id);
    expect(await testPrisma().dailyAssignment.count()).toBe(1);
  });

  it('serves a movement the athlete cannot perform as its substitute', async () => {
    const { alt } = await barLibrary();
    const user = await athlete([]);

    const today = await service().getToday(user.id, TODAY);

    expect(today.assignment?.wod.movements[0].exercise.id).toBe(alt.id);
  });

  it('resolves equipment on every read, not only on the day it is generated', async () => {
    // The assignment stores a wodId, and the library row it points at is
    // shared and unchanged. Resolution that happened only on generation would
    // leave the athlete a pull-up on the next reload.
    const { alt } = await barLibrary();
    const user = await athlete([]);

    await service().getToday(user.id, TODAY);
    const reread = await service().getToday(user.id, TODAY);

    expect(reread.assignment?.wod.movements[0].exercise.id).toBe(alt.id);
  });

  it('leaves the shared library row alone while degrading what it serves', async () => {
    // `Wod` is library content. Resolving at read time is what keeps one
    // athlete's missing bar from rewriting the WOD for everyone else.
    const { wod, pullUp } = await barLibrary();
    const user = await athlete([]);

    await service().getToday(user.id, TODAY);

    const stored = await testPrisma().wod.findUniqueOrThrow({
      where: { id: wod.id },
      include: { movements: true },
    });
    expect(stored.movements[0].exerciseId).toBe(pullUp.id);
  });

  it('serves two athletes the same WOD resolved differently', async () => {
    const { pullUp, alt } = await barLibrary();
    const owner = await athlete(['bar']);
    const without = await athlete([]);

    const forOwner = await service().getToday(owner.id, TODAY);
    const forOther = await service().getToday(without.id, TODAY);

    expect(forOwner.assignment?.wod.id).toBe(forOther.assignment?.wod.id);
    expect(forOwner.assignment?.wod.movements[0].exercise.id).toBe(pullUp.id);
    expect(forOther.assignment?.wod.movements[0].exercise.id).toBe(alt.id);
  });

  it('applies the remembered choice before the equipment check', async () => {
    // Prescribed movement needs nothing; the athlete's standing choice on the
    // line needs a bar. What they are served is that choice's substitute.
    const { alt } = await barLibrary();
    const ringRow = await createExercise({
      name: 'Ring row',
      pattern: 'pull',
      line: 'pull',
      rung: 0,
    });
    const wod = await createWod({
      dominantPattern: 'pull',
      movements: [{ exerciseId: ringRow.id, reps: 30, order: 0 }],
    });
    await testPrisma().wod.deleteMany({ where: { id: { not: wod.id } } });

    const user = await athlete([]);
    await createSkillLevel(user.id, 'pull', 3);

    const today = await service().getToday(user.id, TODAY);

    expect(today.assignment?.wod.movements[0].exercise.id).toBe(alt.id);
  });

  it('calls the week done once the athlete has hit their cap', async () => {
    await barLibrary();
    const user = await createUser();
    await testPrisma().scheduleRule.create({
      data: { userId: user.id, maxDaysPerWeek: 1 },
    });
    // 2026-09-14 is the Monday of TODAY's week.
    await createAssignment(user.id, { date: '2026-09-14' });

    const today = await service().getToday(user.id, TODAY);

    expect(today.isRestDay).toBe(true);
    expect(today.assignment).toBeNull();
    expect(today.warmup).toBeNull();
  });

  it('reports a skipped day as rest rather than resolving a WOD for it', async () => {
    await barLibrary();
    const user = await athlete(['bar']);
    await service().skipToday(user.id, TODAY);

    const today = await service().getToday(user.id, TODAY);

    expect(today.isRestDay).toBe(true);
    expect(today.assignment).toBeNull();
  });

  it('withholds the checklists until the athlete turns them on', async () => {
    await barLibrary();
    const user = await athlete(['bar']);

    expect((await service().getToday(user.id, TODAY)).warmup).toBeNull();
  });

  it('builds the checklists from the served WOD pattern once enabled', async () => {
    await barLibrary();
    const user = await createUser();
    await testPrisma().scheduleRule.create({
      data: {
        userId: user.id,
        equipment: ['bar'],
        warmupCooldownEnabled: true,
      },
    });
    await createExercise({
      name: 'Arm circles',
      pattern: 'pull',
      phase: 'warmup',
      line: null,
      rung: null,
    });
    await createExercise({
      name: 'Doorway chest stretch',
      pattern: 'pull',
      phase: 'cooldown',
      line: null,
      rung: null,
    });

    const today = await service().getToday(user.id, TODAY);

    expect(today.warmupCooldownEnabled).toBe(true);
    expect(today.warmup?.length).toBeGreaterThan(0);
    expect(today.cooldown?.length).toBeGreaterThan(0);
  });

  it('keeps one athlete day out of another', async () => {
    await barLibrary();
    const user = await athlete(['bar']);
    const other = await athlete(['bar']);

    const forUser = await service().getToday(user.id, TODAY);
    const forOther = await service().getToday(other.id, TODAY);

    expect(forUser.assignment?.id).not.toBe(forOther.assignment?.id);
    expect(await testPrisma().dailyAssignment.count()).toBe(2);
  });
});

describe('SchedulerService.getScheduleCap', () => {
  it('reads the athlete cap', async () => {
    const user = await createUser();
    await testPrisma().scheduleRule.create({
      data: { userId: user.id, maxDaysPerWeek: 3 },
    });

    expect(await service().getScheduleCap(user.id)).toEqual({
      maxDaysPerWeek: 3,
    });
  });

  it('falls back to five days for an athlete with no rule row', async () => {
    const user = await createUser();

    expect(await service().getScheduleCap(user.id)).toEqual({
      maxDaysPerWeek: 5,
    });
  });
});
