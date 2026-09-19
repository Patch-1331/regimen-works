import type { PrismaClient } from '@prisma/client';
import type { ActiveProgram } from './program-day';

/**
 * The athlete's active enrollment, flattened to what deciding anything about
 * their schedule needs.
 *
 * One definition rather than one per caller (DN-118). `getToday` asks it what
 * today is and `GET /settings` asks it whether the athlete's own days are
 * currently in effect; those are different questions about the same row, and
 * two copies of this include tree would be two chances to disagree about
 * which enrollment is the live one.
 *
 * Null is ordinary and not an error: DN-13 enrolls every athlete in Just WODs
 * at provisioning, but an athlete who has just finished a program has none
 * until a later request re-enrolls them, and every caller has to render their
 * week either way.
 */
export async function loadActiveProgram(
  // The real client type rather than a hand-written shape, so a field renamed
  // on the model is a compile error here instead of a silently missing one.
  prisma: Pick<PrismaClient, 'planEnrollment'>,
  userId: string,
): Promise<ActiveProgram | null> {
  const enrollment = await prisma.planEnrollment.findFirst({
    where: { userId, status: 'active' },
    include: {
      plan: {
        include: {
          weeks: {
            orderBy: { order: 'asc' },
            include: {
              slots: {
                orderBy: { dayOfWeek: 'asc' },
                // The prescription a `movements` day carries (DN-19). Loaded
                // with the slots rather than on demand: the day is decided
                // before anyone knows which kind it turned out to be, and a
                // second round trip to find out would be one per request for
                // the one program in ten that uses them.
                include: { movements: { orderBy: { order: 'asc' } } },
              },
            },
          },
        },
      },
    },
  });
  if (!enrollment) return null;

  return {
    enrollmentId: enrollment.id,
    planId: enrollment.planId,
    planName: enrollment.plan.name,
    scheduleMode: enrollment.plan.scheduleMode,
    startDate: enrollment.startDate,
    weeks: enrollment.weeks,
    authoredWeeks: enrollment.plan.weeks,
  };
}
