import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { testPrisma } from '../test-support/database';
import { createProgram } from '../test-support/fixtures';

/**
 * The migration that moved a program line's sets onto rows of their own
 * (DN-190, ADR 0011), run against lines shaped the way production's are.
 *
 * The test database is already past it, so each test puts the line's old
 * columns back, writes lines the way they were before, and runs the
 * migration's own copy step -- read from the file, so what is tested is what
 * deploys. Every program line in production goes through this once.
 */

const MIGRATION = join(
  __dirname,
  '../../prisma/migrations/20261023000000_program_slot_sets/migration.sql',
);

/** The migration's numbered section `n`, up to the next one. */
function section(n: number): string {
  const sql = readFileSync(MIGRATION, 'utf8');
  const start = sql.indexOf(`-- ${n}.`);
  const end = sql.indexOf(`-- ${n + 1}.`);
  if (start < 0 || end < 0) throw new Error(`no section ${n} in ${MIGRATION}`);
  return sql.slice(start, end);
}

/** Step 2: every line to `sets` identical rows. */
async function migrate() {
  await testPrisma().$executeRawUnsafe(section(2));
}

const OLD_COLUMNS = ['sets', 'reps', 'repsMax', 'toFailure', 'restSeconds'];

beforeEach(async () => {
  await testPrisma().$executeRawUnsafe(
    `ALTER TABLE "ProgramSlotMovement"
       ADD COLUMN "sets" INTEGER,
       ADD COLUMN "reps" INTEGER,
       ADD COLUMN "repsMax" INTEGER,
       ADD COLUMN "toFailure" BOOLEAN NOT NULL DEFAULT false,
       ADD COLUMN "restSeconds" INTEGER`,
  );
});

afterEach(async () => {
  await testPrisma().$executeRawUnsafe(
    `ALTER TABLE "ProgramSlotMovement" ${OLD_COLUMNS.map(
      (c) => `DROP COLUMN IF EXISTS "${c}"`,
    ).join(', ')}`,
  );
});

interface OldLine {
  sets: number;
  reps: number | null;
  repsMax?: number | null;
  toFailure?: boolean;
  restSeconds: number | null;
}

/** A program line as it was stored before: a count and one rep shape. */
async function createOldLine(line: OldLine, order = 0) {
  const program = await createProgram({
    weeks: {
      create: [
        {
          order: 0,
          phase: 'core',
          slots: { create: [{ dayOfWeek: 1, kind: 'movements' }] },
        },
      ],
    },
  });
  const slot = await testPrisma().programSlot.findFirstOrThrow({
    where: { programWeek: { programId: program.id } },
  });
  const row = await testPrisma().programSlotMovement.create({
    data: { programSlotId: slot.id, order, movementGroup: 'pull' },
  });
  await testPrisma().$executeRawUnsafe(
    `UPDATE "ProgramSlotMovement"
        SET "sets" = $1, "reps" = $2, "repsMax" = $3, "toFailure" = $4, "restSeconds" = $5
      WHERE "id" = $6`,
    line.sets,
    line.reps,
    line.repsMax ?? null,
    line.toFailure ?? false,
    line.restSeconds,
    row.id,
  );
  return row;
}

/** What the line became, in order, without the generated ids. */
async function setsOf(lineId: string) {
  const rows = await testPrisma().programSlotSet.findMany({
    where: { programSlotMovementId: lineId },
    orderBy: { order: 'asc' },
  });
  return rows.map(({ order, reps, repsMax, toFailure, restSeconds }) => ({
    order,
    reps,
    repsMax,
    toFailure,
    restSeconds,
  }));
}

/** `count` copies of one set, numbered from 0. */
function numbered(
  count: number,
  set: Omit<Awaited<ReturnType<typeof setsOf>>[number], 'order'>,
) {
  return Array.from({ length: count }, (_, order) => ({ order, ...set }));
}

describe('every line becomes its sets', () => {
  it('a fixed count, one row per set', async () => {
    const line = await createOldLine({ sets: 5, reps: 3, restSeconds: 90 });

    await migrate();

    expect(await setsOf(line.id)).toEqual(
      numbered(5, {
        reps: 3,
        repsMax: null,
        toFailure: false,
        restSeconds: 90,
      }),
    );
  });

  it('a range, keeping both ends on every set', async () => {
    const line = await createOldLine({
      sets: 3,
      reps: 8,
      repsMax: 12,
      restSeconds: 60,
    });

    await migrate();

    expect(await setsOf(line.id)).toEqual(
      numbered(3, { reps: 8, repsMax: 12, toFailure: false, restSeconds: 60 }),
    );
  });

  it('to failure, with no count on any set', async () => {
    const line = await createOldLine({
      sets: 2,
      reps: null,
      toFailure: true,
      restSeconds: 120,
    });

    await migrate();

    expect(await setsOf(line.id)).toEqual(
      numbered(2, {
        reps: null,
        repsMax: null,
        toFailure: true,
        restSeconds: 120,
      }),
    );
  });

  it('a single set, as one row', async () => {
    const line = await createOldLine({ sets: 1, reps: 20, restSeconds: 90 });

    await migrate();

    expect(await setsOf(line.id)).toHaveLength(1);
  });
});

describe('rest survives as the source said it', () => {
  // ADR 0005: null is "the source was silent" and 0 is "straight through".
  // A copy that coalesced either into the other would change what Today
  // shows and how the runner paces, on every line it touched.
  it('an unstated rest stays null on every set', async () => {
    const line = await createOldLine({ sets: 3, reps: 5, restSeconds: null });

    await migrate();

    expect((await setsOf(line.id)).map((s) => s.restSeconds)).toEqual([
      null,
      null,
      null,
    ]);
  });

  it('a stated 0 stays 0 on every set', async () => {
    const line = await createOldLine({ sets: 3, reps: 5, restSeconds: 0 });

    await migrate();

    expect((await setsOf(line.id)).map((s) => s.restSeconds)).toEqual([
      0, 0, 0,
    ]);
  });
});

it('keeps each line to its own sets', async () => {
  const pull = await createOldLine({ sets: 4, reps: 6, restSeconds: 90 });
  const squat = await createOldLine({ sets: 2, reps: 10, restSeconds: null });

  await migrate();

  expect(await setsOf(pull.id)).toHaveLength(4);
  expect(await setsOf(squat.id)).toEqual(
    numbered(2, {
      reps: 10,
      repsMax: null,
      toFailure: false,
      restSeconds: null,
    }),
  );
  expect(await testPrisma().programSlotSet.count()).toBe(6);
});
