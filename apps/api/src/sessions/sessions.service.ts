import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  AdvanceInterval,
  RoundSplit,
  WodType,
  WorkoutSession,
} from '@regimen-works/shared';
import {
  finishSecondsAt,
  hasRepScheme,
  resolveIntervalConfig,
} from '@regimen-works/shared';
import { PrismaService } from '../prisma/prisma.service';
import {
  MovementResolutionService,
  resolvableMovementInclude,
} from '../scheduler/movement-resolution.service';
import { toRoundSplits, toSessionDto } from './session.mapper';
import {
  advanceInterval,
  mergeRoundSplit,
  snapshotMovements,
} from './session.logic';

@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resolution: MovementResolutionService,
  ) {}

  /**
   * Idempotent: a create-if-absent, so two concurrent calls (React's dev-mode
   * double effect, two tabs, a retried request) both end up on the one
   * session rather than the loser taking a unique-constraint error.
   *
   * `createMany({ skipDuplicates: true })` and a read, not the `upsert` this
   * used to be. Prisma normally compiles an upsert to INSERT ... ON CONFLICT,
   * which is safe -- but not when the update leg is empty, and this one's was
   * `update: {}`. That fell back to SELECT-then-INSERT, so under READ
   * COMMITTED both callers found nothing, both inserted, and the loser took a
   * unique violation on `WorkoutSession_assignmentId_key` (DN-105): a 500 on
   * the athlete's first tap of START WORKOUT.
   *
   * This compiles to INSERT ... ON CONFLICT DO NOTHING, where the loser is a
   * no-op, which is also what was meant -- `update: {}` was never an update.
   * Same reasoning, same shape as `UserProvisioningService.ensure`.
   */
  async start(userId: string, assignmentId: string): Promise<WorkoutSession> {
    // Scoped by userId so another user's assignment id reads as not found.
    const assignment = await this.prisma.dailyAssignment.findFirst({
      where: { id: assignmentId, userId },
      include: { wod: { include: resolvableMovementInclude } },
    });
    if (!assignment) throw new NotFoundException('Assignment not found');
    if (!assignment.wod)
      throw new BadRequestException('Rest days have no workout to start');

    // Read once here and copied onto the session, exactly like capSeconds: the
    // workout runs under the rules it started with, so toggling the setting
    // mid-session can't change where its clock stops. Absent row means the
    // column default, which is on.
    const rule = await this.prisma.scheduleRule.findUnique({
      where: { userId },
    });

    // The same resolution the Today plate showed -- current rung, then the
    // day's swaps -- pinned down as the movements this session trained
    // (DN-90). Nothing else records it: the rung and the swap rows both keep
    // moving after today, so without this a past day re-reads as whatever
    // the settings say now.
    const movements = snapshotMovements(
      await this.resolution.resolve(
        userId,
        assignmentId,
        assignment.wod.movements,
      ),
    );

    await this.prisma.workoutSession.createMany({
      data: [
        {
          assignmentId,
          userId,
          capSeconds: assignment.wod.timeCapMinutes * 60,
          autoStopAtCap: rule?.autoStopAtCapEnabled ?? true,
          roundSplits: [],
          movements,
          status: 'in_progress',
        },
      ],
      skipDuplicates: true,
    });

    // A second start (a double effect, a reload) reads the session already
    // running and leaves it be -- including its snapshot, which must say what
    // the workout began with, not what a later swap would have made it.
    const session = await this.prisma.workoutSession.findUniqueOrThrow({
      where: { assignmentId },
    });

    if (assignment.status === 'scheduled') {
      await this.prisma.dailyAssignment.update({
        where: { id: assignmentId },
        data: { status: 'in_progress' },
      });
    }

    return toSessionDto(session);
  }

  async get(
    userId: string,
    assignmentId: string,
  ): Promise<WorkoutSession | null> {
    const session = await this.prisma.workoutSession.findFirst({
      where: { assignmentId, userId },
    });
    return session ? toSessionDto(session) : null;
  }

  async logRound(
    userId: string,
    assignmentId: string,
    round: RoundSplit,
  ): Promise<WorkoutSession> {
    const session = await this.prisma.workoutSession.findFirst({
      where: { assignmentId, userId },
    });
    if (!session)
      throw new NotFoundException('No active session for this assignment');
    if (session.status !== 'in_progress') {
      throw new BadRequestException('Session is no longer in progress');
    }

    // Where the cap binds, the clock stops there, so there is no such second
    // to have tapped in. The screen swaps its round button out when the cap
    // lands; this is the same rule for a client that hasn't caught up with it
    // yet. With the opt-out the clock runs on, and so do the rounds.
    if (session.autoStopAtCap && round.atSeconds > session.capSeconds) {
      throw new BadRequestException(
        `Round ${round.round} is past this workout's time cap`,
      );
    }

    const splits = toRoundSplits(session.roundSplits);
    const updatedSplits = mergeRoundSplit(splits, round);

    const updated = await this.prisma.workoutSession.update({
      where: { assignmentId },
      data: { roundSplits: updatedSplits },
    });

    return toSessionDto(updated);
  }

  /**
   * Records an EMOM/Tabata interval rollover (Feature #30) — the interval
   * screen posts one as each interval starts, including a final call one
   * past the last interval when the sequence runs out.
   */
  async advanceInterval(
    userId: string,
    assignmentId: string,
    next: AdvanceInterval,
  ): Promise<WorkoutSession> {
    const session = await this.prisma.workoutSession.findFirst({
      where: { assignmentId, userId },
      include: { assignment: { include: { wod: true } } },
    });
    if (!session)
      throw new NotFoundException('No active session for this assignment');
    if (session.status !== 'in_progress') {
      throw new BadRequestException('Session is no longer in progress');
    }

    const wod = session.assignment.wod;
    const config = wod
      ? resolveIntervalConfig({ ...wod, type: wod.type as WodType })
      : null;
    if (!config) {
      throw new BadRequestException('This WOD has no interval structure');
    }
    // One past the last interval is the "sequence finished" marker; anything
    // beyond that is a client bug, not a state worth persisting.
    if (next.intervalIndex > config.intervalCount) {
      throw new BadRequestException(
        `Interval ${next.intervalIndex} is past the end of this WOD`,
      );
    }

    const progress = advanceInterval(toRoundSplits(session.roundSplits), next);

    const updated = await this.prisma.workoutSession.update({
      where: { assignmentId },
      data: {
        roundSplits: progress.roundSplits,
        intervalIndex: progress.intervalIndex,
        intervalStartedAtSeconds: progress.intervalStartedAtSeconds,
      },
    });

    return toSessionDto(updated);
  }

  async setRoundSplit(
    userId: string,
    assignmentId: string,
    roundSplitCount: number | null,
  ): Promise<WorkoutSession> {
    const session = await this.prisma.workoutSession.findFirst({
      where: { assignmentId, userId },
      include: {
        assignment: {
          include: { wod: { include: { movements: true } } },
        },
      },
    });
    if (!session)
      throw new NotFoundException('No active session for this assignment');

    // A rep scheme already prescribes the rounds, so there is nothing left to
    // split — and an even split over a ladder's total would walk the athlete
    // through 15-15-15 where the workout says 21-15-9. The client hides the
    // control, but this endpoint is reachable without it.
    const movements = session.assignment.wod?.movements ?? [];
    if (roundSplitCount !== null && hasRepScheme(movements)) {
      throw new BadRequestException(
        "This workout's rep scheme sets its rounds — it can't be split",
      );
    }

    const updated = await this.prisma.workoutSession.update({
      where: { assignmentId },
      data: { roundSplitCount },
    });

    return toSessionDto(updated);
  }

  /**
   * Ends the session, whether the athlete tapped FINISH or the time cap
   * stopped the clock for them — the screen posts the same call either way.
   */
  async finish(userId: string, assignmentId: string): Promise<WorkoutSession> {
    const session = await this.prisma.workoutSession.findFirst({
      where: { assignmentId, userId },
    });
    if (!session)
      throw new NotFoundException('No active session for this assignment');

    // Already stopped — the cap ended it, or a FINISH tap did. The first stop
    // is the real one, so this is a no-op rather than a second finish that
    // would overwrite the recorded time with a later one.
    if (session.status === 'completed') return toSessionDto(session);

    // Clamped to the cap rather than taken raw off the wall clock: a tap that
    // lands after the cap (a locked phone, a tab woken up late) scores the cap,
    // which is where the athlete's clock stopped. With the opt-out there was no
    // stop to score, so the wall clock is the honest answer.
    const elapsedSeconds = (Date.now() - session.startedAt.getTime()) / 1000;
    const finishedAtSeconds = session.autoStopAtCap
      ? finishSecondsAt(elapsedSeconds, session.capSeconds)
      : Math.floor(elapsedSeconds);

    const updated = await this.prisma.workoutSession.update({
      where: { assignmentId },
      data: { status: 'completed', finishedAtSeconds },
    });

    return toSessionDto(updated);
  }

  /**
   * Stamps warmupCompletedAt (Feature #63) — the web app only calls this
   * when every checklist item was checked off before proceeding. An
   * explicit skip leaves it null; the timestamp specifically means "the
   * warm-up was actually done," not just "the screen was passed through."
   */
  async completeWarmup(
    userId: string,
    assignmentId: string,
  ): Promise<WorkoutSession> {
    const session = await this.prisma.workoutSession.findFirst({
      where: { assignmentId, userId },
    });
    if (!session)
      throw new NotFoundException('No active session for this assignment');

    const updated = await this.prisma.workoutSession.update({
      where: { assignmentId },
      data: { warmupCompletedAt: new Date() },
    });

    return toSessionDto(updated);
  }

  /** Same contract as completeWarmup, for the cool-down checklist (Feature #63). */
  async completeCooldown(
    userId: string,
    assignmentId: string,
  ): Promise<WorkoutSession> {
    const session = await this.prisma.workoutSession.findFirst({
      where: { assignmentId, userId },
    });
    if (!session)
      throw new NotFoundException('No active session for this assignment');

    const updated = await this.prisma.workoutSession.update({
      where: { assignmentId },
      data: { cooldownCompletedAt: new Date() },
    });

    return toSessionDto(updated);
  }

  async cancel(userId: string, assignmentId: string): Promise<void> {
    const session = await this.prisma.workoutSession.findFirst({
      where: { assignmentId, userId },
    });
    if (!session)
      throw new NotFoundException('No active session for this assignment');
    if (session.status === 'completed') {
      throw new BadRequestException('Session is already completed');
    }

    // Deleted rather than kept as "abandoned" so a later Start Workout tap
    // creates a clean session instead of resuming a dead one.
    await this.prisma.workoutSession.delete({ where: { assignmentId } });
    await this.prisma.dailyAssignment.update({
      where: { id: assignmentId },
      data: { status: 'scheduled' },
    });
  }
}
