import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PrismaService } from '../prisma/prisma.service';
import { testPrisma } from '../test-support/database';
import {
  createAssignment,
  createChecklistEntry,
  createExercise,
  createSession,
  createSetLog,
  createSkillLevel,
  createUser,
  createWod,
} from '../test-support/fixtures';
import { WodsService } from './wods.service';

/**
 * The migration that turned `Exercise.phase` into checklist entries (DN-172,
 * ADR-0008), run against data shaped the way production's is.
 *
 * The test database is already past it, so each test puts the old column
 * back, writes rows the way they were before, and runs the migration's own
 * data steps -- read from the file, so what is tested is what deploys.
 * Production's data only goes through this once; these are the tests that
 * say it went through intact.
 */

const MIGRATION = join(
  __dirname,
  '../../prisma/migrations/20261012000000_checklist_entries/migration.sql',
);

/**
 * Tables renamed by a later migration, as the replay must name them: the
 * file is replayed against today's schema, not the one it first ran on.
 * `20261015000000_rename_plan_to_program` (DN-176) made `PlanSlotMovement`
 * `ProgramSlotMovement`.
 */
const RENAMED_SINCE: [string, string][] = [
  ['"PlanSlotMovement"', '"ProgramSlotMovement"'],
];

/** The migration's numbered section `n`, up to the next one. */
function section(n: number): string {
  const sql = readFileSync(MIGRATION, 'utf8');
  const start = sql.indexOf(`-- ${n}.`);
  const end = sql.indexOf(`-- ${n + 1}.`);
  if (start < 0 || end < 0) throw new Error(`no section ${n} in ${MIGRATION}`);
  return RENAMED_SINCE.reduce(
    (text, [then, now]) => text.replaceAll(then, now),
    sql.slice(start, end),
  );
}

/** Steps 2 and 3: every phase to an entry, and the duplicate squat folded. */
async function migrate() {
  await testPrisma().$executeRawUnsafe(section(2));
  await testPrisma().$executeRawUnsafe(section(3));
}

beforeEach(async () => {
  await testPrisma().$executeRawUnsafe(
    'ALTER TABLE "Exercise" ADD COLUMN "phase" TEXT',
  );
});

afterEach(async () => {
  await testPrisma().$executeRawUnsafe(
    'ALTER TABLE "Exercise" DROP COLUMN IF EXISTS "phase"',
  );
});

/** An exercise as the old seed wrote it: tagged with a phase. */
async function createTagged(
  phase: 'warmup' | 'cooldown',
  overrides: Record<string, unknown> = {},
) {
  const row = await createExercise({
    ownerId: null,
    movementGroup: null,
    ...overrides,
  });
  await testPrisma().$executeRawUnsafe(
    'UPDATE "Exercise" SET "phase" = $1 WHERE "id" = $2',
    phase,
    row.id,
  );
  return row;
}

/** The two squats as production has them before the migration. */
async function bothSquats() {
  const air = await createExercise({
    ownerId: null,
    name: 'Air squat',
    pattern: 'squat',
    movementGroup: 'squat',
    instructions: ['Hip crease below the knee, then stand all the way up.'],
  });
  const bodyweight = await createTagged('warmup', {
    name: 'Bodyweight squats',
    pattern: 'squat',
    instructions: ['Easy, unloaded air squats at a steady pace.'],
  });
  return { air, bodyweight };
}

describe('every phase becomes an entry', () => {
  it('on the same checklist, for the same pattern, in the same tier', async () => {
    const alice = await createUser();
    const global = await createTagged('cooldown', {
      name: 'Cat-cow',
      pattern: 'core',
    });
    const hers = await createTagged('warmup', {
      name: 'Band pull-aparts',
      pattern: 'pull',
      ownerId: alice.id,
    });
    await createExercise({ name: 'Thruster' });

    await migrate();

    const entries = await testPrisma().checklistEntry.findMany({
      orderBy: { kind: 'asc' },
    });
    expect(entries).toEqual([
      expect.objectContaining({
        exerciseId: global.id,
        kind: 'cooldown',
        pattern: 'core',
        ownerId: null,
        instructions: [],
      }),
      expect.objectContaining({
        exerciseId: hers.id,
        kind: 'warmup',
        pattern: 'pull',
        ownerId: alice.id,
        instructions: [],
      }),
    ]);
  });

  it('keeps a filler movement as filler', async () => {
    await createTagged('warmup', {
      name: 'Light jogging in place',
      pattern: null,
    });

    await migrate();

    expect(await testPrisma().checklistEntry.findFirstOrThrow()).toMatchObject({
      kind: 'warmup',
      pattern: null,
    });
  });
});

describe('Bodyweight squats folding into Air squat', () => {
  it('moves the warm-up across with its warm-up copy', async () => {
    const { air } = await bothSquats();

    await migrate();

    expect(await testPrisma().checklistEntry.findMany()).toEqual([
      expect.objectContaining({
        exerciseId: air.id,
        kind: 'warmup',
        pattern: 'squat',
        instructions: ['Easy, unloaded air squats at a steady pace.'],
      }),
    ]);
    // And Air squat keeps its own: the workout is a working set.
    expect(
      (await testPrisma().exercise.findUniqueOrThrow({ where: { id: air.id } }))
        .instructions,
    ).toEqual(['Hip crease below the knee, then stand all the way up.']);
  });

  it('deletes the duplicate row', async () => {
    const { bodyweight } = await bothSquats();

    await migrate();

    expect(
      await testPrisma().exercise.findUnique({ where: { id: bodyweight.id } }),
    ).toBeNull();
  });

  it('moves everything that named the duplicate onto Air squat', async () => {
    // Nothing in production does today; the migration must not assume so,
    // or the first row that did would vanish with the delete.
    const { air, bodyweight } = await bothSquats();
    const alice = await createUser();
    const wod = await createWod({
      movements: [{ exerciseId: bodyweight.id, reps: 30, order: 0 }],
    });
    const choice = await createSkillLevel(alice.id, 'squat', bodyweight.id);
    const assignment = await createAssignment(alice.id, { wodId: wod.id });
    const session = await createSession(alice.id, assignment.id);
    const setLog = await createSetLog(alice.id, session.id, bodyweight.id);
    const leaning = await createExercise({
      name: 'Jump squat',
      fallbackExerciseId: bodyweight.id,
    });

    await migrate();

    const prisma = testPrisma();
    expect(
      (await prisma.wodMovement.findFirstOrThrow({ where: { wodId: wod.id } }))
        .exerciseId,
    ).toBe(air.id);
    expect(
      (await prisma.skillLevel.findUniqueOrThrow({ where: { id: choice.id } }))
        .exerciseId,
    ).toBe(air.id);
    expect(
      (
        await prisma.workoutSetLog.findUniqueOrThrow({
          where: { id: setLog.id },
        })
      ).exerciseId,
    ).toBe(air.id);
    expect(
      (await prisma.exercise.findUniqueOrThrow({ where: { id: leaning.id } }))
        .fallbackExerciseId,
    ).toBe(air.id);
  });

  it('leaves an athlete’s own "Bodyweight squats" alone', async () => {
    const alice = await createUser();
    await createExercise({
      ownerId: null,
      name: 'Air squat',
      pattern: 'squat',
    });
    const hers = await createTagged('warmup', {
      name: 'Bodyweight squats',
      pattern: 'squat',
      ownerId: alice.id,
    });

    await migrate();

    expect(
      await testPrisma().exercise.findUnique({ where: { id: hers.id } }),
    ).not.toBeNull();
    expect(
      (await testPrisma().checklistEntry.findFirstOrThrow()).exerciseId,
    ).toBe(hers.id);
  });

  it('does nothing on a database without both rows', async () => {
    // A fresh database, a test one: nothing to fold, and no error for it.
    const bodyweight = await createTagged('warmup', {
      name: 'Bodyweight squats',
      pattern: 'squat',
    });

    await migrate();

    expect(
      (await testPrisma().checklistEntry.findFirstOrThrow()).exerciseId,
    ).toBe(bodyweight.id);
  });
});

/**
 * The checklists an athlete sees, before and after. Production's twelve
 * tagged rows plus Air squat, migrated, then read the way Today reads them.
 * The expected lists are what the `phase` read produced from the same rows;
 * the only change is that the squat warm-up is Air squat, carrying the copy
 * it had as Bodyweight squats.
 */
describe('the checklists, before and after', () => {
  const TAGGED: ['warmup' | 'cooldown', string, string | null][] = [
    ['warmup', 'Arm circles', 'push'],
    ['warmup', 'Leg swings', 'hinge'],
    ['warmup', 'Bodyweight squats', 'squat'],
    ['warmup', 'Inchworms', 'core'],
    ['warmup', 'Scapular pull-ups', 'pull'],
    ['warmup', 'Light jogging in place', null],
    ['cooldown', 'Static quad stretch', 'squat'],
    ['cooldown', "Child's pose", 'hinge'],
    ['cooldown', 'Cat-cow', 'core'],
    ['cooldown', 'Doorway chest stretch', 'push'],
    ['cooldown', 'Cross-body shoulder stretch', 'pull'],
    ['cooldown', 'Deep breathing', null],
  ];

  const EXPECTED: Record<string, [string[], string[]]> = {
    push: [
      ['Arm circles', 'Light jogging in place'],
      ['Doorway chest stretch', 'Deep breathing'],
    ],
    pull: [
      ['Scapular pull-ups', 'Light jogging in place'],
      ['Cross-body shoulder stretch', 'Deep breathing'],
    ],
    squat: [
      ['Air squat', 'Light jogging in place'],
      ['Static quad stretch', 'Deep breathing'],
    ],
    hinge: [
      ['Leg swings', 'Light jogging in place'],
      ["Child's pose", 'Deep breathing'],
    ],
    core: [
      ['Inchworms', 'Light jogging in place'],
      ['Cat-cow', 'Deep breathing'],
    ],
    cardio: [['Light jogging in place'], ['Deep breathing']],
  };

  async function productionBeforeTheMigration() {
    await createExercise({
      ownerId: null,
      name: 'Air squat',
      pattern: 'squat',
      movementGroup: 'squat',
      instructions: ['Hip crease below the knee, then stand all the way up.'],
    });
    for (const [phase, name, pattern] of TAGGED) {
      await createTagged(phase, {
        name,
        pattern,
        instructions: [`${name}, as the checklist says it.`],
      });
    }
  }

  it.each(Object.keys(EXPECTED))('on a %s day', async (pattern) => {
    await productionBeforeTheMigration();
    await migrate();

    const { warmup, cooldown } = await new WodsService(
      testPrisma() as unknown as PrismaService,
    ).getChecklists((await createUser()).id, pattern);

    expect([warmup.map((e) => e.name), cooldown.map((e) => e.name)]).toEqual(
      EXPECTED[pattern],
    );
  });

  it('still tells the athlete to take the warm-up squat easy', async () => {
    await productionBeforeTheMigration();
    await migrate();

    const { warmup } = await new WodsService(
      testPrisma() as unknown as PrismaService,
    ).getChecklists((await createUser()).id, 'squat');

    expect(warmup[0].instructions).toEqual([
      'Bodyweight squats, as the checklist says it.',
    ]);
  });
});

describe('the global tier', () => {
  it('holds a movement on each checklist at most once', async () => {
    // A partial index, so it lives only in the migration -- `prisma migrate
    // dev` would offer to drop it. This is what notices.
    const row = await createExercise({ ownerId: null });
    await createChecklistEntry(row.id, 'warmup', { ownerId: null });

    await expect(
      createChecklistEntry(row.id, 'warmup', { ownerId: null }),
    ).rejects.toThrow(
      /Unique constraint|ChecklistEntry_global_exerciseId_kind_key/,
    );
  });

  it('lets the same movement be on both checklists', async () => {
    const row = await createExercise({ ownerId: null });
    await createChecklistEntry(row.id, 'warmup');
    await createChecklistEntry(row.id, 'cooldown');

    expect(await testPrisma().checklistEntry.count()).toBe(2);
  });
});
