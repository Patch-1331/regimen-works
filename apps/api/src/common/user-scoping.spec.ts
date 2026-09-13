import { LogsService } from '../logs/logs.service';
import { SessionsService } from '../sessions/sessions.service';
import { SettingsService } from '../settings/settings.service';
import { SkillLevelsService } from '../skill-levels/skill-levels.service';
import { SchedulerService } from '../scheduler/scheduler.service';
import { MovementResolutionService } from '../scheduler/movement-resolution.service';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * The compiler catches an unscoped *write* — Prisma's generated types demand
 * userId. It does not catch an unscoped *read*: `findMany({ orderBy })` with
 * no where clause compiles perfectly and returns every user's rows. Those are
 * the dangerous ones, and these tests exist for them specifically.
 *
 * Each case asserts the query Prisma was handed actually carries the caller's
 * id. A missing scope shows up as a where clause without it.
 */

const ALICE = 'user_alice';

/** Records every call so a test can inspect the query that was built. */
function recordingPrisma() {
  const calls: Record<string, unknown[]> = {};
  const record = (key: string) =>
    jest.fn((args: unknown) => {
      (calls[key] ??= []).push(args);
      return Promise.resolve(null);
    });

  const prisma = {
    calls,
    scheduleRule: { findUnique: record('scheduleRule.findUnique') },
    skillLevel: {
      findMany: jest.fn((args: unknown) => {
        (calls['skillLevel.findMany'] ??= []).push(args);
        return Promise.resolve([]);
      }),
      findUnique: record('skillLevel.findUnique'),
    },
    workoutLog: {
      findMany: jest.fn((args: unknown) => {
        (calls['workoutLog.findMany'] ??= []).push(args);
        return Promise.resolve([]);
      }),
      findFirst: record('workoutLog.findFirst'),
    },
    workoutSession: { findFirst: record('workoutSession.findFirst') },
    dailyAssignment: {
      findUnique: record('dailyAssignment.findUnique'),
      findFirst: record('dailyAssignment.findFirst'),
      findMany: jest.fn((args: unknown) => {
        (calls['dailyAssignment.findMany'] ??= []).push(args);
        return Promise.resolve([]);
      }),
      count: jest.fn((args: unknown) => {
        (calls['dailyAssignment.count'] ??= []).push(args);
        return Promise.resolve(0);
      }),
    },
    exercise: { findMany: jest.fn(() => Promise.resolve([])) },
    wod: { findMany: jest.fn(() => Promise.resolve([])) },
  };
  return prisma as typeof prisma & PrismaService;
}

/** Every `where` the given call was made with, flattened for assertions. */
function whereOf(prisma: ReturnType<typeof recordingPrisma>, key: string) {
  const args = (prisma.calls[key] ?? []) as { where?: unknown }[];
  expect(args.length).toBeGreaterThan(0);
  return args.map((a) => JSON.stringify(a.where ?? {}));
}

describe('per-user query scoping', () => {
  it('scopes the workout log list', async () => {
    const prisma = recordingPrisma();
    await new LogsService(prisma).list(ALICE);
    for (const where of whereOf(prisma, 'workoutLog.findMany')) {
      expect(where).toContain(ALICE);
    }
  });

  it('scopes a single log lookup by assignment', async () => {
    const prisma = recordingPrisma();
    await new LogsService(prisma).getForAssignment(ALICE, 'assignment-1');
    for (const where of whereOf(prisma, 'workoutLog.findFirst')) {
      expect(where).toContain(ALICE);
    }
  });

  it('scopes the skill level list', async () => {
    const prisma = recordingPrisma();
    await new SkillLevelsService(prisma).findAll(ALICE);
    for (const where of whereOf(prisma, 'skillLevel.findMany')) {
      expect(where).toContain(ALICE);
    }
  });

  it('scopes settings reads', async () => {
    const prisma = recordingPrisma();
    await new SettingsService(prisma).get(ALICE);
    for (const where of whereOf(prisma, 'scheduleRule.findUnique')) {
      expect(where).toContain(ALICE);
    }
  });

  it('scopes a session lookup, so another user id cannot reach it', async () => {
    const prisma = recordingPrisma();
    await new SessionsService(
      prisma,
      new MovementResolutionService(prisma),
    ).get(ALICE, 'assignment-1');
    for (const where of whereOf(prisma, 'workoutSession.findFirst')) {
      expect(where).toContain(ALICE);
    }
  });

  it("scopes today's assignment and the skill levels it scales with", async () => {
    const prisma = recordingPrisma();
    const wods = {
      getChecklists: jest.fn(),
    } as unknown as ConstructorParameters<typeof SchedulerService>[1];
    // No assignment exists, so this runs on into WOD generation. That throws
    // with an empty catalogue, which is fine — the queries under test were
    // already issued, and what matters is the scope they carried.
    await new SchedulerService(
      prisma,
      wods,
      new MovementResolutionService(prisma),
    )
      .getToday(ALICE, '2026-09-07')
      .catch(() => undefined);

    for (const where of whereOf(prisma, 'dailyAssignment.findUnique')) {
      expect(where).toContain(ALICE);
    }
    for (const where of whereOf(prisma, 'scheduleRule.findUnique')) {
      expect(where).toContain(ALICE);
    }
    // The history driving the pattern cooldown must be this user's alone.
    for (const where of whereOf(prisma, 'dailyAssignment.findMany')) {
      expect(where).toContain(ALICE);
    }
    // As must the weekly cap count.
    for (const where of whereOf(prisma, 'dailyAssignment.count')) {
      expect(where).toContain(ALICE);
    }
  });
});
