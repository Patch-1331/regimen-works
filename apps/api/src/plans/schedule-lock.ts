import type { ScheduleLock } from '@regimen-works/shared';
import { expandPlanWeeks, resolveSlotForDate } from './plan.logic';
import type { ActiveProgram } from './program-day';

/**
 * Whether a program is currently driving the athlete's week, and with which
 * days (DN-118) — pure, like `program-day.ts` beside it.
 *
 * `resolveProgramDay` answers "what is today"; this answers "whose schedule is
 * this". They are close enough to share a program and far enough apart to be
 * separate functions: one returns a workout, the other returns a sentence for
 * the settings screen, and folding them together would make the settings
 * endpoint resolve a slot it has no use for.
 */
export function resolveScheduleLock(
  program: ActiveProgram | null,
  date: string,
): ScheduleLock | null {
  // Flexible is the ordinary case and deliberately so: Just WODs is flexible
  // precisely so that enrolling everyone in it (DN-13) does not take anyone's
  // schedule away from them.
  if (!program || program.scheduleMode !== 'fixed') return null;

  const expanded =
    program.weeks === null
      ? program.authoredWeeks
      : expandPlanWeeks(program.authoredWeeks, program.weeks);

  // Resolved rather than computed by hand, so "which week is the athlete in"
  // has exactly one answer in this codebase -- the one `getToday` uses. The
  // slot it finds is beside the point here; the week it found it in is not.
  const resolution = resolveSlotForDate(
    { startDate: program.startDate, weeks: program.weeks },
    expanded,
    date,
  );

  // Before the start the athlete is still on their own days -- that gap is
  // the whole reason enrolling on Thursday to start Monday needs no second
  // enrollment (DN-11). Past the end the run is over and `getToday` will
  // retire it on the next request; reporting it as locked in the meantime
  // would be locking a week to a program that has stopped.
  if (
    resolution.status === 'before-start' ||
    resolution.status === 'past-end'
  ) {
    return null;
  }

  const week = expanded[resolution.weekIndex % expanded.length];

  return {
    planId: program.planId,
    planName: program.planName,
    // Rest is authored, so a rest slot is a day the program has decided the
    // athlete does not train -- it belongs out of this list as squarely as a
    // weekday the week says nothing about. Both are "not a training day", and
    // the settings screen has no use for the distinction the scheduler draws.
    days: week.slots
      .filter((slot) => slot.kind !== 'rest')
      .map((slot) => slot.dayOfWeek)
      .sort((a, b) => a - b),
  };
}
