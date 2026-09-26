import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DEFAULT_PLAN_ID, DEFAULT_TRAINING_DAYS } from '@regimen-works/shared';
import type {
  CommitSetup,
  SetupOptions,
  SetupProgram,
} from '@regimen-works/shared';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { snapshotMovements } from '../enrollments/starting-movements';
import { fixedDaysOf, setupRejection, startDateRange } from './setup.logic';

/**
 * What a program's first week needs to be read for, and nothing else: the
 * picker shows a program's own fields, and the only thing it asks the weeks
 * is which days a fixed one trains.
 *
 * `take: 1` because that is the whole question. A picker that loaded every
 * authored week of every listed program would be fetching a calendar nobody
 * is looking at yet.
 */
const PLAN_FOR_PICKER = {
  include: {
    weeks: {
      orderBy: { order: 'asc' },
      take: 1,
      select: {
        order: true,
        slots: { select: { dayOfWeek: true, kind: true } },
      },
    },
  },
} satisfies Prisma.PlanDefaultArgs;

type PlanForPicker = Prisma.PlanGetPayload<typeof PLAN_FOR_PICKER>;

/** Which programs have straight sets to pace, and which of those leave a rest unstated. */
interface RestShape {
  paced: Set<string>;
  unstated: Set<string>;
}

function toSetupProgram(plan: PlanForPicker, rest: RestShape): SetupProgram {
  return {
    id: plan.id,
    name: plan.name,
    summary: plan.summary,
    goal: plan.goal,
    scheduleNote: plan.scheduleNote,
    // A plain string column, narrowed at the read site the way `unit` is --
    // the CHECK in DN-9's migration is what keeps it to the two values.
    scheduleMode: plan.scheduleMode as SetupProgram['scheduleMode'],
    minDaysPerWeek: plan.minDaysPerWeek,
    maxDaysPerWeek: plan.maxDaysPerWeek,
    defaultDays: plan.defaultDays,
    minWeeks: plan.minWeeks,
    maxWeeks: plan.maxWeeks,
    defaultWeeks: plan.defaultWeeks,
    fixedDays: fixedDaysOf(plan),
    hasStraightSets: rest.paced.has(plan.id),
    restPaceRequired: rest.unstated.has(plan.id),
  };
}

@Injectable()
export class SetupService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `today` comes from the caller's clock rather than this service's, the way
   * `getToday` and `SettingsService.get` take it — the earliest start date is
   * a fact about the athlete's calendar day, and a service that read it
   * itself could not be tested on the boundary the whole rule turns on.
   */
  async options(userId: string, today: string): Promise<SetupOptions> {
    const [plans, rule, touched, lastRestSeconds] = await Promise.all([
      this.selectablePlans(userId),
      this.prisma.scheduleRule.findUnique({
        where: { userId },
        select: { trainingDays: true },
      }),
      this.todayIsTouched(userId, today),
      this.lastRestSeconds(userId),
    ]);
    const rest = await this.restShapeOf(plans.map((p) => p.id));

    return {
      programs: plans.map((p) => toSetupProgram(p, rest)),
      // Provisioning writes a ScheduleRule on first sign-in, so the fallback
      // is for an athlete whose row is somehow absent rather than for the
      // ordinary case. The wizard is the worst screen in the app to 500 on.
      trainingDays: rule?.trainingDays ?? [...DEFAULT_TRAINING_DAYS],
      ...startDateRange(today, touched),
      lastRestSeconds,
    };
  }

  /**
   * The three answers, applied together.
   *
   * One transaction, with `onboardedAt` stamped last: an athlete who loses
   * the connection mid-commit comes back to the wizard rather than to a
   * program they half-chose, and the gate they come back through is the very
   * field that did not get written.
   *
   * Returns when the athlete onboarded, which is what the client's own gate
   * reads — a commit that answered 204 would leave the client knowing it had
   * succeeded and not knowing what it now is.
   */
  async commit(
    userId: string,
    body: CommitSetup,
    today: string,
  ): Promise<{ onboardedAt: string }> {
    const plan = await this.prisma.plan.findFirst({
      where: { id: body.planId, ...selectableBy(userId) },
      ...PLAN_FOR_PICKER,
    });
    // 404 rather than 403 for a program owned by somebody else: whether
    // another athlete's private program exists is not this athlete's
    // business, and "no such program" is true from where they are standing.
    if (!plan) {
      throw new NotFoundException('That is not a program you can start.');
    }

    const range = startDateRange(
      today,
      await this.todayIsTouched(userId, today),
    );
    const { unstated } = await this.restShapeOf([plan.id]);
    const rejection = setupRejection(
      { ...plan, restPaceRequired: unstated.has(plan.id) },
      body,
      range,
    );
    if (rejection) throw new BadRequestException(rejection);

    const onboardedAt = await this.prisma.$transaction(async (tx) => {
      // Flexible only. A fixed program's slots are the schedule, and DN-118
      // established that the athlete's stored days stay true and merely
      // asleep for the run -- overwriting them here would destroy the value
      // the lock exists to hand back.
      if (body.trainingDays !== null) {
        await tx.scheduleRule.upsert({
          where: { userId },
          update: { trainingDays: body.trainingDays },
          create: { userId, trainingDays: body.trainingDays },
        });
      }

      // Updated in place rather than replaced. Every athlete is already
      // enrolled in Just WODs by provisioning (DN-13) and at most one
      // enrollment may be active, so this is the same run pointed at a
      // different program -- deleting the old row would raise an FK error the
      // moment a training day pointed at it, and completing it would write a
      // never-trained program into the finished list.
      const active = await tx.planEnrollment.findFirst({
        where: { userId, status: 'active' },
        select: { id: true },
      });
      // What every group stands at as the run begins, so the completion card
      // can say what moved rather than only how many sessions were trained
      // (DN-18). Taken inside the transaction, against the same instant the
      // enrollment is written.
      const enrollment = {
        planId: body.planId,
        startDate: body.startDate,
        weeks: body.weeks,
        // Written on update too: pointing the run at a different program is
        // committing to that program, and the pace belongs to the commitment.
        defaultRestSeconds: body.defaultRestSeconds,
        startingMovements: await snapshotMovements(tx, userId),
      };
      if (active) {
        await tx.planEnrollment.update({
          where: { id: active.id },
          data: enrollment,
        });
      } else {
        // An athlete who finished a program has no active enrollment until
        // something re-enrolls them, and the wizard is reachable from that
        // state too.
        await tx.planEnrollment.create({ data: { userId, ...enrollment } });
      }

      // `getToday` creates one assignment per date and hands back the same
      // row on every later read, so starting today would otherwise leave
      // today on the program the athlete just replaced -- the app offering a
      // choice it does not honour. Discarding it makes day one really day
      // one, and the filter makes that safe: a session started in the seconds
      // since the check above leaves the day alone rather than deleting work.
      if (body.startDate === range.today) {
        await tx.dailyAssignment.deleteMany({
          where: { userId, date: range.today, session: null, log: null },
        });
      }

      // A card still sitting above Today after the athlete has started
      // something new would be offering a choice they have just made (DN-18).
      await tx.planEnrollment.updateMany({
        where: { userId, status: 'completed', summaryDismissedAt: null },
        data: { summaryDismissedAt: new Date() },
      });

      const user = await tx.user.update({
        where: { id: userId },
        data: { onboardedAt: new Date() },
        select: { onboardedAt: true },
      });
      return user.onboardedAt!;
    });

    return { onboardedAt: onboardedAt.toISOString() };
  }

  /**
   * The programs this athlete may start: the curated library, plus anything
   * they authored themselves (DN-93's tiers, as they apply to plans).
   *
   * Just WODs first and the rest by name. First because it is what every
   * athlete is already on and what the picker recommends to anyone unsure --
   * and because "no programming, just workouts" is the honest default for a
   * first-run screen, not a consolation prize sorted to the bottom.
   */
  private async selectablePlans(userId: string): Promise<PlanForPicker[]> {
    const plans = await this.prisma.plan.findMany({
      where: selectableBy(userId),
      orderBy: { name: 'asc' },
      ...PLAN_FOR_PICKER,
    });
    return [
      ...plans.filter((p) => p.id === DEFAULT_PLAN_ID),
      ...plans.filter((p) => p.id !== DEFAULT_PLAN_ID),
    ];
  }

  /**
   * Which of these programs have straight sets at all -- the wizard asks for
   * a pace only where there is a rest between sets to pace -- and which of
   * those leave some movement's rest unstated, which makes the question
   * required (ADR 0005).
   *
   * Every week, not the picker's first: a hole in week six is still a clock
   * the athlete will reach. Asked of the database rather than loaded, because
   * the answer is two bits per program and the rows behind it are the whole
   * calendar.
   */
  private async restShapeOf(planIds: string[]): Promise<RestShape> {
    const plansWith = async (movement: Prisma.PlanSlotMovementWhereInput) => {
      const weeks = await this.prisma.planWeek.findMany({
        where: {
          planId: { in: planIds },
          slots: { some: { movements: { some: movement } } },
        },
        select: { planId: true },
        distinct: ['planId'],
      });
      return new Set(weeks.map((w) => w.planId));
    };
    const [paced, unstated] = await Promise.all([
      plansWith({}),
      plansWith({ restSeconds: null }),
    ]);
    return { paced, unstated };
  }

  /**
   * The pace the athlete set on their most recent run that had one, to
   * prefill the field with -- so the one question, where it is asked at all,
   * usually arrives already answered.
   *
   * Null where they have never set one. Not "the most recent run's value",
   * which is null for every run on a program that stated its own rest: an
   * athlete who once chose 90 seconds has said something about how they
   * train, and a built-in program in between should not make them say it
   * again.
   */
  private async lastRestSeconds(userId: string): Promise<number | null> {
    const last = await this.prisma.planEnrollment.findFirst({
      where: { userId, defaultRestSeconds: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { defaultRestSeconds: true },
    });
    return last?.defaultRestSeconds ?? null;
  }

  /**
   * Whether anything has been done on today's workout yet.
   *
   * A session or a log, because those are the two rows that mean training
   * happened. The assignment itself does not count: `getToday` creates one on
   * the first read of the day, so an athlete who opened the app this morning
   * and trained nothing would otherwise be told they cannot start until
   * tomorrow.
   */
  private async todayIsTouched(
    userId: string,
    today: string,
  ): Promise<boolean> {
    const touched = await this.prisma.dailyAssignment.findFirst({
      where: {
        userId,
        date: today,
        OR: [{ session: { isNot: null } }, { log: { isNot: null } }],
      },
      select: { id: true },
    });
    return touched !== null;
  }
}

/** Global rows plus this athlete's own — the tier rule, in one place. */
function selectableBy(userId: string): Prisma.PlanWhereInput {
  return { OR: [{ ownerId: null }, { ownerId: userId }] };
}
