import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { libraryVisibleTo } from '../library/visible-to';
import {
  proposeRungChanges,
  type ProposedRungChange,
} from './rung-changes.logic';

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
   * What this session offers to keep as the athlete's default (WOD-6) — the
   * lines trained at something other than their standing choice.
   *
   * Read from the substitutions rather than from the WOD, because the WOD says
   * what was prescribed and these rows say what was chosen -- which is why a
   * prescribed day's swaps (DN-125) count here on exactly the same terms,
   * with nothing to add: a rung trained is a rung trained. A swap to an
   * fallback (the no-equipment stand-in) is not a group member, so it carries no position and
   * there is no position on the group to remember and it proposes nothing.
   */
  async proposedRungChanges(
    userId: string,
    assignmentId: string,
  ): Promise<ProposedRungChange[]> {
    const assignment = await this.prisma.dailyAssignment.findFirst({
      where: { id: assignmentId, userId },
      select: { id: true },
    });
    if (!assignment) throw new NotFoundException('Assignment not found');

    const [substitutions, skillLevels] = await Promise.all([
      this.prisma.assignmentSubstitution.findMany({
        where: { userId, assignmentId },
        include: { exercise: true },
        // Oldest first: `proposeRungChanges` breaks a tie on the same group by
        // taking the choice made most recently (DN-88).
        orderBy: { updatedAt: 'asc' },
      }),
      this.prisma.skillLevel.findMany({ where: { userId } }),
    ]);

    const trained = substitutions
      .filter(
        (s) => s.exercise.movementGroup !== null && s.exercise.rung !== null,
      )
      .map((s) => ({
        movementGroup: s.exercise.movementGroup!,
        rung: s.exercise.rung!,
        exerciseId: s.exercise.id,
        exerciseName: s.exercise.name,
      }));

    return proposeRungChanges(
      trained,
      new Map(skillLevels.map((s) => [s.movementGroup, s.rung])),
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
      // it named, and which rung the athlete is standing on is resolved per
      // read rather than stored. Null current exercise is right for it -- the
      // legality check then asks only whether the target is in that group.
      return movement.exercise
        ? {
            currentExerciseId: movement.exercise.id,
            movementGroup: movement.exercise.movementGroup,
            fallbackExerciseId: movement.exercise.fallbackExerciseId,
          }
        : {
            currentExerciseId: null,
            movementGroup: movement.movementGroup,
            fallbackExerciseId: null,
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
    };
  }

  /**
   * A swap moves to another member of the movement's group, or to a
   * no-equipment fallback. Anything else isn't scaling, it's a different
   * workout — and the reps stay as prescribed, so an unrelated target would
   * leave the athlete with a rep count that means nothing.
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
   * Outside a group there is nothing to move between, but the fallback is
   * still a legal target (DN-80): cardio carries no group and a fallback
   * both, and refusing it left an athlete holding a movement they own no
   * equipment for with nowhere to go.
   */
  private async assertLegalTarget(
    userId: string,
    movement: SwappableMovement,
    exerciseId: string,
  ) {
    if (exerciseId === movement.currentExerciseId) return;

    const movementGroup = movement.movementGroup;
    if (!movementGroup) {
      if (exerciseId === movement.fallbackExerciseId) return;
      throw new BadRequestException(
        'This movement is not in a movement group, so it can only be swapped for its alternative',
      );
    }

    const inGroup = await this.prisma.exercise.findMany({
      where: { ...libraryVisibleTo(userId), movementGroup },
      select: { id: true, fallbackExerciseId: true },
    });

    const legal = new Set<string>();
    for (const e of inGroup) {
      legal.add(e.id);
      if (e.fallbackExerciseId) legal.add(e.fallbackExerciseId);
    }

    if (!legal.has(exerciseId)) {
      throw new BadRequestException(
        'That exercise is not one this movement can be swapped for',
      );
    }
  }
}

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
};
