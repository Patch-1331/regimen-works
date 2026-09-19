import { SETUP_START_DATE_DAYS, addIsoDays } from '@regimen-works/shared';
import type { CommitSetup } from '@regimen-works/shared';

/**
 * The first-run wizard's rules, with no database and no clock (DN-15) — the
 * same split as `scheduler.logic.ts`, and for the same reason: every rule
 * here is a sentence the athlete may end up reading, and a rule that can only
 * be exercised by seeding a user and rolling a date forward is a rule whose
 * wording nobody checks.
 */

/** The day bounds and length bounds a commit is judged against. */
export type SetupPlanBounds = {
  name: string;
  scheduleMode: string;
  minDaysPerWeek: number | null;
  maxDaysPerWeek: number | null;
  minWeeks: number | null;
  maxWeeks: number | null;
};

export type StartDateRange = {
  /**
   * The day the range was computed on. Not part of what `GET /setup` returns
   * -- the client already knows what day it is -- but kept here because
   * "you picked today and today is spoken for" and "you picked a date in the
   * past" are the same comparison and very different sentences.
   */
  today: string;
  earliestStartDate: string;
  latestStartDate: string;
};

/**
 * Which dates the athlete may start on.
 *
 * `todayIsTouched` is the whole of the today/tomorrow question: committing a
 * start date of today discards today's assignment so the first day of the
 * program is really its first day, and that is only safe while nothing has
 * been done on it. Once a session exists or a result is logged, today is a
 * day of training that happened, and the earliest a new program may begin is
 * tomorrow.
 *
 * Passed in rather than read here, so the rule can be tested at the boundary
 * without a database on either side of it.
 */
export function startDateRange(
  today: string,
  todayIsTouched: boolean,
): StartDateRange {
  const earliestStartDate = todayIsTouched ? addIsoDays(today, 1) : today;
  return {
    today,
    earliestStartDate,
    latestStartDate: addIsoDays(earliestStartDate, SETUP_START_DATE_DAYS - 1),
  };
}

/**
 * Which weekdays a program trains in its first week, 0 = Sunday, ascending.
 *
 * Rest is authored, so a rest slot is a day the program has decided the
 * athlete does not train — it belongs out of this list as squarely as a
 * weekday the week says nothing about, exactly as in `resolveScheduleLock`.
 *
 * Empty for a flexible program, which has no answer: its days are the
 * athlete's, and its `defaultDays` is where it suggests some.
 */
export function fixedDaysOf(plan: {
  scheduleMode: string;
  weeks: { order: number; slots: { dayOfWeek: number; kind: string }[] }[];
}): number[] {
  if (plan.scheduleMode !== 'fixed') return [];
  const first = [...plan.weeks].sort((a, b) => a.order - b.order)[0];
  if (!first) return [];
  const days = new Set(
    first.slots.filter((s) => s.kind !== 'rest').map((s) => s.dayOfWeek),
  );
  return [...days].sort((a, b) => a - b);
}

/**
 * What is wrong with these three answers, in the athlete's words, or null if
 * nothing is.
 *
 * One message rather than a list. The wizard asks one question per screen, so
 * there is exactly one place a complaint can be shown, and a payload that
 * breaks two rules at once is a client bug rather than an athlete who made
 * two mistakes — the screens themselves cannot produce one.
 */
export function setupRejection(
  plan: SetupPlanBounds,
  body: CommitSetup,
  range: StartDateRange,
): string | null {
  return (
    trainingDaysRejection(plan, body.trainingDays) ??
    weeksRejection(plan, body.weeks) ??
    startDateRejection(body.startDate, range)
  );
}

function trainingDaysRejection(
  plan: SetupPlanBounds,
  trainingDays: number[] | null,
): string | null {
  if (plan.scheduleMode === 'fixed') {
    // Refused rather than ignored. A client sending days for a fixed program
    // believes it is setting them, and storing nothing while answering 200
    // would leave it right about the request and wrong about the week.
    return trainingDays === null
      ? null
      : `${plan.name} sets its own training days, so there are none to choose.`;
  }

  if (trainingDays === null) return 'Pick the days you train.';

  // Both bounds are present on every flexible program -- the CHECK added in
  // DN-9's migration refuses one without the other -- but they are nullable
  // columns, so the narrowing is real rather than ceremonial.
  const { minDaysPerWeek: min, maxDaysPerWeek: max } = plan;
  if (min !== null && trainingDays.length < min) {
    return `${plan.name} needs at least ${min} ${dayWord(min)} a week.`;
  }
  if (max !== null && trainingDays.length > max) {
    return `${plan.name} runs at most ${max} ${dayWord(max)} a week.`;
  }
  return null;
}

function weeksRejection(
  plan: SetupPlanBounds,
  weeks: number | null,
): string | null {
  const { minWeeks: min, maxWeeks: max } = plan;

  // Open-ended: no length to choose, and a number on it would be a completion
  // date for a program that never completes.
  if (min === null || max === null) {
    return weeks === null
      ? null
      : `${plan.name} has no end, so there is no length to choose.`;
  }

  if (weeks === null) return `Choose how many weeks to run ${plan.name} for.`;
  if (weeks < min || weeks > max) {
    return `${plan.name} runs for between ${min} and ${max} weeks.`;
  }
  return null;
}

function startDateRejection(
  startDate: string,
  range: StartDateRange,
): string | null {
  // String comparison, because these are ISO dates and that is the same
  // comparison `date < startDate` makes everywhere else a program's start is
  // read (DN-16).
  if (startDate < range.earliestStartDate) {
    return startDate === range.today
      ? "Today's workout is already under way, so the earliest you can start is tomorrow."
      : 'That start date has already passed.';
  }
  if (startDate > range.latestStartDate) {
    return 'Pick a start date within the next three weeks.';
  }
  return null;
}

function dayWord(count: number): string {
  return count === 1 ? 'day' : 'days';
}
