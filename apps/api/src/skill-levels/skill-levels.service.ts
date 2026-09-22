import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { movementGroup, type SkillLevel } from '@regimen-works/shared';
import { PrismaService } from '../prisma/prisma.service';
import { libraryVisibleTo } from '../library/visible-to';

@Injectable()
export class SkillLevelsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(userId: string): Promise<SkillLevel[]> {
    const rows = await this.prisma.skillLevel.findMany({
      where: { userId },
      orderBy: { movementGroup: 'asc' },
    });
    return rows.map(toDto);
  }

  /**
   * Records the athlete's default movement for a group — what the completion
   * screen writes when they accept "make that your pull movement", and what
   * the Stats panel writes when they set one directly.
   *
   * An upsert rather than an update (DN-86). Since provisioning stopped
   * creating a row per group, a first choice has nothing to update, and that
   * first choice is the one most worth keeping — refusing it with a 404 would
   * mean the athlete re-swaps the same movement every session forever.
   *
   * Bounded to a rung that actually has an exercise seeded for this line, so
   * the scheduler substitution (#6) never has to fall back on a missing rung.
   */
  async setRung(
    userId: string,
    group: string,
    rung: number,
  ): Promise<SkillLevel> {
    // An unknown group used to be caught by the row not existing. With the
    // upsert there is nothing to miss, so the group is checked against the
    // enum directly — otherwise a typo would quietly create a row nothing
    // ever reads.
    if (!movementGroup.safeParse(group).success) {
      throw new NotFoundException(`"${group}" is not a movement group`);
    }

    const maxRung = await this.prisma.exercise.aggregate({
      where: { ...libraryVisibleTo(userId), movementGroup: group },
      _max: { rung: true },
    });
    const ceiling = maxRung._max.rung ?? 0;
    if (rung > ceiling) {
      throw new BadRequestException(
        `Movement group "${group}" has no exercise seeded at rung ${rung} (max is ${ceiling})`,
      );
    }

    const saved = await this.prisma.skillLevel.upsert({
      where: { userId_movementGroup: { userId, movementGroup: group } },
      update: { rung },
      create: { userId, movementGroup: group, rung },
    });
    return toDto(saved);
  }
}

function toDto(row: {
  id: string;
  movementGroup: string;
  rung: number;
  updatedAt: Date;
}): SkillLevel {
  return {
    id: row.id,
    movementGroup: row.movementGroup as SkillLevel['movementGroup'],
    rung: row.rung,
    updatedAt: row.updatedAt.toISOString(),
  };
}
