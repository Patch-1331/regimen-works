import { expandPlanWeeks, resolveSlotForDate } from './plan.logic';

/**
 * What a program makes of one date (DN-16) — pure, like `plan.logic.ts` and
 * `scheduler.logic.ts`. No DB, no clock, no randomness.
 *
 * This is the fork `getToday` used to not have. It exists as its own function
 * so the interesting decisions -- which week, whose schedule decides the day,
 * what happens past the end -- are unit-testable without a database, and so
 * the service is left doing what a service should: fetching rows, writing
 * rows, and asking this what today is.
 */

/** Enough of an authored slot to decide and then record the day. */
export type ProgramSlot = {
  id: string;
  dayOfWeek: number;
  kind: string;
  wodId: string | null;
  pattern: string | null;
  wodType: string | null;
  allowNamed: boolean;
  maxTimeCapMinutes: number | null;
};

export type ProgramWeek = {
  order: number;
  phase: string;
  label: string | null;
  slots: ProgramSlot[];
};

/** The athlete's active enrollment, flattened to what deciding a day needs. */
export type ActiveProgram = {
  enrollmentId: string;
  planId: string;
  planName: string;
  scheduleMode: string; // fixed | flexible
  startDate: string;
  /** The run's length. Null for an open-ended program, which never completes. */
  weeks: number | null;
  authoredWeeks: ProgramWeek[];
};

/** The `wod_generated` axes, as authored. A null skips its axis. */
export type SlotConstraints = {
  pattern: string | null;
  wodType: string | null;
  allowNamed: boolean;
  maxTimeCapMinutes: number | null;
};

/**
 * Where the athlete is, for the today response's `plan` block and for the
 * three columns the assignment records.
 */
export type ProgramDayContext = {
  enrollmentId: string;
  planId: string;
  planName: string;
  /** 1-based — the number an athlete reads. `weekIndex` everywhere else is not. */
  week: number;
  totalWeeks: number | null;
  weekLabel: string | null;
  /**
   * What the program makes of today, or null when it makes nothing of it:
   * either the week authors no slot for this weekday, or the program is
   * flexible and today is not one the athlete trains. Both are a different
   * fact from an authored `rest`, and the rest-day copy says so.
   */
  slotKind: string | null;
  planSlotId: string | null;
  /** Days since the start date. This is what `DailyAssignment.planDayIndex` stores. */
  planDayIndex: number;
};

export type ProgramDay =
  /**
   * No program is deciding today, so `getToday` keeps exactly its pre-programs
   * behaviour. `before-start` is how the gap between enrolling and starting
   * fills itself: one active enrollment, no status-flipping job, and the rule
   * is just `date < startDate`.
   */
  | { kind: 'fallback'; reason: 'no-enrollment' | 'before-start' }
  /** Past the last day. The caller completes the enrollment, then falls back. */
  | { kind: 'completed'; enrollmentId: string }
  | { kind: 'rest'; day: ProgramDayContext }
  | { kind: 'pinned'; day: ProgramDayContext; wodId: string }
  | { kind: 'generated'; day: ProgramDayContext; constraints: SlotConstraints };

const UNCONSTRAINED: SlotConstraints = {
  pattern: null,
  wodType: null,
  allowNamed: true,
  maxTimeCapMinutes: null,
};

export function resolveProgramDay(
  program: ActiveProgram | null,
  trainingDays: number[],
  date: string,
): ProgramDay {
  if (!program) return { kind: 'fallback', reason: 'no-enrollment' };

  // An open-ended run plays its authored weeks as written and cycles them;
  // there is no chosen length to expand to. A bounded one is expanded first,
  // so `weekIndex` indexes the run the athlete is actually doing rather than
  // the block the author wrote.
  const expanded =
    program.weeks === null
      ? program.authoredWeeks
      : expandPlanWeeks(program.authoredWeeks, program.weeks);

  const resolution = resolveSlotForDate(
    { startDate: program.startDate, weeks: program.weeks },
    expanded,
    date,
  );

  if (resolution.status === 'before-start') {
    return { kind: 'fallback', reason: 'before-start' };
  }
  if (resolution.status === 'past-end') {
    return { kind: 'completed', enrollmentId: program.enrollmentId };
  }

  const week = expanded[resolution.weekIndex % expanded.length];
  const base = {
    enrollmentId: program.enrollmentId,
    planId: program.planId,
    planName: program.planName,
    week: resolution.weekIndex + 1,
    totalWeeks: program.weeks,
    weekLabel: week.label,
    planDayIndex: resolution.dayIndex,
  };

  if (resolution.status === 'unscheduled') {
    return {
      kind: 'rest',
      day: { ...base, slotKind: null, planSlotId: null },
    };
  }

  const slot = resolution.slot;

  // A flexible program has no opinion about *which* days are trained -- that
  // is the athlete's `trainingDays`, and it is the whole reason Just WODs can
  // author all seven weekdays without turning every day into a training day.
  // A fixed program's slot layout **is** the schedule: that is what lets it
  // insist on 48 hours between heavy pull days, which "4 days a week" cannot
  // say. So this is the one place the two modes genuinely diverge.
  if (program.scheduleMode !== 'fixed' && !trainsOn(trainingDays, date)) {
    return {
      // slotKind null, not the slot's own kind: today is a rest day because of
      // the athlete's schedule, not because the program planned one. Telling
      // them "planned rest" over a day they chose off would be the app taking
      // credit for their decision.
      kind: 'rest',
      day: { ...base, slotKind: null, planSlotId: slot.id },
    };
  }

  const day = { ...base, slotKind: slot.kind, planSlotId: slot.id };

  if (slot.kind === 'rest') return { kind: 'rest', day };

  if (slot.kind === 'wod_pinned' && slot.wodId !== null) {
    return { kind: 'pinned', day, wodId: slot.wodId };
  }

  // Everything else generates, which covers three cases on purpose:
  //
  //   - `wod_generated`, the ordinary one, with the slot's constraints.
  //   - `movements`, the Phase 4 kind that cannot be authored yet -- PlanSlot
  //     carries no prescription columns until DN-19. Stubbed as an
  //     unconstrained WOD so an athlete on such a day still trains; `slotKind`
  //     still reports `movements`, so the screen that learns to render it does
  //     not have to be told twice.
  //   - a `wod_pinned` slot whose WOD is somehow null. A CHECK makes that
  //     unrepresentable, so this is not a case so much as a refusal to turn an
  //     impossible row into a crash on the athlete's Today screen.
  return {
    kind: 'generated',
    day,
    constraints:
      slot.kind === 'wod_generated'
        ? {
            pattern: slot.pattern,
            wodType: slot.wodType,
            allowNamed: slot.allowNamed,
            maxTimeCapMinutes: slot.maxTimeCapMinutes,
          }
        : UNCONSTRAINED,
  };
}

function trainsOn(trainingDays: number[], date: string): boolean {
  return trainingDays.includes(new Date(`${date}T00:00:00Z`).getUTCDay());
}

/** A candidate, reduced to the axes a slot can constrain. */
export type ConstrainableWod = {
  dominantPattern: string;
  type: string;
  isNamed: boolean;
  timeCapMinutes: number;
};

/**
 * Narrows the candidate pool to what the slot asked for, dropping axes in a
 * stated order rather than ever handing back nothing.
 *
 * The order is what the program cares about least, first. A time cap is a
 * convenience; the format is a preference; the pattern is the session's
 * point. `allowNamed` goes last because it is the one protecting against a
 * surprise -- a benchmark landing in the middle of a progression block -- and
 * an author who turned it off meant it.
 *
 * This is the same discipline `applyEquipmentFloor` and `pickWod`'s
 * relaxation ladder keep, for the same reason: the library is small, and an
 * athlete with no workout at all is a worse answer than an off-pattern one.
 */
export function narrowToSlot<C extends ConstrainableWod>(
  candidates: C[],
  constraints: SlotConstraints,
): C[] {
  const axes = [
    (c: C) =>
      constraints.maxTimeCapMinutes === null ||
      c.timeCapMinutes <= constraints.maxTimeCapMinutes,
    (c: C) => constraints.wodType === null || c.type === constraints.wodType,
    (c: C) =>
      constraints.pattern === null || c.dominantPattern === constraints.pattern,
    (c: C) => constraints.allowNamed || !c.isNamed,
  ];

  for (let from = 0; from < axes.length; from++) {
    const kept = candidates.filter((c) =>
      axes.slice(from).every((axis) => axis(c)),
    );
    if (kept.length > 0) return kept;
  }
  return candidates;
}
