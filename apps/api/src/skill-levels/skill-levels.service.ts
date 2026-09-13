import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { progressionLine, type SkillLevel } from '@regimen-works/shared';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SkillLevelsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(userId: string): Promise<SkillLevel[]> {
    const rows = await this.prisma.skillLevel.findMany({
      where: { userId },
      orderBy: { line: 'asc' },
    });
    return rows.map(toDto);
  }

  /**
   * Records the athlete's default movement for a line — what the completion
   * screen writes when they accept "make that your pull movement", and what
   * the Stats panel writes when they set one directly.
   *
   * An upsert rather than an update (DN-86). Since provisioning stopped
   * creating a row per line, a first choice has nothing to update, and that
   * first choice is the one most worth keeping — refusing it with a 404 would
   * mean the athlete re-swaps the same movement every session forever.
   *
   * Bounded to a rung that actually has an exercise seeded for this line, so
   * the scheduler substitution (#6) never has to fall back on a missing rung.
   */
  async setRung(
    userId: string,
    line: string,
    rung: number,
  ): Promise<SkillLevel> {
    // An unknown line used to be caught by the row not existing. With the
    // upsert there is nothing to miss, so the line is checked against the
    // enum directly — otherwise a typo would quietly create a row nothing
    // ever reads.
    if (!progressionLine.safeParse(line).success) {
      throw new NotFoundException(`"${line}" is not a progression line`);
    }

    const maxRung = await this.prisma.exercise.aggregate({
      where: { line },
      _max: { rung: true },
    });
    const ceiling = maxRung._max.rung ?? 0;
    if (rung > ceiling) {
      throw new BadRequestException(
        `Line "${line}" has no exercise seeded at rung ${rung} (max is ${ceiling})`,
      );
    }

    // Clears lastChange — a choice the athlete made isn't the automatic rule's
    // achievement to celebrate on the Stats "level up" banner (#10).
    const saved = await this.prisma.skillLevel.upsert({
      where: { userId_line: { userId, line } },
      update: { rung, lastChange: null },
      create: { userId, line, rung },
    });
    return toDto(saved);
  }
}

function toDto(row: {
  id: string;
  line: string;
  rung: number;
  updatedAt: Date;
  lastChange: string | null;
}): SkillLevel {
  return {
    id: row.id,
    line: row.line as SkillLevel['line'],
    rung: row.rung,
    updatedAt: row.updatedAt.toISOString(),
    lastChange: row.lastChange as SkillLevel['lastChange'],
  };
}
