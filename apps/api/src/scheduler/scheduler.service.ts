import { Inject, Injectable } from '@nestjs/common';
import type { Exercise } from '@prisma/client';
import {
  DEFAULT_EQUIPMENT,
  DEFAULT_PATTERN_COOLDOWN_DAYS,
  DEFAULT_TRAINING_DAYS,
} from '@regimen-works/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RNG, type Rng } from './rng';
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
  narrowToSlot,
  resolveProgramDay,
  type ActiveProgram,
  type ProgramDay,
  type SlotConstraints,
} from '../plans/program-day';
import {
  applyEquipmentFloor,
  applyRememberedChoice,
  dominantMovement,
  isRestDay,
  pickWod,
  RecentAssignment,
} from './scheduler.logic';

const wodInclude = resolvableMovementInclude;

/** A program day that has been acted on: a finished run is already retired. */
type SettledDay = Exclude<ProgramDay, { kind: 'completed' }>;

@Injectable()
export class SchedulerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wodsService: WodsService,
    private readonly resolution: MovementResolutionService,
    // Defaulted so the db specs that build this service by hand still get
    // production's randomness unless they deliberately pin it (DN-119).
    @Inject(RNG) private readonly rng: Rng = Math.random,
  ) {}

  /**
   * Returns today's assignment, generating one if the day hasn't been decided
   * yet.
   *
   * Since DN-16 the day is resolved through the athlete's active enrollment
   * rather than going straight to `pickWod`. There is still **one** path:
   * every athlete has an enrollment (DN-13), and the cases where a program is
   * not deciding today -- none, not started, just finished -- collapse into
   * the same fallback the app had before programs existed, instead of an
   * `if (enrolled) ... else ...` spreading through the scheduler.
   */
  async getToday(userId: string, today: string) {
    const [rule, existing, program] = await Promise.all([
      this.prisma.scheduleRule.findUnique({ where: { userId } }),
      this.prisma.dailyAssignment.findUnique({
        where: { userId_date: { userId, date: today } },
        include: { wod: { include: wodInclude }, session: true },
      }),
      this.loadActiveProgram(userId),
    ]);

    const warmupCooldownEnabled = rule?.warmupCooldownEnabled ?? false;
    const trainingDays = rule?.trainingDays ?? [...DEFAULT_TRAINING_DAYS];
    const day = await this.settleProgramDay(
      resolveProgramDay(program, trainingDays, today),
    );
    const plan = planBlock(day);

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
        // Recomputed rather than read back off the row's plan columns. Those
        // record what produced the day and are history; this answers "where am
        // I today", which is a question about the enrollment as it stands now.
        plan,
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
    const cooldownDays =
      rule?.patternCooldownDays ?? DEFAULT_PATTERN_COOLDOWN_DAYS;

    // `isRestDay` is still the whole rule when no program is deciding, which
    // is what keeps an athlete who has never touched a program on exactly the
    // behaviour they had before. Under a program the calendar question has
    // already been asked -- a flexible plan defers to these same training
    // days, a fixed one overrides them on purpose.
    const resting =
      day.kind === 'fallback'
        ? isRestDay(today, trainingDays)
        : day.kind === 'rest';

    if (resting) {
      return {
        date: today,
        plan,
        isRestDay: true,
        assignment: null,
        warmupCooldownEnabled,
        warmup: null,
        cooldown: null,
      };
    }

    const wod = await this.wodForDay(
      userId,
      today,
      day,
      cooldownDays,
      rule?.equipment ?? [...DEFAULT_EQUIPMENT],
    );

    const created = await this.prisma.dailyAssignment.create({
      data: {
        userId,
        date: today,
        wodId: wod.id,
        status: 'scheduled',
        // All three null on a day no program produced, which is what the
        // columns mean -- see the schema. Written together because they are
        // one fact: this day came from that slot of that run.
        enrollmentId: day.kind === 'fallback' ? null : day.day.enrollmentId,
        planSlotId: day.kind === 'fallback' ? null : day.day.planSlotId,
        planDayIndex: day.kind === 'fallback' ? null : day.day.planDayIndex,
      },
      include: { wod: { include: wodInclude } },
    });

    const scaledWod = await this.resolveWodForToday(
      userId,
      created.id,
      created.wod!,
    );

    return {
      date: today,
      plan,
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

  /**
   * The athlete's active run, flattened for `resolveProgramDay`.
   *
   * Null is an ordinary answer, not a missing row to repair: an athlete who
   * has just finished a program has none until provisioning enrolls them in
   * Just WODs again on a later request, and `getToday` must render their day
   * either way.
   */
  private async loadActiveProgram(
    userId: string,
  ): Promise<ActiveProgram | null> {
    const enrollment = await this.prisma.planEnrollment.findFirst({
      where: { userId, status: 'active' },
      include: {
        plan: {
          include: {
            weeks: {
              orderBy: { order: 'asc' },
              include: { slots: { orderBy: { dayOfWeek: 'asc' } } },
            },
          },
        },
      },
    });
    if (!enrollment) return null;

    return {
      enrollmentId: enrollment.id,
      planId: enrollment.planId,
      planName: enrollment.plan.name,
      scheduleMode: enrollment.plan.scheduleMode,
      startDate: enrollment.startDate,
      weeks: enrollment.weeks,
      authoredWeeks: enrollment.plan.weeks,
    };
  }

  /**
   * Retires a run that has passed its last day, and hands back the fallback
   * so the rest of `getToday` has one less case to carry.
   *
   * Completing on read rather than on a schedule is what keeps the app free of
   * a nightly job: the day an athlete's program ends is a day they open Today,
   * and nobody needs the row flipped before then.
   *
   * `status: 'active'` on the update is deliberately redundant and no test
   * kills it: `loadActiveProgram` already reads only active enrollments, so
   * nothing that reaches this line can be anything else. It is here for the
   * one case that read cannot rule out -- two requests landing together, both
   * finding the run still active -- where it makes the loser a no-op instead
   * of a second, later `completedAt` overwriting the first.
   */
  private async settleProgramDay(
    day: ProgramDay,
    // Excluding `completed` from the return type is the point of this
    // function: past that line every caller is dealing with a day that has
    // already been dealt with, and the compiler says so.
  ): Promise<SettledDay> {
    if (day.kind !== 'completed') return day;
    await this.prisma.planEnrollment.updateMany({
      where: { id: day.enrollmentId, status: 'active' },
      data: { status: 'completed', completedAt: new Date() },
    });
    return { kind: 'fallback', reason: 'no-enrollment' };
  }

  /** The day's WOD: the one the program pinned, or one picked for its slot. */
  private async wodForDay(
    userId: string,
    today: string,
    day: SettledDay,
    cooldownDays: number,
    equipment: string[],
  ) {
    if (day.kind === 'pinned') {
      const pinned = await this.prisma.wod.findUnique({
        where: { id: day.wodId },
        select: { id: true, name: true, type: true, dominantPattern: true },
      });
      // A pinned WOD is chosen on purpose, so no cooldown or equipment rule
      // overrides it -- re-testing a benchmark is the point, and the movement
      // resolution below still fits it to the athlete. Archived is deliberate
      // too: the program was authored around this workout, and history is not
      // rewritten by a later edit (DN-25).
      if (pinned) return pinned;
    }

    return this.generateWodForDate(
      userId,
      today,
      cooldownDays,
      equipment,
      day.kind === 'generated' ? day.constraints : null,
    );
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
    const [rule, program] = await Promise.all([
      this.prisma.scheduleRule.findUnique({ where: { userId } }),
      this.loadActiveProgram(userId),
    ]);
    // Resolved rather than hardcoded null: skipping a day does not leave the
    // program, so the strip that says which week the athlete is in is still
    // true afterwards. Nothing is settled here -- an enrollment past its last
    // day completes on the next `getToday`, not on a skip.
    const plan = planBlock(
      resolveProgramDay(
        program,
        rule?.trainingDays ?? [...DEFAULT_TRAINING_DAYS],
        today,
      ),
    );
    return {
      date: today,
      plan,
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
    constraints: SlotConstraints | null,
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
            // The two axes only a program constrains (DN-16). Selected
            // unconditionally rather than behind the constraints, because a
            // select that changes shape per call is a candidate list that
            // changes shape per call.
            isNamed: true,
            timeCapMinutes: true,
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
        isNamed: wod.isNamed,
        timeCapMinutes: wod.timeCapMinutes,
        // A WOD whose claimed pattern no movement carries has no identity to
        // judge, so it stays in the pool rather than being dropped on a data
        // gap — the discipline every resolution layer here keeps.
        dominantEquipment: identifying?.exercise.equipment ?? [],
      };
    });

    // Equipment first, then the slot. The floor is about what the athlete can
    // physically do and the slot is about what the program asked for, so
    // narrowing inside a pool already reduced to performable WODs is the only
    // order that cannot hand someone a workout they own no gear for. Both
    // relax rather than empty, so the pool handed to `pickWod` is never bare.
    const performable = applyEquipmentFloor(candidates, owned);
    const pool =
      constraints === null
        ? performable
        : narrowToSlot(performable, constraints);

    return pickWod(pool, history, today, cooldownDays, this.rng);
  }
}

/**
 * The today response's program block, or null when no program is deciding
 * today.
 *
 * Null covers the athlete with no enrollment, the one whose program has not
 * started, and the one whose program just ended -- three situations, one
 * answer, because from the screen's point of view they are the same: there is
 * no program context to show above today's plate.
 */
function planBlock(day: ProgramDay) {
  // `completed` answers null alongside `fallback` because it is the same fact
  // for the screen: the run that just ended is no longer context for today.
  if (day.kind === 'fallback' || day.kind === 'completed') return null;
  return {
    enrollmentId: day.day.enrollmentId,
    planId: day.day.planId,
    name: day.day.planName,
    week: day.day.week,
    totalWeeks: day.day.totalWeeks,
    weekLabel: day.day.weekLabel,
    slotKind: day.day.slotKind,
  };
}
