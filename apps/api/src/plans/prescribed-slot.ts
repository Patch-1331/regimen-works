import type { PrismaService } from '../prisma/prisma.service';

/**
 * The `movements` slot behind an assignment, or null where there is none.
 *
 * "Prescribed" is three conditions rather than one, and every caller needs
 * all three: the slot exists, its kind is `movements`, and it actually has
 * movements on it. The last is the one that catches people out -- a
 * `movements` slot authored with nothing on it falls back to a generated WOD
 * in `resolveProgramDay`, so a day like that is a WOD day and treating it as
 * a strength day would hand the athlete an empty session.
 *
 * Read from the slot the assignment already records rather than by resolving
 * the program day again: the assignment is what decided which slot today was,
 * and asking twice is two chances to disagree.
 */
export async function loadPrescribedSlot(
  prisma: PrismaService,
  planSlotId: string | null,
) {
  if (planSlotId === null) return null;

  const slot = await prisma.planSlot.findUnique({
    where: { id: planSlotId },
    include: { movements: { orderBy: { order: 'asc' } } },
  });
  if (!slot || slot.kind !== 'movements' || slot.movements.length === 0) {
    return null;
  }
  return slot;
}

/** How many working sets a prescribed day comes to, across every movement. */
export function prescribedSetCount(movements: { sets: number }[]): number {
  return movements.reduce((sum, movement) => sum + movement.sets, 0);
}
