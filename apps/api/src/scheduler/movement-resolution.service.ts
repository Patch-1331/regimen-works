import { Injectable } from '@nestjs/common';
import { DEFAULT_EQUIPMENT } from '@regimen-works/shared';
import type { SubstitutionReason } from '@regimen-works/shared';
import type { Exercise } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { libraryVisibleTo } from '../library/visible-to';
import { attachPrescribedExercises } from '../plans/prescription';
import type { ProgramSlotMovement } from '../plans/program-day';
import {
  applyEquipmentAvailability,
  applyRememberedChoice,
  applySubstitutions,
  unperformableSubstituteIds,
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
> = M & {
  isSwapped: boolean;
  /**
   * What the library prescribed, wherever an automatic layer replaced it --
   * including on a row the athlete then swapped (DN-116). Callers rendering
   * this to the athlete hide it on a swapped row; callers recording it keep
   * it.
   */
  prescribedName: string | null;
  /** The prescribed exercise's id, so the screen can offer it back (DN-110). */
  prescribedId: string | null;
  prescribedReason: SubstitutionReason | null;
};

/**
 * The resolved list as the athlete should *see* it (DN-116).
 *
 * A swap is today's tap, and the plate does not tell someone what they just
 * overrode. The fact stays in the resolver's own output, where the session
 * snapshot reads it — one resolution, two audiences.
 */
export function hideOverriddenPrescriptions<
  M extends {
    isSwapped: boolean;
    prescribedName: string | null;
    prescribedId: string | null;
    prescribedReason: SubstitutionReason | null;
  },
>(movements: M[]): M[] {
  return movements.map((m) =>
    m.isSwapped
      ? {
          ...m,
          prescribedName: null,
          prescribedId: null,
          prescribedReason: null,
        }
      : m,
  );
}

/**
 * Turns a WOD template into what this athlete trains today: each movement's
 * exercise replaced by the one they last chose in that group (Feature #2),
 * then dropped to its alternative where they own no equipment for it
 * (DN-79), then overlaid with the swaps they made for this day (WOD-5).
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
    const [skillLevels, linedExercises, substitutions, rule] =
      await Promise.all([
        this.prisma.skillLevel.findMany({ where: { userId } }),
        this.prisma.exercise.findMany({
          where: { ...libraryVisibleTo(userId), movementGroup: { not: null } },
        }),
        this.prisma.assignmentSubstitution.findMany({
          // A day is a WOD or a prescription, never both, so in practice this
          // filter drops nothing -- it is here to make the non-null assertions
          // below true by construction rather than by that argument (DN-125).
          where: { userId, assignmentId, wodMovementId: { not: null } },
          include: { exercise: true },
        }),
        this.prisma.scheduleRule.findUnique({
          where: { userId },
          select: { equipment: true },
        }),
      ]);

    const chosenRung = new Map(
      skillLevels.map((s) => [s.movementGroup, s.rung]),
    );
    const exerciseAtRung = new Map(
      linedExercises.map((e) => [`${e.movementGroup}:${e.rung}`, e]),
    );

    // The remembered choice is what they picked some time ago; the swap is
    // what they want today. Today wins, so it goes on last (WOD-5).
    const remembered = applyRememberedChoice(
      movements,
      chosenRung,
      exerciseAtRung,
    );
    // Equipment sits between the two: after the choice, because the choice
    // itself can land on a bar movement; before the swap, because an athlete
    // who taps into a movement has overruled what they own (DN-79).
    //
    // An athlete with no rule row reads as the baseline rather than as owning
    // nothing -- read the other way, a missing row would quietly cost them
    // every bar movement in the library.
    const available = await this.applyOwnership(
      userId,
      remembered,
      rule?.equipment ?? DEFAULT_EQUIPMENT,
    );
    const swapped = applySubstitutions(
      available,
      new Map(substitutions.map((s) => [s.wodMovementId!, s.exerciseId])),
      new Map(substitutions.map((s) => [s.exerciseId, s.exercise])),
    );

    // Flagged rather than inferred: once a swap has been applied there is
    // nothing left in the movement to tell it from a remembered choice, and
    // the plate needs to know which rows the athlete chose themselves.
    const swappedIds = new Set(substitutions.map((s) => s.wodMovementId!));

    // What the library prescribed and which layer replaced it (DN-88, DN-79),
    // carried wherever an automatic layer did. The substitution used to happen
    // silently, which is defensible for a swap the athlete just made and much
    // less so for a default applied from weeks ago, or for a piece of gear
    // they told the app about once — so the plate can say what it did and why.
    //
    // Recorded on a row the athlete swapped, too (DN-116). The plate stays
    // silent there — naming what a swap overrode would argue with a decision
    // just made — but that silence is a *rendering* decision, and it belongs
    // where the payload is built rather than here. Equipment resolution runs
    // before the swap, so nulling it at the source lost the fallback
    // underneath on every day both moved the same row, and a session snapshot
    // (DN-90) is written once: what it fails to record is gone.
    const replacements = describeReplacements(movements, remembered, available);

    return swapped.map((m) => {
      const replacement = replacements.get(m.id);
      return {
        ...m,
        isSwapped: swappedIds.has(m.id),
        prescribedName: replacement?.name ?? null,
        prescribedId: replacement?.id ?? null,
        prescribedReason: replacement?.reason ?? null,
      };
    });
  }

  /**
   * Turns what a program prescribed into what this athlete performs today
   * (DN-19): the group resolved to their rung, then dropped to its alternative
   * where they own nothing for it.
   *
   * `resolve`'s three layers, differing in what the first one means. The
   * remembered choice *is* the rung here rather than an override of it, so
   * nothing is reported as a substitution for it -- a program that asks for
   * "pull" and hands over a ring row has done exactly what it said. Only
   * equipment replaced something the athlete was told about, so only equipment
   * is named. Then the day's swap on top, the same way and for the same
   * reason: the app decides what you do, you decide how hard it is (DN-125).
   *
   * `assignmentId` is null where the day has no row yet -- `getToday` resolves
   * the prescription before writing one, because an empty result is a day to
   * generate a WOD for instead. Nothing is lost by it: a swap is made against
   * a day already on screen, so a day with no row has none.
   *
   * Returns fewer rows than it was given where the library cannot answer, and
   * possibly none -- see `attachPrescribedExercises`. The caller treats an
   * empty result as a day with nothing prescribed.
   */
  async resolvePrescription(
    userId: string,
    assignmentId: string | null,
    movements: ProgramSlotMovement[],
  ) {
    // Typed rather than inferred, because the empty case is a literal and the
    // query's own row type is what the map below reads.
    const swapsQuery: Promise<
      { planSlotMovementId: string | null; exercise: Exercise }[]
    > =
      assignmentId === null
        ? Promise.resolve([])
        : this.prisma.assignmentSubstitution.findMany({
            where: { userId, assignmentId, planSlotMovementId: { not: null } },
            include: { exercise: true },
          });

    const [skillLevels, linedExercises, pinned, rule, substitutions] =
      await Promise.all([
        this.prisma.skillLevel.findMany({ where: { userId } }),
        this.prisma.exercise.findMany({
          where: { ...libraryVisibleTo(userId), movementGroup: { not: null } },
        }),
        this.prisma.exercise.findMany({
          where: {
            ...libraryVisibleTo(userId),
            id: {
              in: movements
                .map((m) => m.exerciseId)
                .filter((id): id is string => id !== null),
            },
          },
        }),
        this.prisma.scheduleRule.findUnique({
          where: { userId },
          select: { equipment: true },
        }),
        swapsQuery,
      ]);

    const prescribed = attachPrescribedExercises(
      movements,
      new Map(skillLevels.map((s) => [s.movementGroup, s.rung])),
      new Map(linedExercises.map((e) => [`${e.movementGroup}:${e.rung}`, e])),
      new Map(pinned.map((e) => [e.id, e])),
    );

    // Same missing-rule reading as `resolve`: no row is the baseline, not
    // owning nothing.
    const available = await this.applyOwnership(
      userId,
      prescribed,
      rule?.equipment ?? DEFAULT_EQUIPMENT,
    );

    // Last, the same as on a WOD day: the rung and the equipment fallback are
    // both standing facts about the athlete, and the swap is what they want
    // this morning.
    const swaps = new Map(
      substitutions.map((s): [string, Exercise] => [
        s.planSlotMovementId!,
        s.exercise,
      ]),
    );

    return available.map((m, i) => {
      const swap = swaps.get(m.movement.id);
      const replaced = m.exercise.id !== prescribed[i].exercise.id;
      return {
        id: m.movement.id,
        order: m.movement.order,
        sets: m.movement.sets,
        reps: m.movement.reps,
        restSeconds: m.movement.restSeconds,
        // What the *program* asked for, kept even where equipment moved the
        // athlete off it: the group is the session's intent, and a screen that
        // showed only the substitute could not say what the day was for.
        movementGroup: m.movement.movementGroup,
        exercise: swap ?? m.exercise,
        isSwapped: swap !== undefined,
        // Recorded on a swapped row too, and hidden by the caller through
        // `hideOverriddenPrescriptions` -- one rule for both kinds of day, and
        // the reasoning is in that function.
        prescribedName: replaced ? prescribed[i].exercise.name : null,
        prescribedId: replaced ? prescribed[i].exercise.id : null,
        prescribedReason: replaced ? ('equipment' as const) : null,
      };
    });
  }

  /**
   * Drops every movement the athlete owns no equipment for to its
   * alternative.
   *
   * Its own read rather than part of the batch above, because *which*
   * substitutes are wanted depends on what the choice layer resolved to —
   * a rung the athlete last picked can need a bar the prescription did not.
   * Only the rows actually reached for are loaded, so the common day (the
   * baseline owns the bar, most of the pool needs nothing) runs no second
   * query at all.
   */
  private async applyOwnership<M extends { exercise: Exercise }>(
    userId: string,
    movements: M[],
    equipment: readonly string[],
  ): Promise<M[]> {
    const owned = new Set(equipment);
    const substituteIds = unperformableSubstituteIds(movements, owned);
    if (substituteIds.length === 0) return movements;

    const substitutes = await this.prisma.exercise.findMany({
      where: { ...libraryVisibleTo(userId), id: { in: substituteIds } },
    });

    return applyEquipmentAvailability(
      movements,
      owned,
      new Map(substitutes.map((e) => [e.id, e])),
    );
  }
}

/**
 * For each movement an automatic layer replaced: what the library prescribed,
 * and which layer did it.
 *
 * Read off the three stages rather than inferred from the final exercise,
 * because the end state cannot tell them apart — a remembered choice and an
 * equipment fallback both leave a movement the library did not prescribe, and
 * the screen says different words for them.
 *
 * Equipment wins where both moved a row, because it is the later word and the
 * one the athlete is looking at: their standing choice landed on a bar they do
 * not own, and "your pick" would be a strange thing to call what replaced it.
 * Every layer maps its input one-for-one, so the three arrays line up by index.
 */
function describeReplacements<
  M extends { id: string; exercise: { id: string; name: string } },
>(
  prescribed: M[],
  remembered: M[],
  available: M[],
): Map<string, { id: string; name: string; reason: SubstitutionReason }> {
  const replacements = new Map<
    string,
    { id: string; name: string; reason: SubstitutionReason }
  >();
  prescribed.forEach((m, i) => {
    const reason: SubstitutionReason | null =
      available[i].exercise.id !== remembered[i].exercise.id
        ? 'equipment'
        : remembered[i].exercise.id !== m.exercise.id
          ? 'remembered_choice'
          : null;
    if (reason)
      replacements.set(m.id, {
        id: m.exercise.id,
        name: m.exercise.name,
        reason,
      });
  });
  return replacements;
}
