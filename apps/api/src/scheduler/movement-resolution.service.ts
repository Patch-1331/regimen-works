import { Injectable } from '@nestjs/common';
import type { Exercise } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  applyEquipmentAvailability,
  applyRememberedChoice,
  applySubstitutions,
} from './scheduler.logic';

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
> = M & { isSwapped: boolean; prescribedName: string | null };

/**
 * What an athlete with no ScheduleRule row owns, mirroring the column default
 * and SettingsService.DEFAULTS (DN-81). Provisioning writes a row on first
 * sign-in, so this is the same belt-and-braces the rest of the scheduler keeps
 * for a user whose row is somehow absent -- and it has to agree with them, or
 * a missing row would quietly cost an athlete their bar movements.
 */
const DEFAULT_EQUIPMENT = ['bar'];

/**
 * Turns a WOD template into what this athlete trains today: each movement's
 * exercise replaced by the one they last chose on that line (Feature #2),
 * then dropped to a substitute where they have no equipment for it (DN-79),
 * then overlaid with the swaps they made for this day (WOD-5).
 *
 * Read-time by design -- `Wod` is shared library content and must not be
 * mutated per user. The one place the result is persisted is the session
 * snapshot (DN-90), which is why this lives in its own service rather than
 * inside the scheduler: the Today plate and session start must agree on it.
 */
@Injectable()
export class MovementResolutionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The substitutes the equipment layer will actually reach for: the alts of
   * the movements this athlete cannot perform, and nothing else.
   *
   * Usually that is none -- the baseline owns the bar and most of the pool is
   * bodyweight -- and then no query runs at all. It cannot join the batch
   * above either way: which movements are unavailable depends on what the
   * remembered choice resolved to, which is not known until that layer has
   * run.
   */
  private async substitutesFor(
    movements: { exercise: Exercise }[],
    owned: ReadonlySet<string>,
  ) {
    const altIds = [
      ...new Set(
        movements
          .filter((m) => !m.exercise.equipment.every((p) => owned.has(p)))
          .map((m) => m.exercise.altExerciseId)
          .filter((id): id is string => id !== null),
      ),
    ];
    if (altIds.length === 0) return new Map<string, Exercise>();

    const alts = await this.prisma.exercise.findMany({
      where: { id: { in: altIds } },
    });
    return new Map(alts.map((e) => [e.id, e]));
  }

  async resolve<M extends { id: string; exercise: Exercise }>(
    userId: string,
    assignmentId: string,
    movements: M[],
  ): Promise<ResolvedMovement<M>[]> {
    const [skillLevels, linedExercises, substitutions, rule] =
      await Promise.all([
        this.prisma.skillLevel.findMany({ where: { userId } }),
        this.prisma.exercise.findMany({ where: { line: { not: null } } }),
        this.prisma.assignmentSubstitution.findMany({
          where: { userId, assignmentId },
          include: { exercise: true },
        }),
        this.prisma.scheduleRule.findUnique({ where: { userId } }),
      ]);

    const chosenRung = new Map(skillLevels.map((s) => [s.line, s.rung]));
    const exerciseAtRung = new Map(
      linedExercises.map((e) => [`${e.line}:${e.rung}`, e]),
    );

    // The remembered choice is what they picked some time ago; the swap is
    // what they want today. Today wins, so it goes on last (WOD-5).
    const remembered = applyRememberedChoice(
      movements,
      chosenRung,
      exerciseAtRung,
    );
    const owned = new Set(rule?.equipment ?? DEFAULT_EQUIPMENT);
    const performable = applyEquipmentAvailability(
      remembered,
      owned,
      await this.substitutesFor(remembered, owned),
    );
    const swapped = applySubstitutions(
      performable,
      new Map(substitutions.map((s) => [s.wodMovementId, s.exerciseId])),
      new Map(substitutions.map((s) => [s.exerciseId, s.exercise])),
    );

    // Flagged rather than inferred: once a swap has been applied there is
    // nothing left in the movement to tell it from a remembered choice, and
    // the plate needs to know which rows the athlete chose themselves.
    const swappedIds = new Set(substitutions.map((s) => s.wodMovementId));

    // What the library actually prescribed, carried only where a remembered
    // choice replaced it (DN-88). The substitution used to happen silently,
    // which is defensible for a swap the athlete just made and much less so
    // for a default applied from weeks ago — so the plate can say what it did.
    //
    // Deliberately null on a row the athlete swapped today: they chose what
    // they see, and naming what they overrode would argue with them.
    const prescribedById = new Map(movements.map((m) => [m.id, m.exercise]));

    return swapped.map((m) => {
      const isSwapped = swappedIds.has(m.id);
      const prescribed = prescribedById.get(m.id);
      return {
        ...m,
        isSwapped,
        prescribedName:
          !isSwapped && prescribed && prescribed.id !== m.exercise.id
            ? prescribed.name
            : null,
      };
    });
  }
}
