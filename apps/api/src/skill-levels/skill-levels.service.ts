import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { movementGroup, type SkillLevel } from '@regimen-works/shared';
import { PrismaService } from '../prisma/prisma.service';
import { libraryVisibleTo } from '../library/visible-to';

/** What `toDto` needs: the row plus the movement it points at. */
const withExercise = { exercise: { select: { name: true } } } as const;

@Injectable()
export class SkillLevelsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(userId: string): Promise<SkillLevel[]> {
    const rows = await this.prisma.skillLevel.findMany({
      where: { userId },
      orderBy: { movementGroup: 'asc' },
      include: withExercise,
    });
    return rows.map(toDto);
  }

  /**
   * Records the athlete's standing choice of movement for a group — what the
   * completion screen writes when they accept "make that your pull movement",
   * and what the Stats panel writes when they set one directly.
   *
   * An upsert rather than an update (DN-86). Since provisioning stopped
   * creating a row per group, a first choice has nothing to update, and that
   * first choice is the one most worth keeping — refusing it with a 404 would
   * mean the athlete re-swaps the same movement every session forever.
   *
   * The movement has to exist, be visible to this caller, and belong to the
   * group in the path. That triple replaces the old rung ceiling (DN-139),
   * which only ever asked "is this number in range" — and answered it against
   * a list that could be reordered under it.
   */
  async setChoice(
    userId: string,
    group: string,
    exerciseId: string,
  ): Promise<SkillLevel> {
    // An unknown group used to be caught by the row not existing. With the
    // upsert there is nothing to miss, so the group is checked against the
    // enum directly — otherwise a typo would quietly create a row nothing
    // ever reads.
    if (!movementGroup.safeParse(group).success) {
      throw new NotFoundException(`"${group}" is not a movement group`);
    }

    // Visibility is folded into the lookup rather than checked after it: a
    // 404 for someone else's private movement and a 404 for a movement that
    // does not exist are the same answer, which is the point.
    const exercise = await this.prisma.exercise.findFirst({
      where: { ...libraryVisibleTo(userId), id: exerciseId },
      select: { id: true, name: true, movementGroup: true },
    });
    if (exercise === null) {
      throw new NotFoundException(`No exercise ${exerciseId}`);
    }
    if (exercise.movementGroup !== group) {
      throw new BadRequestException(
        `"${exercise.name}" is not in movement group "${group}"`,
      );
    }

    const saved = await this.prisma.skillLevel.upsert({
      where: { userId_movementGroup: { userId, movementGroup: group } },
      update: { exerciseId },
      create: { userId, movementGroup: group, exerciseId },
      include: withExercise,
    });
    return toDto(saved);
  }
}

function toDto(row: {
  id: string;
  movementGroup: string;
  exerciseId: string;
  exercise: { name: string };
  updatedAt: Date;
}): SkillLevel {
  return {
    id: row.id,
    movementGroup: row.movementGroup as SkillLevel['movementGroup'],
    exerciseId: row.exerciseId,
    exerciseName: row.exercise.name,
    updatedAt: row.updatedAt.toISOString(),
  };
}
