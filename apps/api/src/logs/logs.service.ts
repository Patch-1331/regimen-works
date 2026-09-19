import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  LogResultRequest,
  WorkoutLog,
  WorkoutLogListItem,
} from '@regimen-works/shared';
import { PRESCRIBED_DAY_NAME, parseSetsResult } from '@regimen-works/shared';
import {
  loadPrescribedSlot,
  prescribedSetCount,
} from '../plans/prescribed-slot';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class LogsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates or replaces the log for an assignment, and marks it completed.
   *
   * Saving a result no longer moves any progression rung. The athlete owns
   * their level: they set it by swapping a movement before training, or by
   * confirming afterwards what they actually did. An inference drawn from
   * metcon rounds has no business overruling either, and the drop half of
   * that inference was actively harmful — a hard session quietly making the
   * next one easier without asking.
   */
  async upsert(
    userId: string,
    assignmentId: string,
    body: LogResultRequest,
  ): Promise<WorkoutLog> {
    // findFirst with userId, not findUnique on id alone: another user's
    // assignment id must read as "not found" rather than as someone else's row.
    const assignment = await this.prisma.dailyAssignment.findFirst({
      where: { id: assignmentId, userId },
      include: { wod: true },
    });
    if (!assignment) throw new NotFoundException('Assignment not found');

    // A day with no WOD is either a prescribed one -- straight sets from a
    // program slot (DN-126) -- or a rest day, which is the only one left with
    // nothing to log. Keyed off the slot rather than off a session, because a
    // WOD day can be logged without ever starting the timer and a strength
    // day should not be the one kind that insists you did.
    const prescribed =
      assignment.wodId && assignment.wod
        ? null
        : await loadPrescribedSlot(this.prisma, assignment.planSlotId);
    if (!assignment.wod && !prescribed)
      throw new BadRequestException('Rest days have nothing to log');

    if (prescribed) {
      if (body.resultType !== 'sets_completed')
        throw new BadRequestException(
          'A prescribed day is scored in sets, not against a clock',
        );

      const sets = parseSetsResult(body.resultValue);
      if (!sets)
        throw new BadRequestException(
          'A sets result reads "done/total", e.g. "6/8"',
        );

      // The denominator is checked against the day's own prescription rather
      // than trusted. Both halves come from the client, so without this a log
      // can claim eight sets of a five-set day -- and every later reading of
      // it, in History and in Stats, would be measuring against a number the
      // program never asked for.
      const total = prescribedSetCount(prescribed.movements);
      if (sets.total !== total)
        throw new BadRequestException(
          `This day prescribes ${total} sets, not ${sets.total}`,
        );
    } else if (body.resultType === 'sets_completed') {
      // The guard in the other direction, so the two kinds of result cannot
      // be filed under the wrong kind of day. A metcon counted in sets would
      // read as a strength session everywhere downstream.
      throw new BadRequestException(
        'A WOD is scored against the clock, not in sets',
      );
    }

    const data = {
      resultType: body.resultType,
      resultValue: body.resultValue,
      rpe: body.rpe ?? null,
      notes: body.notes ?? null,
    };

    const log = await this.prisma.workoutLog.upsert({
      where: { assignmentId },
      update: data,
      create: { assignmentId, userId, ...data },
    });

    await this.prisma.dailyAssignment.update({
      where: { id: assignmentId },
      data: { status: 'completed' },
    });

    return toLogDto(log);
  }

  async getForAssignment(
    userId: string,
    assignmentId: string,
  ): Promise<WorkoutLog | null> {
    const log = await this.prisma.workoutLog.findFirst({
      where: { assignmentId, userId },
    });
    return log ? toLogDto(log) : null;
  }

  async list(userId: string): Promise<WorkoutLogListItem[]> {
    const logs = await this.prisma.workoutLog.findMany({
      where: { userId },
      include: { assignment: { include: { wod: true } } },
      orderBy: { assignment: { date: 'desc' } },
    });

    // Nothing is filtered out any more. A log with no WOD is a prescribed day
    // (DN-126) -- `upsert` refuses to write one for any other kind of day, so
    // the absence of a WOD here *is* the strength session, not an unknown.
    // Dropping these was the old behaviour and it was the worse half of a
    // half-built feature: the athlete saved a result and History showed them
    // nothing, which reads as the app having lost it.
    return logs.map((log) => ({
      id: log.id,
      assignmentId: log.assignmentId,
      date: log.assignment.date,
      name: log.assignment.wod?.name ?? PRESCRIBED_DAY_NAME,
      wod: log.assignment.wod
        ? {
            type: log.assignment.wod.type as NonNullable<
              WorkoutLogListItem['wod']
            >['type'],
            dominantPattern: log.assignment.wod.dominantPattern as NonNullable<
              WorkoutLogListItem['wod']
            >['dominantPattern'],
          }
        : null,
      resultType: log.resultType as WorkoutLogListItem['resultType'],
      resultValue: log.resultValue,
      rpe: log.rpe,
      notes: log.notes,
    }));
  }
}

function toLogDto(log: {
  id: string;
  assignmentId: string;
  resultType: string;
  resultValue: string;
  rpe: number | null;
  notes: string | null;
}): WorkoutLog {
  return {
    id: log.id,
    assignmentId: log.assignmentId,
    resultType: log.resultType as WorkoutLog['resultType'],
    resultValue: log.resultValue,
    rpe: log.rpe,
    notes: log.notes,
  };
}
