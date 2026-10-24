import type { PrismaClient } from '@prisma/client';

/**
 * Whether anything has been done on today's workout yet.
 *
 * A session or a log, because those are the two rows that mean training
 * happened. The assignment itself does not count: `getToday` creates one on
 * the first read of the day, so an athlete who opened the app this morning
 * and trained nothing would otherwise be told they cannot start until
 * tomorrow.
 *
 * Shared by setup and by starting a waiting program today (DN-200), the two
 * places a start date of today is judged against `startDateRange`.
 */
export async function todayIsTouched(
  prisma: Pick<PrismaClient, 'dailyAssignment'>,
  userId: string,
  today: string,
): Promise<boolean> {
  const touched = await prisma.dailyAssignment.findFirst({
    where: {
      userId,
      date: today,
      OR: [{ session: { isNot: null } }, { log: { isNot: null } }],
    },
    select: { id: true },
  });
  return touched !== null;
}
