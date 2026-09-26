import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  enrollmentSummarySchema,
  movementSnapshotSchema,
  type CompletedProgram,
  type EnrollmentSummary,
  type MovementSnapshot,
  type RestPace,
  type UpdateRestPace,
} from '@regimen-works/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { libraryVisibleTo } from '../library/visible-to';
import { loadActiveProgram } from '../plans/active-program';
import { restPaceOf } from '../plans/rest-pace';
import { buildEnrollmentSummary } from './enrollment-summary.logic';
import { snapshotMovements } from './starting-movements';

/**
 * What a completed run is read back as (DN-18): the figures, plus the name of
 * the program they belong to.
 */
const COMPLETED_FOR_CARD = {
  select: {
    id: true,
    planId: true,
    completedAt: true,
    summary: true,
    plan: { select: { name: true } },
  },
} satisfies Prisma.PlanEnrollmentDefaultArgs;

type CompletedRow = Prisma.PlanEnrollmentGetPayload<typeof COMPLETED_FOR_CARD>;

@Injectable()
export class EnrollmentsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Retires a run that has passed its last day, with its figures attached.
   *
   * Called by the scheduler as it reads today, which is what keeps the app
   * free of a nightly job: the day a program ends is a day the athlete opens
   * Today, and nobody needs the row flipped before then.
   *
   * The `status: 'active'` guard on the write makes a race a no-op rather than
   * a second, later `completedAt` overwriting the first -- two requests can
   * land together and both find the run still running. The summary is computed
   * before the guard rather than inside a transaction with it because the
   * figures are the same either way: the loser of the race computed the truth
   * and simply does not store it.
   */
  async completeRun(userId: string, enrollmentId: string): Promise<void> {
    const enrollment = await this.prisma.planEnrollment.findFirst({
      where: { id: enrollmentId, userId, status: 'active' },
      select: { id: true, weeks: true, startingMovements: true },
    });
    // Gone, someone else's, or already retired by a request that arrived
    // while this one was reading. Nothing to complete, and nothing wrong.
    if (!enrollment) return;

    const summary = await this.summarise(
      userId,
      enrollment.id,
      enrollment.weeks,
      movementSnapshotOf(enrollment.startingMovements),
    );

    await this.prisma.planEnrollment.updateMany({
      where: { id: enrollment.id, status: 'active' },
      data: {
        status: 'completed',
        completedAt: new Date(),
        summary,
      },
    });
  }

  /** Every program this athlete has finished, most recent first. */
  async listCompleted(userId: string): Promise<CompletedProgram[]> {
    const rows = await this.prisma.planEnrollment.findMany({
      where: { userId, status: 'completed', summary: { not: Prisma.DbNull } },
      orderBy: { completedAt: 'desc' },
      ...COMPLETED_FOR_CARD,
    });
    return rows.flatMap((row) => {
      const completed = toCompletedProgram(row);
      return completed ? [completed] : [];
    });
  }

  /**
   * The card Today shows above the day, or null when none is owed.
   *
   * The most recent completed run the athlete has not dismissed. Only one is
   * ever offered: an athlete returning after two programs ended wants to be
   * training, not working through a queue of congratulations.
   */
  async cardFor(userId: string): Promise<CompletedProgram | null> {
    const row = await this.prisma.planEnrollment.findFirst({
      where: {
        userId,
        status: 'completed',
        summary: { not: Prisma.DbNull },
        summaryDismissedAt: null,
      },
      orderBy: { completedAt: 'desc' },
      ...COMPLETED_FOR_CARD,
    });
    return row ? toCompletedProgram(row) : null;
  }

  /** Puts the card away. Idempotent: dismissing twice is dismissing once. */
  async dismiss(userId: string, enrollmentId: string): Promise<void> {
    const { count } = await this.prisma.planEnrollment.updateMany({
      where: { id: enrollmentId, userId, status: 'completed' },
      data: { summaryDismissedAt: new Date() },
    });
    if (count === 0) {
      throw new NotFoundException('That is not a program you have finished.');
    }
  }

  /**
   * Starts the same program over: same plan, same length, from today.
   *
   * No questions, because none of them have new answers -- the athlete has
   * just run this program and is saying they want it again. Choosing a
   * different one goes through the wizard, which is the program picker.
   *
   * Dismissing the card is part of the same write rather than a second
   * request: the prompt has been answered by doing the thing it asked, and a
   * card still sitting above Today afterwards would be offering a choice
   * already made.
   */
  async runAgain(
    userId: string,
    enrollmentId: string,
    today: string,
  ): Promise<{ enrollmentId: string }> {
    const previous = await this.prisma.planEnrollment.findFirst({
      where: { id: enrollmentId, userId, status: 'completed' },
      select: { id: true, planId: true, weeks: true, defaultRestSeconds: true },
    });
    if (!previous) {
      throw new NotFoundException('That is not a program you have finished.');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.planEnrollment.updateMany({
        where: { id: previous.id, summaryDismissedAt: null },
        data: { summaryDismissedAt: new Date() },
      });

      // An athlete whose program just ended has no active enrollment, which
      // is the state this is reached from. Completing whatever is active
      // anyway would be inventing a finished program out of a Just WODs
      // fallback, so a run already under way simply wins and this becomes a
      // no-op -- two taps on "Run it again" cannot enrol twice, and the
      // partial unique index would refuse the second row regardless.
      const active = await tx.planEnrollment.findFirst({
        where: { userId, status: 'active' },
        select: { id: true },
      });
      if (active) return { enrollmentId: active.id };

      const created = await tx.planEnrollment.create({
        data: {
          userId,
          planId: previous.planId,
          startDate: today,
          weeks: previous.weeks,
          // The pace too (ADR 0005): the same program again is the same
          // answer to the same question, and asking it would be the first
          // question "no questions" has had to make an exception for.
          defaultRestSeconds: previous.defaultRestSeconds,
          startingMovements: await snapshotMovements(tx, userId),
        },
        select: { id: true },
      });
      return { enrollmentId: created.id };
    });
  }

  /**
   * Changes the rest pace of the program being run (ADR 0005) -- the "editable
   * while it runs" half of setting it at enrollment.
   *
   * Takes effect from the next read of a day. A session already under way
   * keeps the rest it started with, the same way it keeps its movements
   * (DN-90): the countdown between two sets should not change length because
   * the athlete opened Settings between them.
   *
   * Blank is refused where the routine leaves some rest unstated, by the same
   * rule the wizard applies -- clearing it would leave a set with no rest to
   * run and nobody having been asked.
   */
  async updateRestPace(
    userId: string,
    body: UpdateRestPace,
  ): Promise<RestPace> {
    const pace = restPaceOf(await loadActiveProgram(this.prisma, userId));
    if (!pace) {
      throw new NotFoundException(
        'You are not running a program with sets to rest between.',
      );
    }
    if (pace.required && body.defaultRestSeconds === null) {
      throw new BadRequestException(
        `${pace.planName} does not say how long to rest after every movement, so it needs a rest from you.`,
      );
    }

    // `status: 'active'` on the write as well as the read: a run that
    // completed in between is history, and history does not take edits.
    const { count } = await this.prisma.planEnrollment.updateMany({
      where: { id: pace.enrollmentId, userId, status: 'active' },
      data: { defaultRestSeconds: body.defaultRestSeconds },
    });
    if (count === 0) {
      throw new NotFoundException(
        'You are not running a program with sets to rest between.',
      );
    }
    return { ...pace, defaultRestSeconds: body.defaultRestSeconds };
  }

  /**
   * The figures for one run: how long it was, how much of it was trained, and
   * which groups moved while it ran.
   *
   * Sessions are counted from the assignments that point at this enrollment,
   * so a day trained on a Just WODs fallback before the program started is
   * not credited to it. Only `completed` counts -- a scheduled day is the
   * app's expectation and a skipped one is the athlete's answer to it.
   */
  private async summarise(
    userId: string,
    enrollmentId: string,
    weeks: number | null,
    startingMovements: MovementSnapshot,
  ): Promise<EnrollmentSummary> {
    const [sessions, skillLevels] = await Promise.all([
      this.prisma.dailyAssignment.count({
        where: { userId, enrollmentId, status: 'completed' },
      }),
      this.prisma.skillLevel.findMany({
        where: { userId },
        select: { movementGroup: true, exerciseId: true },
      }),
    ]);

    const currentMovements = new Map(
      skillLevels.map((l) => [l.movementGroup, l.exerciseId]),
    );
    const groups = [
      ...new Set([
        ...Object.keys(startingMovements),
        ...currentMovements.keys(),
      ]),
    ];

    // Only the groups in play. The library is mostly content this card never
    // irrelevant to any one program -- a pull program has nothing to say
    // about the athlete's hinge.
    const inGroups = await this.prisma.exercise.findMany({
      where: { ...libraryVisibleTo(userId), movementGroup: { in: groups } },
      select: { id: true, name: true },
    });
    const names = new Map(inGroups.map((e) => [e.id, e.name] as const));

    return buildEnrollmentSummary({
      weeks,
      sessions,
      startingMovements,
      currentMovements,
      names,
    });
  }
}

/**
 * `startingMovements` is `Json`, so Prisma hands it back as "anything at all".
 *
 * Parsed rather than cast: the column is written by this application, but a
 * row written before the snapshot existed holds `{}` from the column default,
 * and one edited by hand could hold anything. A snapshot that does not parse
 * reads as empty, which reports "nothing moved" rather than throwing on the
 * one request an athlete makes on the day their program ends.
 */
function movementSnapshotOf(value: Prisma.JsonValue): MovementSnapshot {
  const parsed = movementSnapshotSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

function toCompletedProgram(row: CompletedRow): CompletedProgram | null {
  const summary = enrollmentSummarySchema.safeParse(row.summary);
  // A run retired by DN-16's completion-on-read before this issue existed has
  // no figures. It is a real row and a real finished program, but there is
  // nothing to show for it, so it is left out rather than rendered as zeroes
  // it never earned.
  if (!summary.success || row.completedAt === null) return null;
  return {
    enrollmentId: row.id,
    planId: row.planId,
    planName: row.plan.name,
    completedAt: row.completedAt.toISOString(),
    summary: summary.data,
  };
}
