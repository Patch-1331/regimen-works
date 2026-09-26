import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  AdvanceInterval,
  EditSetLogs,
  LogSet,
  RoundSplit,
  WodType,
  WorkoutSession,
  WorkoutSetLog as WorkoutSetLogDto,
} from '@regimen-works/shared';
import {
  finishSecondsAt,
  hasRepScheme,
  resolveIntervalConfig,
  straightSetsStateAt,
} from '@regimen-works/shared';
import { loadPrescribedSlot } from '../plans/prescribed-slot';
import { PrismaService } from '../prisma/prisma.service';
import {
  MovementResolutionService,
  resolvableMovementInclude,
} from '../scheduler/movement-resolution.service';
import {
  toRoundSplits,
  toSessionDto,
  toSessionMovements,
  toSetLogDto,
} from './session.mapper';
import {
  advanceInterval,
  mergeRoundSplit,
  snapshotMovements,
  snapshotPrescribedMovements,
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

    // A day with no WOD is either a prescribed one -- straight sets from a
    // program slot (DN-20) -- or a rest day. The prescription is loaded from
    // the slot the assignment already records rather than by resolving the
    // program day again: the assignment is what decided which slot today was,
    // and asking twice is two chances to disagree.
    const prescribed = assignment.wod
      ? null
      : await loadPrescribedSlot(this.prisma, assignment.planSlotId);
    if (!assignment.wod && !prescribed)
      throw new BadRequestException('Rest days have no workout to start');

    // Read once here and copied onto the session, exactly like capSeconds: the
    // workout runs under the rules it started with, so toggling the setting
    // mid-session can't change where its clock stops. Absent row means the
    // column default, which is on.
    const rule = await this.prisma.scheduleRule.findUnique({
      where: { userId },
    });

    // The same resolution the Today plate showed -- their standing choice, then the
    // day's swaps -- pinned down as the movements this session trained
    // (DN-90). Nothing else records it: the choice and the swap rows both keep
    // moving after today, so without this a past day re-reads as whatever
    // the settings say now.
    const movements = assignment.wod
      ? snapshotMovements(
          await this.resolution.resolve(
            userId,
            assignmentId,
            assignment.wod.movements,
          ),
        )
      : snapshotPrescribedMovements(
          await this.resolution.resolvePrescription(
            userId,
            assignmentId,
            prescribed!.movements,
          ),
        );

    await this.prisma.workoutSession.createMany({
      data: [
        {
          assignmentId,
          userId,
          // Null on a straight-sets day, which is untimed: there is no clock
          // over it to stop, so the athlete's own setting has nothing to act
          // on either.
          capSeconds: assignment.wod
            ? assignment.wod.timeCapMinutes * 60
            : null,
          autoStopAtCap: assignment.wod
            ? (rule?.autoStopAtCapEnabled ?? true)
            : false,
          roundSplits: [],
          movements,
          // 0, not null: the session has started and the athlete is on set
          // one. Null would say this is not a straight-sets session at all.
          setsCompleted: assignment.wod ? null : 0,
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
    if (
      session.capSeconds !== null &&
      session.autoStopAtCap &&
      round.atSeconds > session.capSeconds
    ) {
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
   * The prescribed movements of the slot this assignment records, or null
   * where the slot is not a straight-sets day (DN-20).
   *
   * `kind` is checked rather than inferred from the movements being there,
   * because a slot the athlete's own schedule turned into a rest day still
   * carries its authored movements. `resolveProgramDay` makes the same two
   * checks before it calls a day prescribed, and this is the same rule at the
   * other end of the request.
   */

  /**
   * Records a completed set on a straight-sets session (DN-20) -- the
   * autosave the round tap and the interval rollover already have, at the one
   * moment this screen has to write.
   *
   * `setsCompleted` is absolute rather than an increment, so a tap replayed
   * after a flaky connection writes the same number instead of counting the
   * set twice. That makes this idempotent by construction rather than by a
   * merge, which is what `mergeRoundSplit` needs a whole function for.
   */
  async logSet(
    userId: string,
    assignmentId: string,
    next: LogSet,
  ): Promise<WorkoutSession> {
    const session = await this.prisma.workoutSession.findFirst({
      where: { assignmentId, userId },
    });
    if (!session)
      throw new NotFoundException('No active session for this assignment');
    if (session.status !== 'in_progress') {
      throw new BadRequestException('Session is no longer in progress');
    }
    if (session.setsCompleted === null) {
      throw new BadRequestException('This session has no sets to log');
    }

    // The session's own snapshot, which is what the count indexes into --
    // the reason it is snapshotted at all. Past the last set is a client
    // bug rather than a state worth keeping, and the same refusal
    // `advanceInterval` makes one past the end of a sequence.
    const movements = toSessionMovements(session.movements);
    const { totalSets } = straightSetsStateAt(
      movements.map((m) => ({ sets: m.sets ?? 0 })),
      0,
    );
    if (next.setsCompleted > totalSets) {
      throw new BadRequestException(
        `Set ${next.setsCompleted} is past the end of this session`,
      );
    }

    // Never backwards. Two taps racing on a reconnect can arrive out of
    // order, and the later-arriving earlier count would otherwise put the
    // athlete back on a set they have already done.
    const setsCompleted = Math.max(session.setsCompleted, next.setsCompleted);

    // The set this post finished, or null where it finished none. A call that
    // repeats the current count is the screen skipping a rest, and one that
    // arrives late with an earlier count is a replay -- in both cases the row
    // for that set is already written, so there is nothing to record (DN-21).
    const finished =
      next.setsCompleted > session.setsCompleted ? next.setsCompleted : null;

    // Written with the counter rather than beside it: the count and the rows
    // are two readings of the same tap, and a session whose counter says six
    // sets over five rows is a record nobody can interpret.
    const updated = await this.prisma.$transaction(async (tx) => {
      if (finished !== null) {
        // The position of the set just finished -- `finished - 1` sets were
        // behind the athlete when they started it. Derived here rather than
        // sent, so a replayed tap maps to the same row and the client never
        // has to know how the counter resolves into a position.
        const at = straightSetsStateAt(
          movements.map((m) => ({ sets: m.sets ?? 0 })),
          finished - 1,
        );
        const movement = movements[at.movementIndex];
        // What the day asked for, copied whole rather than flattened to a
        // number (DN-142). A range recorded as its floor would have history
        // claim the day asked for 8 when it asked for 8-10.
        const prescribed = {
          prescribedReps: movement.reps,
          prescribedRepsMax: movement.repsMax,
          prescribedToFailure: movement.toFailure,
        };
        // The runner records the day as prescribed, so what the athlete did is
        // what they were asked for -- except on a set prescribed to failure,
        // which asked for no number. Null there rather than a guess: the app
        // did not witness the count, and 0 is already taken by "attempted and
        // not made". The athlete supplies it at log time, the way a corrected
        // set is supplied.
        const actualReps = movement.toFailure ? null : movement.reps;

        await tx.workoutSetLog.upsert({
          // Upsert rather than create because the counter is what decides a
          // set was finished, and two taps racing on a reconnect can both
          // read the same count before either has written. One of them
          // rewrites the row it was going to duplicate, instead of losing the
          // whole request to a unique-constraint violation. A replay that
          // arrives after the first has landed advances nothing and never
          // reaches here -- corrections are `editSetLogs`.
          where: {
            sessionId_movementOrder_setNumber: {
              sessionId: session.id,
              movementOrder: at.movementIndex,
              setNumber: at.setNumber,
            },
          },
          update: { actualReps },
          create: {
            userId,
            sessionId: session.id,
            movementOrder: at.movementIndex,
            setNumber: at.setNumber,
            exerciseId: movement.exercise.id,
            ...prescribed,
            // The runner records the day as prescribed. It is asking the
            // athlete to count reps mid-set that would cost more than the
            // reading is worth, so a set that did not go as asked is
            // corrected at log time through `editSetLogs`.
            actualReps,
          },
        });
      }

      return tx.workoutSession.update({
        where: { assignmentId },
        data: {
          setsCompleted,
          restStartedAtSeconds: next.restStartedAtSeconds,
        },
      });
    });

    return toSessionDto(updated);
  }

  /**
   * Every set recorded against this session, in the order they were done.
   *
   * Ordered by position rather than by `completedAt`, because the position is
   * what the screen reading them lays out -- and a corrected row keeps its
   * place in the session rather than jumping to the end.
   */
  async setLogs(
    userId: string,
    assignmentId: string,
  ): Promise<WorkoutSetLogDto[]> {
    const session = await this.prisma.workoutSession.findFirst({
      where: { assignmentId, userId },
      select: { id: true },
    });
    // Not "active": these are read and corrected at log time, after the
    // session has finished.
    if (!session) throw new NotFoundException('No session for this assignment');

    const rows = await this.prisma.workoutSetLog.findMany({
      where: { sessionId: session.id, userId },
      orderBy: [{ movementOrder: 'asc' }, { setNumber: 'asc' }],
    });
    return rows.map(toSetLogDto);
  }

  /**
   * Corrects sets already recorded, at log time (DN-21).
   *
   * Updates only. The runner is what creates these rows, and a correction that
   * could conjure one would let the log screen claim a set no session ever
   * recorded -- "I did eight" on a day the athlete walked out after three.
   * `updateMany` per row rather than `update`, so the userId stays in the
   * where clause and another athlete's row reads as no row at all.
   */
  async editSetLogs(
    userId: string,
    assignmentId: string,
    body: EditSetLogs,
  ): Promise<WorkoutSetLogDto[]> {
    const session = await this.prisma.workoutSession.findFirst({
      where: { assignmentId, userId },
      select: { id: true },
    });
    // Not "active": these are read and corrected at log time, after the
    // session has finished.
    if (!session) throw new NotFoundException('No session for this assignment');

    await this.prisma.$transaction(
      body.sets.map((edit) =>
        this.prisma.workoutSetLog.updateMany({
          where: {
            sessionId: session.id,
            userId,
            movementOrder: edit.movementOrder,
            setNumber: edit.setNumber,
          },
          data: { actualReps: edit.actualReps },
        }),
      ),
    );

    return this.setLogs(userId, assignmentId);
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
    const finishedAtSeconds =
      session.autoStopAtCap && session.capSeconds !== null
        ? finishSecondsAt(elapsedSeconds, session.capSeconds)
        : // Nothing stopped this clock -- either the athlete opted out, or the
          // session is untimed (DN-20) and never had one. How long they took is
          // the honest answer in both cases; it is not a score on a straight-sets
          // day, but it is still what happened.
          Math.floor(elapsedSeconds);

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
