import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * A slot's lines with their sets, both in order -- how every reader of a
 * prescription loads it. The sets are rows of their own (ADR 0011), so a
 * read that forgets them gets lines that prescribe nothing.
 */
export const SLOT_MOVEMENTS = {
  orderBy: { order: 'asc' },
  include: { sets: { orderBy: { order: 'asc' } } },
} satisfies Prisma.ProgramSlot$movementsArgs;

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
  programSlotId: string | null,
) {
  if (programSlotId === null) return null;

  const slot = await prisma.programSlot.findUnique({
    where: { id: programSlotId },
    include: { movements: SLOT_MOVEMENTS },
  });
  if (!slot || slot.kind !== 'movements' || slot.movements.length === 0) {
    return null;
  }
  return slot;
}

/** How many working sets a prescribed day comes to, across every movement. */
export function prescribedSetCount(movements: { sets: unknown[] }[]): number {
  return movements.reduce((sum, movement) => sum + movement.sets.length, 0);
}
