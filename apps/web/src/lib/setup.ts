import { addIsoDays } from "@regimen-works/shared";
import type { SetupProgram } from "@regimen-works/shared";
import type { RestDraft } from "./rest";
import { WEEKDAYS } from "./weekdays";

/**
 * What the first-run wizard works out for itself (DN-15).
 *
 * The API is the authority on every one of these rules and re-checks all of
 * them on commit. These exist so the athlete finds out on the screen that
 * asked rather than two screens later — a wizard that accepts four days and
 * then refuses the whole setup has asked a question it was never going to
 * take the answer to.
 */

/**
 * Why the chosen days will not do, in the same words the API would use, or
 * null if they will.
 *
 * Deliberately the same sentences: the athlete should not be able to tell
 * which layer refused them, and a second wording would be a second rule the
 * moment either changed.
 */
export function dayCountWarning(
  program: SetupProgram,
  days: number[],
): string | null {
  // A fixed program's days are not the athlete's to get wrong.
  if (program.scheduleMode === "fixed") return null;

  // Before the program's own minimum, because an empty week is not a cadence
  // the app has anywhere to put -- "at least one" is true of every program
  // and is what the athlete has actually done wrong.
  if (days.length === 0) return "Pick at least one day.";

  const { minDaysPerWeek: min, maxDaysPerWeek: max } = program;
  if (min !== null && days.length < min) {
    return `${program.name} needs at least ${dayCount(min)} a week.`;
  }
  if (max !== null && days.length > max) {
    return `${program.name} runs at most ${dayCount(max)} a week.`;
  }
  return null;
}

/**
 * "3 days", or "1 day".
 *
 * One helper for both sentences rather than the same ternary twice. Only the
 * maximum can actually reach the singular — a minimum of one is unreachable,
 * because an empty week is refused a group earlier — so a second copy would be
 * one nobody could ever see get it wrong.
 */
function dayCount(days: number): string {
  return `${days} ${days === 1 ? "day" : "days"}`;
}

/**
 * Every date the picker offers, earliest first.
 *
 * Built by walking forward from the earliest date rather than by counting
 * three weeks here, so the grid can never offer a date the API would refuse:
 * both ends come from the same response.
 */
export function startDateChoices(
  earliestStartDate: string,
  latestStartDate: string,
): string[] {
  const dates: string[] = [];
  for (
    let date = earliestStartDate;
    date <= latestStartDate;
    date = addIsoDays(date, 1)
  ) {
    dates.push(date);
  }
  return dates;
}

/**
 * The weekday an ISO date falls on, 0 = Sunday — the app's numbering.
 *
 * Parsed as UTC, like every other date in this app, so a date string means
 * the same weekday whatever the reader's offset. Rendering it as local time
 * is how a Monday becomes a Sunday for anyone west of UTC.
 */
export function weekdayOf(isoDate: string): number {
  return new Date(`${isoDate}T00:00:00Z`).getUTCDay();
}

/**
 * The start date as the athlete reads it: "Monday 21 September".
 *
 * `timeZone: "UTC"` for the same reason `weekdayOf` parses as UTC — without
 * it the date the API sent back is rendered as the evening before it.
 */
export function formatStartDate(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

/** The length the picker starts at, and the bounds it may move between. */
export function weeksChoice(program: SetupProgram): {
  min: number;
  max: number;
  start: number;
} | null {
  const { minWeeks, maxWeeks, defaultWeeks } = program;
  // All three are null together for an open-ended program, which has no
  // length to choose -- and the wizard shows no stepper at all rather than
  // one that cannot move.
  if (minWeeks === null || maxWeeks === null) return null;
  return { min: minWeeks, max: maxWeeks, start: defaultWeeks ?? minWeeks };
}

/**
 * Weekdays as prose, in the week's own order: "Monday, Tuesday, Thursday and
 * Friday".
 *
 * Ordered through `WEEKDAYS` rather than by number, because 0 is Sunday and a
 * numeric sort would open every list with the day the week ends on. This is
 * the same display order the day strip renders in — a readout that disagreed
 * with the buttons above it would be describing a different week (DN-124).
 */
export function listDays(days: number[]): string {
  const names = WEEKDAYS.filter((day) => days.includes(day.value)).map(
    (day) => day.full,
  );
  if (names.length <= 1) return names.join("");
  // "and" before the last, because this is a sentence rather than a list of
  // chips — the readout is read aloud by a screen reader either way.
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Why the rest pace will not do, in the API's words, or null if it will
 * (DN-143).
 *
 * Blank is fine wherever the program states every rest -- the athlete is then
 * choosing to train at its own -- and refused only where some movement states
 * none, because there blank would leave a clock with nothing to run.
 */
export function restPaceWarning(
  program: SetupProgram,
  draft: RestDraft,
): string | null {
  if (!program.hasStraightSets) return null;
  if (draft.kind === "invalid") {
    return "Rest is a whole number of seconds — 0 for straight through.";
  }
  if (draft.kind === "blank" && program.restPaceRequired) {
    return `${program.name} does not say how long to rest after every movement, so choose a rest for this run.`;
  }
  return null;
}
