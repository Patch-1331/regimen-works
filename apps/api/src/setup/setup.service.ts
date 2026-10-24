import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DEFAULT_PROGRAM_ID,
  DEFAULT_TRAINING_DAYS,
} from '@regimen-works/shared';
import type {
  CommitSetup,
  SetupOptions,
  SetupProgram,
} from '@regimen-works/shared';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { snapshotMovements } from '../enrollments/starting-movements';
import { fixedDaysOf, setupRejection, startDateRange } from './setup.logic';
import { todayIsTouched } from './today-touched';

/**
 * What a program's first week needs to be read for, and nothing else: the
 * picker shows a program's own fields, and the only thing it asks the weeks
 * is which days a fixed one trains.
 *
 * `take: 1` because that is the whole question. A picker that loaded every
 * authored week of every listed program would be fetching a calendar nobody
 * is looking at yet.
 */
const PROGRAM_FOR_PICKER = {
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
} satisfies Prisma.ProgramDefaultArgs;

type ProgramForPicker = Prisma.ProgramGetPayload<typeof PROGRAM_FOR_PICKER>;

/** Which programs have straight sets to pace, and which of those leave a rest unstated. */
interface RestShape {
  paced: Set<string>;
  unstated: Set<string>;
}

function toSetupProgram(
  program: ProgramForPicker,
  rest: RestShape,
): SetupProgram {
  return {
    id: program.id,
    name: program.name,
    summary: program.summary,
    goal: program.goal,
    scheduleNote: program.scheduleNote,
    // A plain string column, narrowed at the read site the way `unit` is --
    // the CHECK in DN-9's migration is what keeps it to the two values.
    scheduleMode: program.scheduleMode as SetupProgram['scheduleMode'],
    minDaysPerWeek: program.minDaysPerWeek,
    maxDaysPerWeek: program.maxDaysPerWeek,
    defaultDays: program.defaultDays,
    minWeeks: program.minWeeks,
    maxWeeks: program.maxWeeks,
    defaultWeeks: program.defaultWeeks,
    allowsNoEnd: program.allowsNoEnd,
    fixedDays: fixedDaysOf(program),
    hasStraightSets: rest.paced.has(program.id),
    restPaceRequired: rest.unstated.has(program.id),
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
    const [programs, rule, touched, lastRestSeconds] = await Promise.all([
      this.selectablePrograms(userId),
      this.prisma.scheduleRule.findUnique({
        where: { userId },
        select: { trainingDays: true },
      }),
      todayIsTouched(this.prisma, userId, today),
      this.lastRestSeconds(userId),
    ]);
    const rest = await this.restShapeOf(programs.map((p) => p.id));

    return {
      programs: programs.map((p) => toSetupProgram(p, rest)),
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
    const program = await this.prisma.program.findFirst({
      where: { id: body.programId, ...selectableBy(userId) },
      ...PROGRAM_FOR_PICKER,
    });
    // 404 rather than 403 for a program owned by somebody else: whether
    // another athlete's private program exists is not this athlete's
    // business, and "no such program" is true from where they are standing.
    if (!program) {
      throw new NotFoundException('That is not a program you can start.');
    }

    const range = startDateRange(
      today,
      await todayIsTouched(this.prisma, userId, today),
    );
    const { unstated } = await this.restShapeOf([program.id]);
    const rejection = setupRejection(
      { ...program, restPaceRequired: unstated.has(program.id) },
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

      // `getToday` creates one assignment per date and hands back the same
      // row on every later read, so starting today would otherwise leave
      // today on the program the athlete just replaced -- the app offering a
      // choice it does not honour. Discarding it makes day one really day
      // one, and the filter makes that safe: a session started in the seconds
      // since the check above leaves the day alone rather than deleting work.
      //
      // First, so an untouched today does not count as a day of the run
      // being left, below.
      if (body.startDate === range.today) {
        await tx.dailyAssignment.deleteMany({
          where: { userId, date: range.today, session: null, log: null },
        });
      }

      // The run being left ends, and the new program is a new run (ADR 0009,
      // decision 1). Rewriting the row instead would relabel every day
      // already trained as the new program, and the run left would vanish
      // from history. Ended before the new one is written, so the one-active
      // partial unique index holds throughout.
      //
      // Except a run with no days on it at all, which is replaced in place:
      // there is nothing to relabel, and ending it would write a run nobody
      // trained into the past-runs list. That is the Just WODs run
      // provisioning makes before the wizard (DN-13), so onboarding leaves
      // one enrollment rather than an empty ended one beside it.
      const active = await tx.programEnrollment.findFirst({
        where: { userId, status: 'active' },
        select: { id: true, _count: { select: { assignments: true } } },
      });
      const replaceInPlace = active !== null && active._count.assignments === 0;
      if (active && !replaceInPlace) {
        await tx.programEnrollment.update({
          where: { id: active.id },
          data: { status: 'ended', endedAt: new Date() },
        });
      }
      // What every group stands at as the run begins, so the completion card
      // can say what moved rather than only how many sessions were trained
      // (DN-18). Taken inside the transaction, against the same instant the
      // enrollment is written.
      const enrollment = {
        programId: body.programId,
        startDate: body.startDate,
        weeks: body.weeks,
        // Written on update too: pointing the run at a different program is
        // committing to that program, and the pace belongs to the commitment.
        defaultRestSeconds: body.defaultRestSeconds,
        startingMovements: await snapshotMovements(tx, userId),
      };
      if (replaceInPlace) {
        await tx.programEnrollment.update({
          where: { id: active.id },
          data: enrollment,
        });
      } else {
        // Also where an athlete who finished a program lands: they have no
        // active enrollment until something re-enrolls them, and the wizard
        // is reachable from that state too.
        await tx.programEnrollment.create({ data: { userId, ...enrollment } });
      }

      // A card still sitting above Today after the athlete has started
      // something new would be offering a choice they have just made (DN-18).
      await tx.programEnrollment.updateMany({
        where: { userId, status: 'completed', summaryDismissedAt: null },
        data: { summaryDismissedAt: new Date() },
      });

      // The first commit only. Starting a program from the Programs tab
      // (DN-180) goes through here too, and onboarding happened once.
      await tx.user.updateMany({
        where: { id: userId, onboardedAt: null },
        data: { onboardedAt: new Date() },
      });
      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { onboardedAt: true },
      });
      return user.onboardedAt!;
    });

    return { onboardedAt: onboardedAt.toISOString() };
  }

  /**
   * The programs this athlete may start: the curated library, plus anything
   * they authored themselves (DN-93's tiers, as they apply to programs).
   *
   * Just WODs first and the rest by name. First because it is what every
   * athlete is already on and what the picker recommends to anyone unsure --
   * and because "no programming, just workouts" is the honest default for a
   * first-run screen, not a consolation prize sorted to the bottom.
   */
  private async selectablePrograms(
    userId: string,
  ): Promise<ProgramForPicker[]> {
    const programs = await this.prisma.program.findMany({
      where: selectableBy(userId),
      orderBy: { name: 'asc' },
      ...PROGRAM_FOR_PICKER,
    });
    return [
      ...programs.filter((p) => p.id === DEFAULT_PROGRAM_ID),
      ...programs.filter((p) => p.id !== DEFAULT_PROGRAM_ID),
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
  private async restShapeOf(programIds: string[]): Promise<RestShape> {
    const programsWith = async (
      movement: Prisma.ProgramSlotMovementWhereInput,
    ) => {
      const weeks = await this.prisma.programWeek.findMany({
        where: {
          programId: { in: programIds },
          slots: { some: { movements: { some: movement } } },
        },
        select: { programId: true },
        distinct: ['programId'],
      });
      return new Set(weeks.map((w) => w.programId));
    };
    const [paced, unstated] = await Promise.all([
      programsWith({}),
      programsWith({ sets: { some: { restSeconds: null } } }),
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
    const last = await this.prisma.programEnrollment.findFirst({
      where: { userId, defaultRestSeconds: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { defaultRestSeconds: true },
    });
    return last?.defaultRestSeconds ?? null;
  }
}

/**
 * Global rows plus this athlete's own, live ones only — the tier rule, in one
 * place. Archived programs leave the picker (ADR 0006, decision 5); reads that
 * follow an enrollment already under way must not use this.
 */
function selectableBy(userId: string): Prisma.ProgramWhereInput {
  return {
    archivedAt: null,
    OR: [{ ownerId: null }, { ownerId: userId }],
  };
}
