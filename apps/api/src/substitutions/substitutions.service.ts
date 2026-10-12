import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Exercise } from '@prisma/client';
import {
  DEFAULT_EQUIPMENT,
  type SwapOption,
  type SwapOptionsResponse,
} from '@regimen-works/shared';
import { PrismaService } from '../prisma/prisma.service';
import { libraryVisibleTo } from '../library/visible-to';
import {
  defaultsByGroup,
  resolveGroupChoice,
  usableChoice,
} from '../plans/group-choice';
import {
  swapCandidatesWhere,
  swapSections,
  type SwapSections,
} from '../scheduler/muscle-match';
import {
  proposeMovementChanges,
  type ProposedMovementChange,
} from './movement-changes.logic';

@Injectable()
export class SubstitutionsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Swaps one movement for this day only. An upsert rather than an insert:
   * swapping twice corrects the choice, it doesn't stack.
   */
  async set(
    userId: string,
    assignmentId: string,
    key: SwapKey,
    exerciseId: string,
  ) {
    const movement = await this.loadSwappableMovement(
      userId,
      assignmentId,
      key,
    );
    await this.assertLegalTarget(userId, movement, exerciseId);

    // Two upserts rather than one write with a variable key, because the two
    // composite uniques are genuinely different indexes and Prisma names them.
    if (key.planSlotMovementId !== null) {
      const planSlotMovementId = key.planSlotMovementId;
      return this.prisma.assignmentSubstitution.upsert({
        where: {
          assignmentId_planSlotMovementId: { assignmentId, planSlotMovementId },
        },
        update: { exerciseId },
        create: { userId, assignmentId, planSlotMovementId, exerciseId },
      });
    }

    const wodMovementId = key.wodMovementId!;
    return this.prisma.assignmentSubstitution.upsert({
      where: {
        assignmentId_wodMovementId: { assignmentId, wodMovementId },
      },
      update: { exerciseId },
      create: { userId, assignmentId, wodMovementId, exerciseId },
    });
  }

  /**
   * The swap panel's options for one movement (DN-170): the whole library,
   * matched by muscle against the movement and split three ways -- see
   * `swapSections`. Each section is capped for display; legality reads them
   * whole, so nothing past the cap is refused, it is only not listed.
   *
   * The hand-written fallback heads the main list where the athlete can
   * perform it: someone chose it for exactly this movement, which no score
   * says better.
   */
  async options(
    userId: string,
    assignmentId: string,
    key: SwapKey,
  ): Promise<SwapOptionsResponse> {
    const movement = await this.loadSwappableMovement(
      userId,
      assignmentId,
      key,
    );
    const { sections, fallbackId } = await this.sectionsFor(userId, movement);
    const shown = (rows: Exercise[]): SwapOption[] =>
      rows.slice(0, SECTION_CAP).map((e) => ({
        exerciseId: e.id,
        name: e.name,
        level: e.level as SwapOption['level'],
        equipment: e.equipment as SwapOption['equipment'],
        isFallback: e.id === fallbackId,
      }));
    return {
      main: shown(sections.main),
      harder: shown(sections.harder),
      needsEquipment: shown(sections.needsEquipment),
    };
  }

  /**
   * What this session offers to keep as the athlete's standing choice (WOD-6)
   * — the groups trained at something other than it.
   *
   * Read from the substitutions rather than from the WOD, because the WOD says
   * what was prescribed and these rows say what was chosen -- which is why a
   * prescribed day's swaps (DN-125) count here on exactly the same terms, with
   * nothing to add: a movement trained is a movement trained. A swap to a
   * fallback (the no-equipment stand-in) is in no group, so there is no group's
   * choice to move and it proposes nothing.
   */
  async proposedMovementChanges(
    userId: string,
    assignmentId: string,
  ): Promise<ProposedMovementChange[]> {
    const assignment = await this.prisma.dailyAssignment.findFirst({
      where: { id: assignmentId, userId },
      select: { id: true },
    });
    if (!assignment) throw new NotFoundException('Assignment not found');

    const [substitutions, skillLevels] = await Promise.all([
      this.prisma.assignmentSubstitution.findMany({
        where: { userId, assignmentId },
        include: { exercise: true },
        // Oldest first: `proposeMovementChanges` breaks a tie on the same group by
        // taking the choice made most recently (DN-88).
        orderBy: { updatedAt: 'asc' },
      }),
      this.prisma.skillLevel.findMany({
        where: { userId },
        include: { exercise: { select: { id: true, name: true } } },
      }),
    ]);

    const trained = substitutions
      .filter((s) => s.exercise.movementGroup !== null)
      .map((s) => ({
        movementGroup: s.exercise.movementGroup!,
        exerciseId: s.exercise.id,
        exerciseName: s.exercise.name,
      }));

    return proposeMovementChanges(
      trained,
      new Map(
        skillLevels.map((s) => [
          s.movementGroup,
          { exerciseId: s.exercise.id, exerciseName: s.exercise.name },
        ]),
      ),
    );
  }

  /** Puts the movement back to what the program prescribed. */
  async clear(userId: string, assignmentId: string, key: SwapKey) {
    await this.loadSwappableMovement(userId, assignmentId, key);
    await this.prisma.assignmentSubstitution.deleteMany({
      where: { userId, assignmentId, ...key },
    });
  }

  /**
   * Checks the three things a swap needs: the assignment is this user's, the
   * day is still open, and the movement is actually part of today's session.
   *
   * A completed or skipped day is refused because the swap is a statement
   * about what the athlete is *going* to do — rewriting it afterwards would
   * put the record out of step with the session already logged against it.
   *
   * Both kinds of day answer the third question the same way, against
   * different columns (DN-125): a WOD movement belongs to the day's `wodId`,
   * and a prescribed movement belongs to the day's `planSlotId`. Either way
   * the row the athlete tapped has to be one this assignment actually holds,
   * or a swap could be written against somebody else's session entirely.
   */
  private async loadSwappableMovement(
    userId: string,
    assignmentId: string,
    key: SwapKey,
  ): Promise<SwappableMovement> {
    const assignment = await this.prisma.dailyAssignment.findFirst({
      where: { id: assignmentId, userId },
      select: { id: true, status: true, wodId: true, planSlotId: true },
    });
    if (!assignment) throw new NotFoundException('Assignment not found');

    if (assignment.status === 'completed' || assignment.status === 'skipped') {
      throw new BadRequestException(
        `Cannot swap a movement on a ${assignment.status} day`,
      );
    }

    if (key.planSlotMovementId !== null) {
      const movement = await this.prisma.planSlotMovement.findFirst({
        where: {
          id: key.planSlotMovementId,
          planSlotId: assignment.planSlotId ?? undefined,
        },
        include: { exercise: true },
      });
      if (!movement) {
        throw new NotFoundException(
          "Movement is not part of today's prescription",
        );
      }
      // A group-prescribed row has no exercise of its own: the group *is* what
      // it named, and which movement the athlete performs in it is resolved
      // per read rather than stored. Null current exercise is right for it -- the
      // legality check then asks only whether the target is in that group.
      return movement.exercise
        ? {
            currentExerciseId: movement.exercise.id,
            movementGroup: movement.exercise.movementGroup,
            fallbackExerciseId: movement.exercise.fallbackExerciseId,
            written: movement.exercise,
            followsChoice: false,
          }
        : {
            currentExerciseId: null,
            movementGroup: movement.movementGroup,
            fallbackExerciseId: null,
            written: null,
            followsChoice: true,
          };
    }

    const movement = await this.prisma.wodMovement.findFirst({
      where: { id: key.wodMovementId!, wodId: assignment.wodId ?? undefined },
      include: { exercise: true },
    });
    if (!movement) {
      throw new NotFoundException("Movement is not part of today's WOD");
    }
    return {
      currentExerciseId: movement.exerciseId,
      movementGroup: movement.exercise.movementGroup,
      fallbackExerciseId: movement.exercise.fallbackExerciseId,
      written: movement.exercise,
      followsChoice: movement.exercise.movementGroup !== null,
    };
  }

  /**
   * A swap moves to another member of the movement's group, to a
   * no-equipment fallback, or to anything the swap panel offers (DN-170).
   * Anything else isn't scaling, it's a different workout -- and the reps stay
   * as prescribed, so an unrelated target would leave the athlete with a rep
   * count that means nothing.
   *
   * Members and their fallbacks are one flat legal set, in both directions
   * and at any distance: the group is unordered, so there is no such thing as
   * a target that is too far. This is the purest statement of the group being
   * an equivalence group rather than a ladder (ADR-0004).
   *
   * The set is read from every member of the group, not just the prescribed
   * exercise, because the athlete sees the group as it stands after their
   * remembered choice has been applied.
   *
   * Outside a group the fallback is still a legal target (DN-80): cardio
   * carries no group and a fallback both, and refusing it left an athlete
   * holding a movement they own no equipment for with nowhere to go.
   *
   * The panel's sections are checked whole rather than as capped, and last,
   * because they cost a library read the group check does not: what the
   * panel offers is legal whether or not it was on screen.
   */
  private async assertLegalTarget(
    userId: string,
    movement: SwappableMovement,
    exerciseId: string,
  ) {
    if (exerciseId === movement.currentExerciseId) return;
    if (exerciseId === movement.fallbackExerciseId) return;

    const movementGroup = movement.movementGroup;
    if (movementGroup) {
      const inGroup = await this.prisma.exercise.findMany({
        where: { ...libraryVisibleTo(userId), movementGroup },
        select: { id: true, fallbackExerciseId: true },
      });
      for (const e of inGroup) {
        if (e.id === exerciseId || e.fallbackExerciseId === exerciseId) return;
      }
    }

    const { anchorId, sections } = await this.sectionsFor(userId, movement);
    const offered = [
      ...sections.main,
      ...sections.harder,
      ...sections.needsEquipment,
    ];
    if (exerciseId === anchorId || offered.some((e) => e.id === exerciseId)) {
      return;
    }

    throw new BadRequestException(
      'That exercise is not one this movement can be swapped for',
    );
  }

  /**
   * The panel's sections for `movement`, uncapped, matched against its
   * anchor -- see `anchorFor`.
   *
   * The candidate query composes the visibility clause and the muscle clause
   * with AND, not a spread: both carry an `OR`, and spreading one over the
   * other would drop the ownership half and read every athlete's exercises
   * (DN-93).
   */
  private async sectionsFor(
    userId: string,
    movement: SwappableMovement,
  ): Promise<{
    anchorId: string | null;
    fallbackId: string | null;
    sections: SwapSections<Exercise>;
  }> {
    const rule = await this.prisma.scheduleRule.findUnique({
      where: { userId },
      select: { equipment: true },
    });
    // No rule is the baseline, not owning nothing -- the scheduler's reading.
    const owned = new Set(rule?.equipment ?? DEFAULT_EQUIPMENT);

    const anchor = await this.anchorFor(userId, movement, owned);
    const empty = { main: [], harder: [], needsEquipment: [] };
    if (!anchor) return { anchorId: null, fallbackId: null, sections: empty };

    const [candidates, fallback] = await Promise.all([
      this.prisma.exercise.findMany({
        where: {
          AND: [libraryVisibleTo(userId), swapCandidatesWhere(anchor)],
        },
      }),
      anchor.fallbackExerciseId === null
        ? null
        : this.prisma.exercise.findFirst({
            where: {
              ...libraryVisibleTo(userId),
              id: anchor.fallbackExerciseId,
              archivedAt: null,
            },
          }),
    ]);

    const sections = swapSections(anchor, candidates, owned);
    if (fallback && fallback.equipment.every((piece) => owned.has(piece))) {
      sections.main = [
        fallback,
        ...sections.main.filter((e) => e.id !== fallback.id),
      ];
      sections.harder = sections.harder.filter((e) => e.id !== fallback.id);
    }
    return {
      anchorId: anchor.id,
      fallbackId: fallback?.id ?? null,
      sections,
    };
  }

  /**
   * What the panel matches against: the movement as the athlete would be
   * handed it before equipment and before today's swap. On a WOD row that is
   * their remembered choice in its group, where they have a usable one, and
   * the movement as written otherwise; on a prescribed row, the slot's own
   * exercise, or the group resolved the way the prescription resolves it.
   *
   * Not the movement on screen: equipment may already have dropped a barbell
   * bench press to push-ups, and the dumbbell press is still the closest
   * thing to what the day asked for. And not today's swap either, so the
   * options hold still while the athlete moves between them.
   */
  private async anchorFor(
    userId: string,
    movement: SwappableMovement,
    owned: ReadonlySet<string>,
  ): Promise<Exercise | null> {
    if (!movement.followsChoice) return movement.written;
    const group = movement.movementGroup;
    if (group === null) return movement.written;

    const [skillLevels, lined] = await Promise.all([
      this.prisma.skillLevel.findMany({ where: { userId } }),
      this.prisma.exercise.findMany({
        where: { ...libraryVisibleTo(userId), movementGroup: { not: null } },
      }),
    ]);
    const chosen = new Map(
      skillLevels.map((s) => [s.movementGroup, s.exerciseId]),
    );
    const byId = new Map(lined.map((e) => [e.id, e]));

    if (movement.written === null) {
      return (
        resolveGroupChoice(
          group,
          chosen,
          byId,
          defaultsByGroup(lined),
          owned,
        ) ?? null
      );
    }
    return usableChoice(group, chosen, byId, owned) ?? movement.written;
  }
}

/** How many of each section the panel lists (DN-170). */
export const SECTION_CAP = 8;

/**
 * Which movement the athlete tapped: exactly one of the two, the same xor the
 * request schema and the CHECK both state (DN-125).
 *
 * Passed around as the pair rather than as a tagged union, because it is also
 * a valid `where` fragment for the substitution row itself — the delete spreads
 * it straight in, and one shape means the two halves cannot disagree.
 */
export type SwapKey = {
  wodMovementId: string | null;
  planSlotMovementId: string | null;
};

/**
 * A movement a swap can be made against, reduced to what legality needs.
 *
 * The two kinds of day flatten to this before anything decides what a legal
 * target is, so the legality rule is written once. `currentExerciseId` is null
 * only for a group-prescribed row, which names a group and no exercise at all.
 */
type SwappableMovement = {
  currentExerciseId: string | null;
  movementGroup: string | null;
  fallbackExerciseId: string | null;
  /** The exercise the row names, or null on a group-prescribed row. */
  written: Exercise | null;
  /** Whether the athlete's remembered choice in the group stands in for it. */
  followsChoice: boolean;
};
