import { Injectable } from '@nestjs/common';
import {
  PRESCRIBED_DAY_NAME,
  sessionMovementSchema,
  type ExerciseUnit,
  type MovementHistory,
  type MovementVolume,
} from '@regimen-works/shared';
import { PrismaService } from '../prisma/prisma.service';
import { buildMovementHistory, type TrainedDay } from './history.logic';
import { buildMovementVolume, type RecordedSet } from './volume.logic';

/** How far back one request reads. Bounded so the answer cannot grow without limit. */
const MAX_SESSIONS = 200;

@Injectable()
export class HistoryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every movement this athlete has trained, newest first (DN-89).
   *
   * Only completed sessions count. An abandoned or still-running one records
   * what was *prescribed* that day and nothing about how much of it was done,
   * so counting it would report work that may never have happened -- and this
   * screen's whole claim is that it reports what happened.
   */
  async movements(userId: string): Promise<MovementHistory[]> {
    const sessions = await this.prisma.workoutSession.findMany({
      where: { userId, status: 'completed' },
      orderBy: { assignment: { date: 'desc' } },
      take: MAX_SESSIONS,
      select: {
        movements: true,
        assignment: { select: { date: true, wod: { select: { name: true } } } },
      },
    });

    const days = sessions.flatMap<TrainedDay>((session) => {
      // A session belongs to a WOD or to a prescribed day (DN-126), and the
      // second kind has no name of its own. Named rather than skipped: the
      // work was done, and a history that quietly omits every strength day is
      // telling the athlete they did not train on it. "Strength" is what
      // Today calls the day, so the two screens agree.
      const name = session.assignment.wod?.name ?? PRESCRIBED_DAY_NAME;

      // Parsed rather than cast: the column is jsonb written by this app, but
      // it holds rows written by older versions of it. A snapshot that no
      // longer parses is dropped -- the same quiet degrading every resolution
      // layer does -- because a history that throws tells the athlete nothing
      // at all about the days that are fine.
      const parsed = sessionMovementSchema.array().safeParse(session.movements);
      if (!parsed.success || parsed.data.length === 0) return [];

      return [{ date: session.assignment.date, name, movements: parsed.data }];
    });

    return buildMovementHistory(days);
  }

  /**
   * What each movement has actually been trained at, session by session
   * (DN-22).
   *
   * Read from `WorkoutSetLog` rather than from the snapshots `movements()`
   * uses, because the question is different: a snapshot says what the day
   * prescribed, and this says what came out of it.
   *
   * Every session counts, including one still running. The rows are sets that
   * were done -- a day the athlete abandoned halfway still happened, and
   * dropping it would show a gap where there was training.
   *
   * Bounded by sessions rather than by rows, so the oldest one in the answer
   * is whole: a row limit would cut a session in half and report a five-set
   * day as a two-set one.
   */
  async movementVolume(userId: string): Promise<MovementVolume[]> {
    const sessions = await this.prisma.workoutSession.findMany({
      where: { userId, setLogs: { some: {} } },
      orderBy: { assignment: { date: 'desc' } },
      take: MAX_SESSIONS,
      select: {
        id: true,
        assignmentId: true,
        assignment: { select: { date: true } },
      },
    });
    if (sessions.length === 0) return [];

    const rows = await this.prisma.workoutSetLog.findMany({
      // Sets with no recorded count are left out (DN-142). This history is
      // what came *out* of the sessions, and a set prescribed to failure holds
      // no number until the athlete supplies one at log time -- counting it as
      // 0 would report a set attempted and not made, which is a different
      // fact. It joins the history the moment they enter the count.
      where: {
        userId,
        sessionId: { in: sessions.map((s) => s.id) },
        actualReps: { not: null },
      },
      select: {
        sessionId: true,
        movementOrder: true,
        setNumber: true,
        actualReps: true,
        exercise: { select: { id: true, name: true, unit: true } },
      },
    });

    const byId = new Map(sessions.map((s) => [s.id, s]));
    const recorded = rows.map<RecordedSet>((row) => {
      const session = byId.get(row.sessionId)!;
      return {
        exerciseId: row.exercise.id,
        name: row.exercise.name,
        // A plain column, narrowed the same way `snapshotMovements` does --
        // the enum is enforced where an exercise is written, not read.
        unit: row.exercise.unit as ExerciseUnit,
        date: session.assignment.date,
        assignmentId: session.assignmentId,
        movementOrder: row.movementOrder,
        setNumber: row.setNumber,
        // Non-null by the `where` above; Prisma cannot narrow a filtered
        // column, so the assertion is where the filter's promise is cashed.
        actualReps: row.actualReps!,
      };
    });

    return buildMovementVolume(recorded);
  }
}
