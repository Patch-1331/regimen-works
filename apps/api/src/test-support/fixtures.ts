import { testPrisma } from './database';

/**
 * Row factories for the DB suites.
 *
 * Each writes a valid row and merges overrides on top, so a test names only
 * the fields it is about. They build their own rows rather than leaning on
 * `prisma/seed.ts`: the seeded WOD library is a fixture nobody chose for the
 * test at hand, and a test that passes because of what the seed happens to
 * contain breaks when the seed changes for unrelated reasons.
 */

let sequence = 0;
/** Unique-per-run suffix for the columns the schema marks `@unique`. */
function unique(prefix: string): string {
  sequence += 1;
  return `${prefix}-${sequence}`;
}

export async function createUser(id = unique('user')) {
  return testPrisma().user.create({ data: { id } });
}

export async function createExercise(overrides: Record<string, unknown> = {}) {
  return testPrisma().exercise.create({
    data: {
      name: unique('Push-up'),
      pattern: 'push',
      unit: 'reps',
      line: 'push_horizontal',
      rung: 0,
      ...overrides,
    },
  });
}

/**
 * A WOD with one movement on it. Pass `movements` to shape them yourself;
 * anything nested is created in one call so a test never has to order the
 * writes itself.
 */
export async function createWod(overrides: Record<string, unknown> = {}) {
  const { movements, ...wod } = overrides as {
    movements?: {
      exerciseId: string;
      reps: number;
      order: number;
      repScheme?: number[];
    }[];
  } & Record<string, unknown>;

  const resolved = movements ?? [
    { exerciseId: (await createExercise()).id, reps: 45, order: 0 },
  ];

  return testPrisma().wod.create({
    data: {
      name: unique('Fran'),
      type: 'for_time',
      timeCapMinutes: 12,
      rounds: 3,
      dominantPattern: 'push',
      ...wod,
      movements: { create: resolved },
    },
    include: { movements: { include: { exercise: true } } },
  });
}

export async function createAssignment(
  userId: string,
  overrides: Record<string, unknown> = {},
) {
  const wodId =
    (overrides.wodId as string | undefined) ?? (await createWod()).id;
  return testPrisma().dailyAssignment.create({
    data: {
      userId,
      date: '2026-09-16',
      status: 'scheduled',
      ...overrides,
      wodId,
    },
  });
}

export async function createSession(
  userId: string,
  assignmentId: string,
  overrides: Record<string, unknown> = {},
) {
  return testPrisma().workoutSession.create({
    data: { userId, assignmentId, capSeconds: 720, ...overrides },
  });
}

export async function createLog(
  userId: string,
  assignmentId: string,
  overrides: Record<string, unknown> = {},
) {
  return testPrisma().workoutLog.create({
    data: {
      userId,
      assignmentId,
      resultType: 'time_seconds',
      resultValue: '305',
      ...overrides,
    },
  });
}

export async function createSkillLevel(
  userId: string,
  line: string,
  rung: number,
) {
  return testPrisma().skillLevel.create({ data: { userId, line, rung } });
}

/**
 * A progression line as the athlete sees it: rungs 0..n-1 of one line, each
 * with an optional no-equipment alternative off the line entirely.
 */
export async function createLadder(
  line: string,
  names: string[],
  options: { altFor?: number } = {},
) {
  const alt =
    options.altFor === undefined
      ? null
      : await createExercise({
          name: unique('Row under table'),
          line: null,
          rung: null,
        });

  const rungs: Awaited<ReturnType<typeof createExercise>>[] = [];
  for (const [index, name] of names.entries()) {
    rungs.push(
      await createExercise({
        name: unique(name),
        line,
        rung: index,
        altExerciseId: index === options.altFor ? alt!.id : null,
      }),
    );
  }
  return { rungs, alt };
}
