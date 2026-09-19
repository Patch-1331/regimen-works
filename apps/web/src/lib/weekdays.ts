/**
 * The week as it is *shown*: Monday first.
 *
 * The numbers are `trainingDaysSchema`'s — 0 = Sunday, matching
 * `Date.getUTCDay()` — and this list is the only place the app reorders them.
 * That is what `packages/shared/src/schedule.ts` means by calling Monday-first
 * a display order rather than a second numbering: it converts at the point it
 * renders, and nowhere else (DN-12).
 *
 * Lifted out of `SettingsPage` when the first-run wizard grew a day picker of
 * its own (DN-15). Two copies of the display order would be two chances for
 * the same week to start on different days.
 */
export const WEEKDAYS: readonly { value: number; short: string; full: string }[] = [
  { value: 1, short: "Mon", full: "Monday" },
  { value: 2, short: "Tue", full: "Tuesday" },
  { value: 3, short: "Wed", full: "Wednesday" },
  { value: 4, short: "Thu", full: "Thursday" },
  { value: 5, short: "Fri", full: "Friday" },
  { value: 6, short: "Sat", full: "Saturday" },
  { value: 0, short: "Sun", full: "Sunday" },
];

/** The full day name for a weekday number, for prose rather than a button. */
export function weekdayName(value: number): string {
  return WEEKDAYS.find((d) => d.value === value)?.full ?? "";
}

/**
 * The browser's calendar date, as `YYYY-MM-DD`.
 *
 * Local rather than UTC, and for the same reason the API's `todayIsoDate` is:
 * `toISOString()` would call it tomorrow for part of the evening anywhere
 * ahead of UTC, and these strings are compared against dates the API decided
 * from the athlete's own day.
 */
export function localIsoDate(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
