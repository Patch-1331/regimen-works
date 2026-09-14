import 'dotenv/config';

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

/**
 * Deterministic history for the Clerk test user, so the browser suite (DN-72)
 * opens on a known History, Stats and progressions panel (DN-58).
 *
 * A seed script rather than per-test setup: DN-72 drives a real running app,
 * where creating a fixture means signing in and calling the API anyway — so
 * per-test setup would pay that cost on every test and still leave the suite
 * ordering-sensitive. The API e2e suite needs none of this; it builds its own
 * rows per test behind the truncate (DN-99).
 *
 * Idempotent, which is the property that matters: every row is keyed on
 * something natural — the user id, the assignment's date, the exercise's name
 * — so running it twice converges rather than stacking. Re-runnable without a
 * reset is what lets it sit in front of a suite that runs repeatedly.
 *
 * It deliberately leaves **today** empty. The first thing DN-72 will want to
 * test is starting a workout, and an assignment already sitting there would
 * take that path away.
 */

/** Days back from today that the test user trained, newest first. */
const TRAINED_DAYS_AGO = [1, 2, 3, 6, 8, 9, 13];

type SeededResult = {
  resultType: string;
  resultValue: string;
  rpe: number | null;
};

/** Cycled over the trained days so Stats has more than one shape to chart. */
const RESULTS: SeededResult[] = [
  { resultType: 'time_seconds', resultValue: '305', rpe: 8 },
  { resultType: 'rounds_reps', resultValue: '12+7', rpe: 7 },
  { resultType: 'time_seconds', resultValue: '288', rpe: 9 },
  { resultType: 'rounds_reps', resultValue: '14+3', rpe: 6 },
];

function isoDaysAgo(today: string, days: number): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Local calendar date, matching how SchedulerController decides "today". */
export function localToday(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export type SeedE2eUserOptions = {
  userId: string;
  /** Defaults to the local calendar date, so the history is always recent. */
  today?: string;
};

export async function seedE2eUser(
  prisma: PrismaClient,
  { userId, today = localToday() }: SeedE2eUserOptions,
): Promise<{ userId: string; today: string; trainedDates: string[] }> {
  // The rows UserProvisioningService would create on a first request. Seeded
  // here too so the history below has something to hang off before the test
  // user has ever signed in.
  await prisma.user.upsert({
    where: { id: userId },
    update: {},
    create: { id: userId },
  });
  await prisma.scheduleRule.upsert({
    where: { userId },
    update: {},
    create: { userId },
  });

  // A standing choice on two lines, so the progressions panel and the
  // remembered-choice substitution both have something to show. Deliberately
  // not all eight: an athlete who has chosen on every line is not what a real
  // one looks like, and DN-86 made "no choice yet" the ordinary case.
  const lines = await pickSeededLines(prisma);
  for (const { line, rung } of lines) {
    await prisma.skillLevel.upsert({
      where: { userId_line: { userId, line } },
      update: { rung },
      create: { userId, line, rung },
    });
  }

  const wods = await prisma.wod.findMany({
    select: { id: true },
    orderBy: { name: 'asc' },
  });
  if (wods.length === 0) {
    throw new Error(
      'seed-e2e-user: no WODs in the database. Run `npm run prisma:seed` first — ' +
        'this seeds one athlete, not the shared catalogue.',
    );
  }

  const trainedDates: string[] = [];
  for (const [index, daysAgo] of TRAINED_DAYS_AGO.entries()) {
    const date = isoDaysAgo(today, daysAgo);
    trainedDates.push(date);

    const wodId = wods[index % wods.length].id;
    const assignment = await prisma.dailyAssignment.upsert({
      where: { userId_date: { userId, date } },
      update: { wodId, status: 'completed' },
      create: { userId, date, wodId, status: 'completed' },
    });

    await prisma.workoutSession.upsert({
      where: { assignmentId: assignment.id },
      update: {},
      create: {
        assignmentId: assignment.id,
        userId,
        capSeconds: 12 * 60,
        status: 'completed',
        finishedAtSeconds: 300 + index * 11,
        startedAt: new Date(`${date}T17:00:00Z`),
      },
    });

    const result = RESULTS[index % RESULTS.length];
    await prisma.workoutLog.upsert({
      where: { assignmentId: assignment.id },
      update: result,
      create: { assignmentId: assignment.id, userId, ...result },
    });
  }

  return { userId, today, trainedDates };
}

/**
 * Two lines that actually have exercises seeded, picked by name so the choice
 * is the same on every run. Hard-coding line names would break the seed the
 * first time the catalogue is reshaped.
 */
async function pickSeededLines(
  prisma: PrismaClient,
): Promise<{ line: string; rung: number }[]> {
  const exercises = await prisma.exercise.findMany({
    where: { line: { not: null } },
    select: { line: true, rung: true },
    orderBy: [{ line: 'asc' }, { rung: 'asc' }],
  });

  const maxRungByLine = new Map<string, number>();
  for (const e of exercises) {
    if (e.line === null || e.rung === null) continue;
    maxRungByLine.set(e.line, Math.max(maxRungByLine.get(e.line) ?? 0, e.rung));
  }

  return [...maxRungByLine.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, 2)
    .map(([line, maxRung]) => ({ line, rung: Math.min(1, maxRung) }));
}

async function main(): Promise<void> {
  const userId = process.env.E2E_USER_ID;
  if (!userId) {
    throw new Error(
      'E2E_USER_ID is not set. It is the Clerk user id of the test user ' +
        '(dashboard.clerk.com > Users, e.g. "user_2ab..."). See the ' +
        '"Browser end-to-end testing" section of the README.',
    );
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
  try {
    const { today, trainedDates } = await seedE2eUser(prisma, { userId });
    console.log(
      `Seeded ${userId}: ${trainedDates.length} completed days, most recent ` +
        `${trainedDates[0]}. Today (${today}) deliberately left empty.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void main();
}
