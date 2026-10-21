import { ExercisesService } from '../exercises/exercises.service';
import { LogsService } from '../logs/logs.service';
import { SessionsService } from '../sessions/sessions.service';
import { SettingsService } from '../settings/settings.service';
import { SkillLevelsService } from '../skill-levels/skill-levels.service';
import { SchedulerService } from '../scheduler/scheduler.service';
import { MovementResolutionService } from '../scheduler/movement-resolution.service';
import { EnrollmentsService } from '../enrollments/enrollments.service';
import { WodsService } from '../wods/wods.service';
import { ChecklistEntriesService } from '../checklists/checklist-entries.service';
import { ProgramsService } from '../programs/programs.service';
import { SubstitutionsService } from '../substitutions/substitutions.service';
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
    checklistEntry: {
      findMany: jest.fn((args: unknown) => {
        (calls['checklistEntry.findMany'] ??= []).push(args);
        return Promise.resolve([]);
      }),
      aggregate: jest.fn((args: unknown) => {
        (calls['checklistEntry.aggregate'] ??= []).push(args);
        return Promise.resolve({ _max: { sortOrder: null } });
      }),
      deleteMany: jest.fn((args: unknown) => {
        (calls['checklistEntry.deleteMany'] ??= []).push(args);
        return Promise.resolve({ count: 1 });
      }),
      updateMany: jest.fn((args: unknown) => {
        (calls['checklistEntry.updateMany'] ??= []).push(args);
        return Promise.resolve({ count: 1 });
      }),
    },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
    exercise: {
      findMany: jest.fn((args: unknown) => {
        (calls['exercise.findMany'] ??= []).push(args);
        return Promise.resolve([]);
      }),
      findFirst: record('exercise.findFirst'),
      count: jest.fn((args: unknown) => {
        (calls['exercise.count'] ??= []).push(args);
        return Promise.resolve(0);
      }),
    },
    wod: {
      findMany: jest.fn((args: unknown) => {
        (calls['wod.findMany'] ??= []).push(args);
        return Promise.resolve([]);
      }),
      findUnique: record('wod.findUnique'),
    },
    program: {
      findMany: jest.fn((args: unknown) => {
        (calls['program.findMany'] ??= []).push(args);
        return Promise.resolve([]);
      }),
      findFirst: record('program.findFirst'),
      create: record('program.create'),
    },
    programEnrollment: {
      findFirst: record('programEnrollment.findFirst'),
      updateMany: record('programEnrollment.updateMany'),
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
    for (const where of whereOf(prisma, 'programEnrollment.findFirst')) {
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

  it('scopes the library search, its count and the kit it reads (DN-171)', async () => {
    const prisma = recordingPrisma();
    await new ExercisesService(prisma).search(ALICE, {
      q: 'push',
      muscle: 'chest',
      owned: true,
      page: 1,
    });
    // The muscle filter carries an OR of its own: spread rather than nested,
    // it would replace the ownership one and this would fail.
    for (const where of [
      ...whereOf(prisma, 'exercise.findMany'),
      ...whereOf(prisma, 'exercise.count'),
    ]) {
      expectLibraryScope(where);
    }
    for (const where of whereOf(prisma, 'scheduleRule.findUnique')) {
      expect(where).toContain(ALICE);
    }
  });

  it('scopes the retired list and the detail view to both tiers', async () => {
    // Retired rows are the point of both, so only the ownership half applies.
    const prisma = recordingPrisma();
    const service = new ExercisesService(prisma);
    await service.retired(ALICE);
    await service.findOne(ALICE, 'ex-1').catch(() => undefined);
    for (const where of [
      ...whereOf(prisma, 'exercise.findMany'),
      ...whereOf(prisma, 'exercise.findFirst'),
    ]) {
      expect(where).toContain('"ownerId":null');
      expect(where).toContain(ALICE);
    }
  });

  it("scopes a movement's alternatives and the library they come from (DN-185)", async () => {
    // Answered with a movement, so the read gets past the 404 and into the
    // candidate pool and the fallback lookup -- the reads worth guarding.
    const prisma = recordingPrisma();
    prisma.exercise.findFirst = jest.fn((args: unknown) => {
      (prisma.calls['exercise.findFirst'] ??= []).push(args);
      return Promise.resolve({
        id: 'ex-1',
        movementGroup: 'push_horizontal',
        fallbackExerciseId: 'ex-2',
        primaryMuscles: ['chest'],
        secondaryMuscles: [],
        equipment: [],
      });
    }) as unknown as typeof prisma.exercise.findFirst;
    await new SubstitutionsService(prisma).alternatives(ALICE, 'ex-1');

    for (const where of [
      ...whereOf(prisma, 'exercise.findFirst'),
      ...whereOf(prisma, 'exercise.findMany'),
    ]) {
      expectLibraryScope(where);
    }
    for (const where of whereOf(prisma, 'scheduleRule.findUnique')) {
      expect(where).toContain(ALICE);
    }
  });

  it('scopes the WOD list', async () => {
    const prisma = recordingPrisma();
    await new WodsService(prisma).findAll(ALICE);
    for (const where of whereOf(prisma, 'wod.findMany')) {
      expectLibraryScope(where);
    }
  });

  it('scopes the warm-up/cool-down entries and the exercises they name', async () => {
    // Two rows, two scopes (DN-172). Unscoped, the entry read hands the
    // athlete a list somebody else wrote; the exercise half, somebody else's
    // movement -- or a retired one -- inside a list they did. Asserted apart,
    // because the whole `where` contains both halves' words and would pass
    // with either one missing.
    const prisma = recordingPrisma();
    await new WodsService(prisma).getChecklists(ALICE, 'push');
    for (const json of whereOf(prisma, 'checklistEntry.findMany')) {
      const { exercise, ...entry } = JSON.parse(json) as {
        exercise?: unknown;
      };
      const ownTier = JSON.stringify(entry);
      expect(ownTier).toContain('"ownerId":null');
      expect(ownTier).toContain(ALICE);
      expectLibraryScope(JSON.stringify(exercise ?? {}));
    }
  });

  it("scopes every read and write of the athlete's own checklist entries", async () => {
    // DN-173. Each of these names `ownerId: ALICE` alone -- not the library's
    // two tiers -- because an athlete edits only their own list. A where
    // with `"ownerId":null` in it would let them delete a global entry.
    const prisma = recordingPrisma();
    const entries = new ChecklistEntriesService(prisma);
    await entries.list(ALICE);
    await entries.remove(ALICE, 'entry-1');
    await entries.reorder(ALICE, { kind: 'warmup', entryIds: [] });

    for (const key of [
      'checklistEntry.findMany',
      'checklistEntry.deleteMany',
    ]) {
      for (const where of whereOf(prisma, key)) {
        expect(where).toContain(ALICE);
        expect(where).not.toContain('"ownerId":null');
      }
    }
  });

  it('only lets an athlete put a movement they can see on their list', async () => {
    const prisma = recordingPrisma();
    await new ChecklistEntriesService(prisma)
      .create(ALICE, { exerciseId: 'ex-1', kind: 'warmup', pattern: null })
      .catch(() => undefined);
    for (const where of whereOf(prisma, 'exercise.findFirst')) {
      expectLibraryScope(where);
    }
  });

  it('scopes the candidate WOD pool and the choice lookup behind it', async () => {
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

    for (const where of whereOf(prisma, 'programEnrollment.findFirst')) {
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
        },
      },
    ] as unknown as Parameters<MovementResolutionService['resolve']>[2]);

    const wheres = whereOf(prisma, 'exercise.findMany');
    expect(wheres).toHaveLength(2);
    for (const where of wheres) {
      expectLibraryScope(where);
    }
  });

  it('scopes the movement a skill level is checked against', async () => {
    // Off the library, this would accept any exercise id at all -- including
    // one out of another athlete's private library, which is both a leak and
    // a choice that resolves to nothing on every later read (DN-139).
    const prisma = recordingPrisma();
    await new SkillLevelsService(prisma)
      .setChoice(ALICE, 'push_horizontal', 'some-exercise')
      .catch(() => undefined);
    for (const where of whereOf(prisma, 'exercise.findFirst')) {
      expectLibraryScope(where);
    }
  });

  it('scopes "Your programs" to the caller’s own, not the global programs', async () => {
    // Deliberately *not* the library scope: this list is what the caller
    // wrote. The global half here would show every athlete the curated
    // programs as if they had authored them.
    const prisma = recordingPrisma();
    await new ProgramsService(prisma).listOwn(ALICE);
    for (const where of whereOf(prisma, 'program.findMany')) {
      expect(where).toBe(JSON.stringify({ ownerId: ALICE }));
    }
  });

  it('scopes the program the editor loads and saves to the caller’s own (DN-146)', async () => {
    // The owner's tier alone, as with "Your programs": a global program is not
    // the caller's to edit from this route, and another athlete's is a 404.
    const prisma = recordingPrisma();
    const service = new ProgramsService(prisma);
    await service
      .getForEditing({ ownerId: ALICE }, 'program-1')
      .catch(() => undefined);
    await service
      .update({ ownerId: ALICE }, 'program-1', {
        name: 'Mine',
        summary: null,
        scheduleMode: 'fixed',
        days: [
          {
            dayOfWeek: 1,
            lines: [
              {
                movementGroup: 'pull',
                exerciseId: null,
                sets: 3,
                reps: 5,
                repsMax: null,
                toFailure: false,
                restSeconds: null,
              },
            ],
          },
        ],
      })
      .catch(() => undefined);
    const wheres = whereOf(prisma, 'program.findFirst');
    expect(wheres).toHaveLength(2);
    for (const where of wheres) {
      expect(where).toBe(JSON.stringify({ id: 'program-1', ownerId: ALICE }));
    }
  });

  it('scopes removing and restoring a program to the caller’s own (DN-147)', async () => {
    const prisma = recordingPrisma();
    const service = new ProgramsService(prisma);
    await service
      .archive({ ownerId: ALICE }, 'program-1')
      .catch(() => undefined);
    await service
      .restore({ ownerId: ALICE }, 'program-1')
      .catch(() => undefined);
    const wheres = whereOf(prisma, 'program.findFirst');
    expect(wheres).toHaveLength(2);
    for (const where of wheres) {
      expect(where).toBe(JSON.stringify({ id: 'program-1', ownerId: ALICE }));
    }
  });

  it('publishes only a program the admin owns (DN-148)', async () => {
    // Promote takes a personal row and makes it global; found by id alone it
    // would let an admin publish another athlete's program out from under them.
    const prisma = recordingPrisma();
    await new ProgramsService(prisma)
      .promote(ALICE, 'program-1')
      .catch(() => undefined);
    expect(whereOf(prisma, 'program.findFirst')).toEqual([
      JSON.stringify({ id: 'program-1', ownerId: ALICE }),
    ]);
  });

  it('prefills a copy from a global program only (DN-149)', async () => {
    // The copy route is open to every athlete; found by id alone it would hand
    // one athlete another's personal program.
    const prisma = recordingPrisma();
    await new ProgramsService(prisma)
      .getForCopy('program-1')
      .catch(() => undefined);
    const [where] = whereOf(prisma, 'program.findFirst');
    expect(JSON.parse(where)).toMatchObject({
      AND: [{ ownerId: null }, { id: 'program-1' }],
    });
  });

  it('exports from the global tier only (DN-150)', async () => {
    // The only export there is; reading by id alone would let an admin ship
    // an athlete's personal program out in a file.
    const prisma = recordingPrisma();
    await new ProgramsService(prisma)
      .exportGlobal({ ids: ['program-1'] })
      .catch(() => undefined);
    const [where] = whereOf(prisma, 'program.findMany');
    const { AND } = JSON.parse(where) as { AND: unknown[] };
    expect(AND).toContainEqual({ ownerId: null });
    expect(AND).toContainEqual({ id: { in: ['program-1'] } });
  });

  it('scopes the exercises a program may name, and the name it may not reuse', async () => {
    const prisma = recordingPrisma();
    await new ProgramsService(prisma)
      .create(
        { ownerId: ALICE },
        {
          name: 'Mine',
          summary: null,
          scheduleMode: 'fixed',
          days: [
            {
              dayOfWeek: 1,
              lines: [
                {
                  movementGroup: null,
                  exerciseId: 'ex-1',
                  sets: 3,
                  reps: 5,
                  repsMax: null,
                  toFailure: false,
                  restSeconds: null,
                },
              ],
            },
          ],
        },
      )
      .catch(() => undefined);
    for (const where of whereOf(prisma, 'program.findFirst')) {
      expect(where).toContain(ALICE);
    }
    for (const where of whereOf(prisma, 'exercise.findMany')) {
      expectLibraryScope(where);
    }
  });
});
