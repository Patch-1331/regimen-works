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
    wodMovementId: string,
    exerciseId: string,
  ) {
    const movement = await this.loadSwappableMovement(
      userId,
      assignmentId,
      wodMovementId,
    );
    await this.assertLegalTarget(userId, movement, exerciseId);

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
   * what was prescribed and these rows say what was chosen. A swap to an
   * off-ladder alternative (the no-equipment substitute) carries no rung, so
   * there is no position on the line to remember and it proposes nothing.
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
        // Oldest first: `proposeRungChanges` breaks a tie on the same line by
        // taking the choice made most recently (DN-88).
        orderBy: { updatedAt: 'asc' },
      }),
      this.prisma.skillLevel.findMany({ where: { userId } }),
    ]);

    const trained = substitutions
      .filter((s) => s.exercise.line !== null && s.exercise.rung !== null)
      .map((s) => ({
        line: s.exercise.line!,
        rung: s.exercise.rung!,
        exerciseId: s.exercise.id,
        exerciseName: s.exercise.name,
      }));

    return proposeRungChanges(
      trained,
      new Map(skillLevels.map((s) => [s.line, s.rung])),
    );
  }

  /** Puts the movement back to what the program prescribed. */
  async clear(userId: string, assignmentId: string, wodMovementId: string) {
    await this.loadSwappableMovement(userId, assignmentId, wodMovementId);
    await this.prisma.assignmentSubstitution.deleteMany({
      where: { userId, assignmentId, wodMovementId },
    });
  }

  /**
   * Checks the three things a swap needs: the assignment is this user's, the
   * day is still open, and the movement is actually part of that day's WOD.
   *
   * A completed or skipped day is refused because the swap is a statement
   * about what the athlete is *going* to do — rewriting it afterwards would
   * put the record out of step with the session already logged against it.
   */
  private async loadSwappableMovement(
    userId: string,
    assignmentId: string,
    wodMovementId: string,
  ) {
    const assignment = await this.prisma.dailyAssignment.findFirst({
      where: { id: assignmentId, userId },
      select: { id: true, status: true, wodId: true },
    });
    if (!assignment) throw new NotFoundException('Assignment not found');

    if (assignment.status === 'completed' || assignment.status === 'skipped') {
      throw new BadRequestException(
        `Cannot swap a movement on a ${assignment.status} day`,
      );
    }

    const movement = await this.prisma.wodMovement.findFirst({
      where: { id: wodMovementId, wodId: assignment.wodId ?? undefined },
      include: { exercise: true },
    });
    if (!movement) {
      throw new NotFoundException("Movement is not part of today's WOD");
    }
    return movement;
  }

  /**
   * A swap moves along the movement's own ladder, or to its no-equipment
   * alternative. Anything else isn't scaling, it's a different workout —
   * and the reps stay as prescribed, so an unrelated target would leave the
   * athlete with a rep count that means nothing.
   *
   * The alternative is read from every rung on the line, not just the
   * prescribed exercise, because the athlete sees the ladder as it stands
   * after their remembered choice has been applied.
   *
   * Off a line there is no ladder to move along, but the alternative is still
   * a legal target (DN-80): cardio carries `line: null` and an alternative
   * both, and refusing it left an athlete holding a movement they own no
   * equipment for with nowhere to go. Nothing else is legal there — with no
   * line, the alternative is the entire set of movements this one scales to.
   */
  private async assertLegalTarget(
    userId: string,
    movement: {
      exerciseId: string;
      exercise: { line: string | null; altExerciseId: string | null };
    },
    exerciseId: string,
  ) {
    if (exerciseId === movement.exerciseId) return;

    const line = movement.exercise.line;
    if (!line) {
      if (exerciseId === movement.exercise.altExerciseId) return;
      throw new BadRequestException(
        'This movement is not on a progression line, so it can only be swapped for its alternative',
      );
    }

    const onLine = await this.prisma.exercise.findMany({
      where: { ...libraryVisibleTo(userId), line },
      select: { id: true, altExerciseId: true },
    });

    const legal = new Set<string>();
    for (const e of onLine) {
      legal.add(e.id);
      if (e.altExerciseId) legal.add(e.altExerciseId);
    }

    if (!legal.has(exerciseId)) {
      throw new BadRequestException(
        'That exercise is not on this movement’s ladder',
      );
    }
  }
}
