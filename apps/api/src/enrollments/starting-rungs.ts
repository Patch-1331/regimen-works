import type { Prisma } from '@prisma/client';
import type { RungSnapshot } from '@regimen-works/shared';

/**
 * Where every line the athlete has an opinion about stands right now (DN-18).
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
 * Lines the athlete has never trained are simply absent, and that is the
 * honest shape: `rungChangesOver` reads an absent line as rung 0, and storing
 * a row of zeroes here instead would claim the athlete had answered.
 */
export async function snapshotRungs(
  tx: Pick<Prisma.TransactionClient, 'skillLevel'>,
  userId: string,
): Promise<RungSnapshot> {
  const rows = await tx.skillLevel.findMany({
    where: { userId },
    select: { line: true, rung: true },
  });
  return Object.fromEntries(rows.map((r) => [r.line, r.rung]));
}
