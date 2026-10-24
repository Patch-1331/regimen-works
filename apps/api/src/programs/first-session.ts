import { addIsoDays, resolveRestSeconds } from '@regimen-works/shared';
import { fixedDaysOf } from '../setup/setup.logic';
import {
  resolveProgramDay,
  type ActiveProgram,
  type ProgramDay,
  type ProgramSlotMovement,
} from './program-day';

/**
 * What a program that has not started yet will hand over first (DN-200) —
 * pure, like `program-day.ts` beside it.
 *
 * Today before the start date says when the run begins and what its first
 * session is. "First" is asked of `resolveProgramDay` itself, one date at a
 * time from the start, so the answer is the day the athlete will actually be
 * handed rather than a second reading of the slot layout that could disagree
 * with it.
 */

/** A program day that carries a session: not rest, not a fallback. */
export type SessionDay = Extract<
  ProgramDay,
  { kind: 'pinned' | 'prescribed' | 'generated' }
>;

/**
 * Two weeks is far enough for any week that trains at all: a run's first
 * session falls in its first week unless that week is all rest, and a
 * program whose first fortnight is all rest has no first session worth
 * naming.
 */
const LOOKAHEAD_DAYS = 14;

export function firstSessionDay(
  program: ActiveProgram,
  trainingDays: number[],
): { date: string; day: SessionDay } | null {
  for (let offset = 0; offset < LOOKAHEAD_DAYS; offset++) {
    const date = addIsoDays(program.startDate, offset);
    // Nothing has been trained on the run yet, so no weekday is completed.
    const day = resolveProgramDay(program, trainingDays, date, []);
    if (
      day.kind === 'pinned' ||
      day.kind === 'prescribed' ||
      day.kind === 'generated'
    ) {
      return { date, day };
    }
  }
  return null;
}

/**
 * The days the run trains: the athlete's own under a flexible program, the
 * first week's slot layout under a fixed one — the same reading setup's
 * picker makes, through the same function.
 */
export function runTrainingDays(
  program: ActiveProgram,
  trainingDays: number[],
): number[] {
  return program.scheduleMode === 'fixed'
    ? fixedDaysOf({
        scheduleMode: program.scheduleMode,
        weeks: program.authoredWeeks,
      })
    : [...trainingDays].sort((a, b) => a - b);
}

/** A set's working time, for the estimate only. Nothing is timed against it. */
const WORK_SECONDS_PER_SET = 45;

/**
 * The rest counted where nobody stated one. An estimate has to count
 * something, and counting nothing would promise a session shorter than any
 * athlete trains it -- but this never reaches a clock, which is where a null
 * rest has to stay null (ADR 0005).
 */
const UNSTATED_REST_SECONDS = 60;

/**
 * Roughly how long a day of straight sets takes, in whole minutes rounded to
 * five: "about 35 minutes" is a promise of scale, not of a finish time.
 */
export function prescribedMinutes(
  movements: ProgramSlotMovement[],
  defaultRestSeconds: number | null,
): number {
  let seconds = 0;
  for (const movement of movements) {
    movement.sets.forEach((set, i) => {
      const rest = resolveRestSeconds(
        defaultRestSeconds,
        set.restSeconds,
        i < movement.sets.length - 1 ? 'between_sets' : 'after_line',
      );
      seconds += WORK_SECONDS_PER_SET + (rest ?? UNSTATED_REST_SECONDS);
    });
  }
  return Math.max(5, Math.round(seconds / 60 / 5) * 5);
}
