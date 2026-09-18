import { Injectable } from '@nestjs/common';
import type { Exercise } from '@prisma/client';
import {
  DEFAULT_EQUIPMENT,
  DEFAULT_TRAINING_DAYS,
} from '@regimen-works/shared';
import { PrismaService } from '../prisma/prisma.service';
import { libraryVisibleTo } from '../library/visible-to';
import { toSessionDto } from '../sessions/session.mapper';
import { WodsService } from '../wods/wods.service';
import {
  hideOverriddenPrescriptions,
  MovementResolutionService,
  resolvableMovementInclude,
  type ResolvedMovement,
} from './movement-resolution.service';
import {
  applyEquipmentFloor,
  applyRememberedChoice,
  dominantMovement,
  isRestDay,
  pickWod,
  RecentAssignment,
} from './scheduler.logic';

const wodInclude = resolvableMovementInclude;

@Injectable()
export class SchedulerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wodsService: WodsService,
    private readonly resolution: MovementResolutionService,
  ) {}

  /** Returns today's assignment, generating one if the day hasn't been decided yet. */
  async getToday(userId: string, today: string) {
    const rule = await this.prisma.scheduleRule.findUnique({
      where: { userId },
    });
    const warmupCooldownEnabled = rule?.warmupCooldownEnabled ?? false;

    const existing = await this.prisma.dailyAssignment.findUnique({
      where: { userId_date: { userId, date: today } },
      include: { wod: { include: wodInclude }, session: true },
    });

    if (existing) {
      const assignment =
        existing.status === 'skipped' || !existing.wod
          ? null
          : {
              id: existing.id,
              date: existing.date,
              status: existing.status,
              wod: await this.resolveWodForToday(
                userId,
                existing.id,
                existing.wod,
              ),
              session: existing.session ? toSessionDto(existing.session) : null,
            };

      return {
        date: today,
        isRestDay: existing.status === 'skipped',
        assignment,
        warmupCooldownEnabled,
        ...(await this.getChecklistsFor(
          userId,
          warmupCooldownEnabled,
          assignment?.wod.dominantPattern,
        )),
      };
    }

    // The week-so-far count this used to run went with the quota: once the
    // rest-day check is a weekday lookup, nothing reads the number, and a
    // query whose answer is discarded is how dead code starts. DN-17 wants a
    // count of this shape back for makeup days, with a different meaning.
    const trainingDays = rule?.trainingDays ?? [...DEFAULT_TRAINING_DAYS];
    const cooldownDays = rule?.patternCooldownDays ?? 5;

    if (isRestDay(today, trainingDays)) {
      return {
        date: today,
        isRestDay: true,
        assignment: null,
        warmupCooldownEnabled,
        warmup: null,
        cooldown: null,
      };
    }

    const wod = await this.generateWodForDate(
      userId,
      today,
      cooldownDays,
      rule?.equipment ?? [...DEFAULT_EQUIPMENT],
    );

    const created = await this.prisma.dailyAssignment.create({
      data: { userId, date: today, wodId: wod.id, status: 'scheduled' },
      include: { wod: { include: wodInclude } },
    });

    const scaledWod = await this.resolveWodForToday(
      userId,
      created.id,
      created.wod!,
    );

    return {
      date: today,
      isRestDay: false,
      assignment: {
        id: created.id,
        date: created.date,
        status: created.status,
        // wodId was just set from a freshly-picked candidate, so the relation is present.
        wod: scaledWod,
        session: null,
      },
      warmupCooldownEnabled,
      ...(await this.getChecklistsFor(
        userId,
        warmupCooldownEnabled,
        scaledWod.dominantPattern,
      )),
    };
  }

  /** Null lists when the setting is off or there's no WOD to build a checklist for. */
  private async getChecklistsFor(
    userId: string,
    warmupCooldownEnabled: boolean,
    dominantPattern: string | undefined,
  ) {
    if (!warmupCooldownEnabled || !dominantPattern) {
      return { warmup: null, cooldown: null };
    }
    return this.wodsService.getChecklists(userId, dominantPattern);
  }

  /**
   * The WOD as this athlete trains it today -- their remembered choice per
   * line, then the day's swaps. See MovementResolutionService.
   * Resolved here at read time rather than stored on the assignment, because
   * `Wod` is shared library content; the session snapshot (DN-90) is where
   * the result is finally pinned down.
   */
  private async resolveWodForToday<
    W extends { movements: { id: string; exercise: Exercise }[] },
  >(
    userId: string,
    assignmentId: string,
    wod: W,
  ): Promise<
    Omit<W, 'movements'> & {
      movements: ResolvedMovement<W['movements'][number]>[];
    }
  > {
    return {
      ...wod,
      // The resolver records what an automatic layer replaced even on a row
      // the athlete swapped (DN-116); the plate does not show it there. This
      // is the only place the payload is built, so it is the only place that
      // has to say so.
      movements: hideOverriddenPrescriptions(
        await this.resolution.resolve(userId, assignmentId, wod.movements),
      ),
    };
  }

  /** The scheduler's day-per-week cap, for callers outside the scheduling flow (e.g. the Stats page). */
  async getScheduleCap(userId: string): Promise<{ maxDaysPerWeek: number }> {
    const rule = await this.prisma.scheduleRule.findUnique({
      where: { userId },
    });
    // Derived, not stored (DN-12). The athlete picks days; how many is the
    // count of what they picked, so there is no column here that could drift
    // out of step with the days themselves.
    return {
      maxDaysPerWeek: (rule?.trainingDays ?? DEFAULT_TRAINING_DAYS).length,
    };
  }

  /** Marks today as a rest day — upserts so this works whether or not a WOD was already generated. */
  async skipToday(userId: string, today: string) {
    await this.prisma.dailyAssignment.upsert({
      where: { userId_date: { userId, date: today } },
      update: { status: 'skipped' },
      create: { userId, date: today, status: 'skipped' },
    });
    const rule = await this.prisma.scheduleRule.findUnique({
      where: { userId },
    });
    return {
      date: today,
      isRestDay: true,
      assignment: null,
      warmupCooldownEnabled: rule?.warmupCooldownEnabled ?? false,
      warmup: null,
      cooldown: null,
    };
  }

  private async generateWodForDate(
    userId: string,
    today: string,
    cooldownDays: number,
    equipment: string[],
  ) {
    const [wods, recentAssignments, skillLevels, linedExercises] =
      await Promise.all([
        this.prisma.wod.findMany({
          // The global library plus this athlete's own WODs (DN-93). Nobody
          // else's personal content can be picked for them.
          where: libraryVisibleTo(userId),
          // Ordered so the candidate pool is the same list every time. Without
          // it the pick depends on whatever order Postgres returns rows in,
          // which makes "the same athlete, the same day, the same library"
          // reproducible only by luck.
          orderBy: { name: 'asc' },
          select: {
            id: true,
            name: true,
            type: true,
            dominantPattern: true,
            // The movements come along so the equipment floor can find the one
            // the WOD is identified by (DN-82). Ordered, because "the first
            // movement in the dominant pattern" is only meaningful in the
            // order the athlete meets them.
            movements: {
              orderBy: { order: 'asc' },
              select: { exercise: true },
            },
          },
        }),
        this.prisma.dailyAssignment.findMany({
          where: {
            userId,
            date: { lt: today },
            status: { in: ['scheduled', 'in_progress', 'completed'] },
          },
          orderBy: { date: 'desc' },
          take: 30,
          select: {
            date: true,
            wod: {
              select: {
                id: true,
                name: true,
                type: true,
                dominantPattern: true,
              },
            },
          },
        }),
        // The remembered choice, because the floor has to judge what the
        // athlete will actually be given rather than what the library
        // prescribed: someone with no bar whose pull movement is already
        // Supermans is having nothing substituted for equipment.
        this.prisma.skillLevel.findMany({ where: { userId } }),
        this.prisma.exercise.findMany({
          where: { ...libraryVisibleTo(userId), line: { not: null } },
        }),
      ]);

    // status filter above guarantees wodId (and so `wod`) is set on every row here,
    // but wodId is nullable at the schema level (for skipped days), so narrow explicitly.
    const history: RecentAssignment[] = recentAssignments
      .filter(
        (a): a is typeof a & { wod: NonNullable<typeof a.wod> } =>
          a.wod !== null,
      )
      .map((a) => ({ date: a.date, wod: a.wod }));
    const chosenRung = new Map(skillLevels.map((l) => [l.line, l.rung]));
    const exerciseAtRung = new Map(
      linedExercises.map((e) => [`${e.line}:${e.rung}`, e]),
    );
    const owned = new Set(equipment);

    const candidates = wods.map((wod) => {
      const resolved = applyRememberedChoice(
        wod.movements,
        chosenRung,
        exerciseAtRung,
      );
      const identifying = dominantMovement(resolved, wod.dominantPattern);
      return {
        id: wod.id,
        name: wod.name,
        type: wod.type,
        dominantPattern: wod.dominantPattern,
        // A WOD whose claimed pattern no movement carries has no identity to
        // judge, so it stays in the pool rather than being dropped on a data
        // gap — the discipline every resolution layer here keeps.
        dominantEquipment: identifying?.exercise.equipment ?? [],
      };
    });

    return pickWod(
      applyEquipmentFloor(candidates, owned),
      history,
      today,
      cooldownDays,
      Math.random,
    );
  }
}
