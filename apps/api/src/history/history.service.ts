import { Injectable } from '@nestjs/common';
import {
  PRESCRIBED_DAY_NAME,
  sessionMovementSchema,
  type MovementHistory,
} from '@regimen-works/shared';
import { PrismaService } from '../prisma/prisma.service';
import { buildMovementHistory, type TrainedDay } from './history.logic';

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
}
