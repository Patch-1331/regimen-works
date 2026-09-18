/**
 * The local calendar date, as `YYYY-MM-DD`.
 *
 * Local and not UTC — this runs on the athlete's own machine, and
 * `toISOString()` would return yesterday's date for part of the evening in
 * any timezone ahead of UTC.
 *
 * Lifted out of `SchedulerController` (DN-13) once provisioning needed the
 * same answer for a new enrollment's start date. Two functions deciding what
 * day it is, in an app where `DailyAssignment.date` and
 * `PlanEnrollment.startDate` are compared as strings, is two chances to
 * disagree about whether a program has started.
 */
export function todayIsoDate(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
