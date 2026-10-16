import type { EnrollmentStatus, ProgramRun } from '@regimen-works/shared';
import { weekOfRun } from '../programs/program.logic';

/** A run as read from the database, flattened to what the Programs tab needs. */
export type RunRow = {
  id: string;
  programId: string;
  status: string;
  startDate: string;
  weeks: number | null;
  completedAt: Date | null;
  endedAt: Date | null;
  program: { name: string; summary: string };
};

/**
 * One run, as the Programs tab lists it (DN-179), with no database and no
 * clock -- `today` is the caller's.
 *
 * The week is the one thing worked out here, and it is never stored (ADR
 * 0009): the current run's is today's week, an ended run's is the week its
 * `endedAt` fell in, and a finished run reached its last. Clamped to the
 * run's length, because an athlete who ends a six-week run on the Sunday it
 * was due to finish is still in week 6, and to 1, because a run cannot have
 * reached a week before its first.
 */
export function toProgramRun(row: RunRow, today: string): ProgramRun {
  // Narrowed at the read site, the way `scheduleMode` is: the column is
  // plain text written only by this app.
  const status = row.status as EnrollmentStatus;
  const finishedAt =
    status === 'completed'
      ? row.completedAt
      : status === 'ended'
        ? row.endedAt
        : null;

  return {
    enrollmentId: row.id,
    programId: row.programId,
    programName: row.program.name,
    programSummary: row.program.summary,
    status,
    startDate: row.startDate,
    totalWeeks: row.weeks,
    week: weekReached(row, status, finishedAt, today),
    finishedAt: finishedAt?.toISOString() ?? null,
  };
}

function weekReached(
  row: RunRow,
  status: EnrollmentStatus,
  finishedAt: Date | null,
  today: string,
): number | null {
  if (status === 'completed' && row.weeks !== null) return row.weeks;

  // A timestamp's UTC date. The athlete's own calendar day is not stored
  // with it, and the difference matters only to a run ended within hours of
  // midnight on a Sunday.
  const on = finishedAt ? finishedAt.toISOString().slice(0, 10) : today;
  // Waiting for its start date: a run that has not begun is in no week.
  if (status === 'active' && on < row.startDate) return null;

  const week = Math.max(1, weekOfRun(row.startDate, on));
  return row.weeks === null ? week : Math.min(week, row.weeks);
}

/**
 * Past runs newest first, by when each finished or ended. Sorted here rather
 * than in the query because the two kinds keep that moment in different
 * columns.
 */
export function newestFirst(runs: ProgramRun[]): ProgramRun[] {
  return [...runs].sort((a, b) =>
    (b.finishedAt ?? '').localeCompare(a.finishedAt ?? ''),
  );
}
