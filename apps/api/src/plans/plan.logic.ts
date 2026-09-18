import { getWeekRange } from '../scheduler/scheduler.logic';

/**
 * Pure program logic (DN-11) — no DB, no Date.now(), no Math.random() baked
 * in, mirroring scheduler.logic.ts. Everything comes in as arguments, so the
 * same code that decides today's slot also renders a program's whole calendar
 * as a preview before the athlete enrols, with no writes.
 */

/** `phase` is what lets a program scale to a length the athlete chose. */
export type AuthoredWeek = {
  order: number;
  phase: string; // intro | core | peak
};

/** Enough of a slot to find it by weekday; callers keep their own extra fields. */
export type AuthoredSlot = {
  dayOfWeek: number; // 0 = Sunday … 6 = Saturday
};

/**
 * Plays `weeks` out to exactly `chosenWeeks` entries: the intro weeks in
 * order, the core block cycled to fill the middle, then the peak weeks.
 *
 * Core weeks cycle **in order** — A B C A B C, never shuffled. That is the
 * whole mechanism behind authored overload: a program gets harder because its
 * author wrote a core block that already waves (3x5, 4x5, 5x5), and the
 * repetition replays the wave. Shuffle the block and the wave flattens into
 * noise, which is why this is a constraint rather than a preference.
 *
 * Returns a new array of the same week objects, so one authored week appearing
 * three times is the same object three times. Callers index the result
 * positionally; the authored `order` is not the week the athlete is in.
 *
 * Never throws. Two shapes return fewer than `chosenWeeks` entries because
 * nothing else is truthful:
 *
 *   - a program with no core weeks at all has nothing to cycle, so it plays
 *     its intro and peak once and stops. `minimumViableWeeks` is what stops a
 *     plan being authored that way.
 *   - a `chosenWeeks` below zero, or an empty `weeks`, gives an empty result.
 */
export function expandPlanWeeks<W extends AuthoredWeek>(
  weeks: W[],
  chosenWeeks: number,
): W[] {
  // Zero would fall through to an empty result on its own -- the mutation
  // sweep (DN-11) confirms the branch is redundant for it. It is written as
  // <= rather than < because the guard is here to say what a nonsensical
  // length gives you, and reading it as "no weeks asked for, no weeks back"
  // should not require tracing truncateToFit to be sure.
  if (chosenWeeks <= 0) return [];

  // Sorted here rather than trusted from the caller: the order the rows come
  // back in is the database's business, and playing a wave out of sequence is
  // exactly the failure this function exists to prevent.
  const authored = [...weeks].sort((a, b) => a.order - b.order);
  const intro = authored.filter((w) => w.phase === 'intro');
  const core = authored.filter((w) => w.phase === 'core');
  const peak = authored.filter((w) => w.phase === 'peak');

  if (intro.length + peak.length > chosenWeeks) {
    return truncateToFit(intro, peak, chosenWeeks);
  }

  const fill = chosenWeeks - intro.length - peak.length;
  const middle = core.length === 0 ? [] : cycle(core, fill);
  return [...intro, ...middle, ...peak];
}

/**
 * What survives when the athlete picked a length too short to hold even the
 * bookends. Intro goes first — a beginner ramp is the more skippable of the
 * two — and only then is peak cut into.
 *
 * Both are trimmed from the front, because both build towards something: the
 * last intro week is the one that hands over to the core block, and the last
 * peak week is the finish the program was written for.
 */
function truncateToFit<W>(intro: W[], peak: W[], chosenWeeks: number): W[] {
  const keptPeak = peak.slice(Math.max(0, peak.length - chosenWeeks));
  const roomForIntro = chosenWeeks - keptPeak.length;
  const keptIntro = intro.slice(Math.max(0, intro.length - roomForIntro));
  return [...keptIntro, ...keptPeak];
}

function cycle<W>(block: W[], count: number): W[] {
  return Array.from({ length: count }, (_, i) => block[i % block.length]);
}

/**
 * The shortest run that plays every authored week at least once: intro, one
 * whole core block, then peak.
 *
 * A `Plan.minWeeks` below this lets the athlete pick a length that ends
 * partway through the core block — on whichever week of the wave happens to
 * fall last, which is as likely to be a light one as a heavy one. A program
 * that can finish on its deload week is not a program.
 *
 * Kept as a number rather than a validator so the caller says what it wants
 * with it: DN-13's seed asserts on it, and the Program-Editor will refuse a
 * plan below it with a message naming the figure.
 */
export function minimumViableWeeks(weeks: AuthoredWeek[]): number {
  // Counted by phase rather than as weeks.length, so it stays the number
  // `expandPlanWeeks` would actually play. A week carrying some other phase is
  // dropped there and must not be charged for here -- the two functions
  // disagreeing about how long a program is would be worse than either being
  // wrong on its own.
  return weeks.filter((w) => PHASES.includes(w.phase)).length;
}

const PHASES = ['intro', 'core', 'peak'];

/** The athlete's run, reduced to what resolving a date needs. */
export type EnrollmentWindow = {
  startDate: string; // ISO date, YYYY-MM-DD
  /** Null for an open-ended program, which cycles its weeks and never ends. */
  weeks: number | null;
};

export type SlotResolution<S> =
  /** The program has not begun. `getToday` falls back to Just WODs (DN-16). */
  | { status: 'before-start' }
  /** Past the last day. The enrollment completes and Just WODs resumes. */
  | { status: 'past-end' }
  | {
      status: 'scheduled';
      slot: S;
      weekIndex: number;
      /** Days since the start date. This is what DailyAssignment.planDayIndex stores. */
      dayIndex: number;
    }
  /**
   * Inside the program, but this week authors nothing for this weekday — a
   * four-day week says nothing about Wednesday. Read by DN-16 the same way an
   * authored `rest` slot is; it is a separate status only because "the author
   * said rest" and "the author said nothing" are different facts about the
   * program, and folding them together loses one of them at the point where a
   * program-editor would want to show it.
   */
  | { status: 'unscheduled'; weekIndex: number; dayIndex: number };

/**
 * Which slot a date falls on.
 *
 * The week is found by **calendar** week, not by counting sevens from the
 * start date, and the day by its calendar weekday. The two cannot coexist: a
 * Mon/Tue/Thu/Fri program means nothing if week 1 begins on a Wednesday, and
 * both fixed programs and athlete-chosen training days are written in
 * weekdays. Program weeks therefore align to `getWeekRange`'s Mon–Sun, and a
 * mid-week start simply gives a short first week — the days before it fall
 * back to Just WODs like any other pre-start day.
 *
 * `expandedWeeks` is the output of `expandPlanWeeks`, or the authored weeks
 * as they are when the enrollment is open-ended.
 */
export function resolveSlotForDate<S extends AuthoredSlot>(
  enrollment: EnrollmentWindow,
  expandedWeeks: { slots: S[] }[],
  date: string,
): SlotResolution<S> {
  if (date < enrollment.startDate) return { status: 'before-start' };
  if (expandedWeeks.length === 0) return { status: 'past-end' };

  const weekIndex = weeksBetween(enrollment.startDate, date);
  const dayIndex = daysBetween(enrollment.startDate, date);

  // An open-ended program has no last day to run past, so its weeks cycle
  // rather than run out. This is how Just WODs -- one authored week, replayed
  // forever -- is a program like any other rather than the absence of one.
  const openEnded = enrollment.weeks === null;
  if (!openEnded && weekIndex >= expandedWeeks.length) {
    return { status: 'past-end' };
  }

  const week = expandedWeeks[weekIndex % expandedWeeks.length];
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  const slot = week.slots.find((s) => s.dayOfWeek === weekday);

  return slot
    ? { status: 'scheduled', slot, weekIndex, dayIndex }
    : { status: 'unscheduled', weekIndex, dayIndex };
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Whole calendar weeks between the two dates' Mondays. */
function weeksBetween(from: string, to: string): number {
  const fromMonday = Date.parse(`${getWeekRange(from).start}T00:00:00Z`);
  const toMonday = Date.parse(`${getWeekRange(to).start}T00:00:00Z`);
  return Math.round((toMonday - fromMonday) / (7 * MS_PER_DAY));
}

function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      MS_PER_DAY,
  );
}
