import { Injectable } from '@nestjs/common';
import type { Exercise } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { applyCurrentRung, applySubstitutions } from './scheduler.logic';

/** The shape every resolver caller loads a WOD's movements in. */
export const resolvableMovementInclude = {
  movements: {
    include: { exercise: true },
    orderBy: { order: 'asc' as const },
  },
};

export type ResolvedMovement<
  M extends { id: string; exercise: Exercise } = {
    id: string;
    exercise: Exercise;
  },
> = M & { isSwapped: boolean };

/**
 * Turns a WOD template into what this athlete trains today: each movement's
 * exercise replaced by the one at their current rung on that line (Feature
 * #2), then overlaid with the swaps they made for this day (WOD-5).
 *
 * Read-time by design -- `Wod` is shared library content and must not be
 * mutated per user. The one place the result is persisted is the session
 * snapshot (DN-90), which is why this lives in its own service rather than
 * inside the scheduler: the Today plate and session start must agree on it.
 */
@Injectable()
export class MovementResolutionService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve<M extends { id: string; exercise: Exercise }>(
    userId: string,
    assignmentId: string,
    movements: M[],
  ): Promise<ResolvedMovement<M>[]> {
    const [skillLevels, linedExercises, substitutions] = await Promise.all([
      this.prisma.skillLevel.findMany({ where: { userId } }),
      this.prisma.exercise.findMany({ where: { line: { not: null } } }),
      this.prisma.assignmentSubstitution.findMany({
        where: { userId, assignmentId },
        include: { exercise: true },
      }),
    ]);

    const currentRung = new Map(skillLevels.map((s) => [s.line, s.rung]));
    const exerciseAtRung = new Map(
      linedExercises.map((e) => [`${e.line}:${e.rung}`, e]),
    );

    // The rung is what the app assigned; the swap is what the athlete chose.
    // The athlete wins, so their layer goes on last (WOD-5).
    const atRung = applyCurrentRung(movements, currentRung, exerciseAtRung);
    const swapped = applySubstitutions(
      atRung,
      new Map(substitutions.map((s) => [s.wodMovementId, s.exerciseId])),
      new Map(substitutions.map((s) => [s.exerciseId, s.exercise])),
    );

    // Flagged rather than inferred: once a swap has been applied there is
    // nothing left in the movement to tell it from a plain rung scaling, and
    // the plate needs to know which rows the athlete chose themselves.
    const swappedIds = new Set(substitutions.map((s) => s.wodMovementId));

    return swapped.map((m) => ({ ...m, isSwapped: swappedIds.has(m.id) }));
  }
}
