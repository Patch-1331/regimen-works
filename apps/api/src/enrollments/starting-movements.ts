import type { Prisma } from '@prisma/client';
import type { MovementSnapshot } from '@regimen-works/shared';

/**
 * Which movement the athlete performs in every group they have an opinion
 * about, right now (DN-18).
 *
 * Taken when a run starts, because `SkillLevel` keeps only the current value:
 * without this a finished program can count its sessions but cannot say what
 * moved, which is the half of the completion card worth reading.
 *
 * Shared by every path that starts a run -- the wizard's commit and "run it
 * again" -- rather than written at each. A run enrolled without a snapshot is
 * not broken today and reports nothing months later, which is the kind of
 * omission that is invisible exactly until it matters.
 *
 * Groups the athlete has never chosen in are simply absent, and that is the
 * honest shape: `movementChangesOver` reports a group they arrived with no
 * choice in as a change from nothing, which is what happened. Filling the gap
 * with the group's default (DN-139) would instead claim they had answered.
 */
export async function snapshotMovements(
  tx: Pick<Prisma.TransactionClient, 'skillLevel'>,
  userId: string,
): Promise<MovementSnapshot> {
  const rows = await tx.skillLevel.findMany({
    where: { userId },
    select: { movementGroup: true, exerciseId: true },
  });
  return Object.fromEntries(rows.map((r) => [r.movementGroup, r.exerciseId]));
}
