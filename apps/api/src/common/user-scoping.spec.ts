import { ExercisesService } from '../exercises/exercises.service';
import { LogsService } from '../logs/logs.service';
import { SessionsService } from '../sessions/sessions.service';
import { SettingsService } from '../settings/settings.service';
import { SkillLevelsService } from '../skill-levels/skill-levels.service';
import { SchedulerService } from '../scheduler/scheduler.service';
import { MovementResolutionService } from '../scheduler/movement-resolution.service';
import { EnrollmentsService } from '../enrollments/enrollments.service';
import { WodsService } from '../wods/wods.service';
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
    assignmentSubstitution: {
      findMany: jest.fn((args: unknown) => {
        (calls['assignmentSubstitution.findMany'] ??= []).push(args);
        return Promise.resolve([]);
      }),
    },
    skillLevelUpsert: record('skillLevel.upsert'),
    exercise: {
      findMany: jest.fn((args: unknown) => {
        (calls['exercise.findMany'] ??= []).push(args);
        return Promise.resolve([]);
      }),
      aggregate: jest.fn((args: unknown) => {
        (calls['exercise.aggregate'] ??= []).push(args);
        return Promise.resolve({ _max: { rung: 9 } });
      }),
    },
    wod: {
      findMany: jest.fn((args: unknown) => {
        (calls['wod.findMany'] ??= []).push(args);
        return Promise.resolve([]);
      }),
      findUnique: record('wod.findUnique'),
    },
    planEnrollment: {
      findFirst: record('planEnrollment.findFirst'),
      updateMany: record('planEnrollment.updateMany'),
    },
  };
  return prisma as typeof prisma & PrismaService;
}

/** Every `where` the given call was made with, flattened for assertions. */
function whereOf(prisma: ReturnType<typeof recordingPrisma>, key: string) {
  const args = (prisma.calls[key] ?? []) as { where?: unknown }[];
  expect(args.length).toBeGreaterThan(0);
  return args.map((a) => JSON.stringify(a.where ?? {}));
}

/**
 * The library's two tiers, asserted together (DN-93): the caller's own rows
 * *and* the global ones. Checking only for the caller's id would pass a read
 * scoped to `{ ownerId: userId }`, which compiles, reads correctly in a test
 * about an athlete's own content, and silently costs them the entire shared
 * library.
 */
function expectLibraryScope(where: string) {
  expect(where).toContain('"ownerId":null');
  expect(where).toContain(ALICE);
  // The liveness half (DN-25). Dropped, every one of these pools starts
  // offering movements the library has retired — and unlike the ownership
  // half, that failure is invisible until a seeded row is actually archived,
  // so nothing else in the suite would notice.
  expect(where).toContain('"archivedAt":null');
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

  it('scopes the enrollment the schedule lock is read from', async () => {
    // Settings reaches for the active enrollment too (DN-118), on its own
    // path rather than through the scheduler. Unscoped it would report
    // somebody else's program as the thing locking this athlete's week.
    const prisma = recordingPrisma();
    await new SettingsService(prisma).get(ALICE, '2026-09-07');
    for (const where of whereOf(prisma, 'planEnrollment.findFirst')) {
      expect(where).toContain(ALICE);
    }
  });

  it('scopes settings reads', async () => {
    const prisma = recordingPrisma();
    await new SettingsService(prisma).get(ALICE, '2026-09-07');
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
      new EnrollmentsService(prisma),
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
  });

  it('scopes the week-so-far read behind the makeup offer', async () => {
    // A Saturday, so the rest-day fork runs (DN-17). Unscoped this would
    // total every athlete's completed sessions, and a busy database would
    // quietly decide this athlete's week was done.
    //
    // A `findMany` rather than a `count` since DN-123: the week's sessions
    // are laid onto the days the athlete actually trained, so *which* days
    // were completed matters and not only how many.
    const prisma = recordingPrisma();
    const wods = {
      getChecklists: jest.fn(),
    } as unknown as ConstructorParameters<typeof SchedulerService>[1];
    await new SchedulerService(
      prisma,
      wods,
      new MovementResolutionService(prisma),
      new EnrollmentsService(prisma),
    )
      .getToday(ALICE, '2026-09-19')
      .catch(() => undefined);

    const reads = whereOf(prisma, 'dailyAssignment.findMany').filter((w) =>
      w.includes('completed'),
    );
    expect(reads.length).toBeGreaterThan(0);
    for (const where of reads) {
      expect(where).toContain(ALICE);
    }
  });
});

/**
 * The library is the one place a read can be wrong in two directions. Every
 * other model is the caller's alone, so a missing `userId` is the only
 * failure; `Exercise` and `Wod` hold global rows everyone reads plus personal
 * rows only their owner may see, and a read can lose either half.
 */
describe('library ownership scoping', () => {
  it('scopes the exercise list to the global library plus the caller', async () => {
    const prisma = recordingPrisma();
    await new ExercisesService(prisma).findAll(ALICE);
    for (const where of whereOf(prisma, 'exercise.findMany')) {
      expectLibraryScope(where);
    }
  });

  it('scopes the WOD list', async () => {
    const prisma = recordingPrisma();
    await new WodsService(prisma).findAll(ALICE);
    for (const where of whereOf(prisma, 'wod.findMany')) {
      expectLibraryScope(where);
    }
  });

  it('scopes the warm-up/cool-down pool', async () => {
    // Pulled by `phase` rather than by id, so an unscoped read here hands the
    // athlete somebody else's movement inside a checklist they did not author.
    const prisma = recordingPrisma();
    await new WodsService(prisma).getChecklists(ALICE, 'push');
    for (const where of whereOf(prisma, 'exercise.findMany')) {
      expectLibraryScope(where);
    }
  });

  it('scopes the candidate WOD pool and the rung lookup behind it', async () => {
    const prisma = recordingPrisma();
    const wods = {
      getChecklists: jest.fn(),
    } as unknown as ConstructorParameters<typeof SchedulerService>[1];
    await new SchedulerService(
      prisma,
      wods,
      new MovementResolutionService(prisma),
      new EnrollmentsService(prisma),
    )
      .getToday(ALICE, '2026-09-07')
      .catch(() => undefined);

    for (const where of whereOf(prisma, 'wod.findMany')) {
      expectLibraryScope(where);
    }
    for (const where of whereOf(prisma, 'exercise.findMany')) {
      expectLibraryScope(where);
    }
  });

  it('scopes the enrollment the day is resolved through', async () => {
    // The read that decides whose program shapes today (DN-16). Unscoped it
    // compiles and returns whichever active enrollment Postgres happens to
    // hand back first -- which is to say, someone else's program, on this
    // athlete's screen, writing their id onto a stranger's run.
    const prisma = recordingPrisma();
    const wods = {
      getChecklists: jest.fn(),
    } as unknown as ConstructorParameters<typeof SchedulerService>[1];
    await new SchedulerService(
      prisma,
      wods,
      new MovementResolutionService(prisma),
      new EnrollmentsService(prisma),
    )
      .getToday(ALICE, '2026-09-07')
      .catch(() => undefined);

    for (const where of whereOf(prisma, 'planEnrollment.findFirst')) {
      expect(where).toContain(ALICE);
    }
  });

  it('scopes both reads behind movement resolution', async () => {
    // A movement needing a dumbbell against the default kit, so the second,
    // conditional read — the one that loads the equipment fallback — is
    // actually issued rather than skipped.
    const prisma = recordingPrisma();
    await new MovementResolutionService(prisma).resolve(ALICE, 'assignment-1', [
      {
        id: 'wm-1',
        exercise: {
          id: 'ex-1',
          equipment: ['dumbbell'],
          fallbackExerciseId: 'ex-2',
          movementGroup: null,
          rung: null,
        },
      },
    ] as unknown as Parameters<MovementResolutionService['resolve']>[2]);

    const wheres = whereOf(prisma, 'exercise.findMany');
    expect(wheres).toHaveLength(2);
    for (const where of wheres) {
      expectLibraryScope(where);
    }
  });

  it('scopes the rung ceiling a skill level is checked against', async () => {
    // Off the library, this reads the ceiling from every athlete's rows at
    // once: one athlete authoring a rung-9 movement would raise what everyone
    // else is allowed to set.
    const prisma = recordingPrisma();
    await new SkillLevelsService(prisma)
      .setRung(ALICE, 'push_horizontal', 1)
      .catch(() => undefined);
    for (const where of whereOf(prisma, 'exercise.aggregate')) {
      expectLibraryScope(where);
    }
  });
});
