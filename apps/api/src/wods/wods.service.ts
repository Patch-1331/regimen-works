import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { libraryVisibleTo } from '../library/visible-to';
import {
  buildCooldownChecklist,
  buildWarmupChecklist,
} from './checklist.logic';

@Injectable()
export class WodsService {
  constructor(private readonly prisma: PrismaService) {}

  /** The global library plus this athlete's own WODs (DN-93). */
  findAll(userId: string) {
    return this.prisma.wod.findMany({
      where: libraryVisibleTo(userId),
      include: {
        movements: { include: { exercise: true }, orderBy: { order: 'asc' } },
      },
      orderBy: { name: 'asc' },
    });
  }

  /** Warm-up/cool-down checklists for a WOD's dominant pattern (Feature #63). */
  async getChecklists(userId: string, dominantPattern: string) {
    const pool = await this.prisma.exercise.findMany({
      where: { ...libraryVisibleTo(userId), phase: { not: null } },
      select: {
        id: true,
        name: true,
        pattern: true,
        phase: true,
        instructions: true,
      },
    });

    return {
      warmup: buildWarmupChecklist(pool, dominantPattern),
      cooldown: buildCooldownChecklist(pool, dominantPattern),
    };
  }
}
