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

/**
 * One movement a `movements` slot prescribes, as authored (DN-19).
 *
 * Still authored: `line` is a progression line, not an exercise. Resolving it
 * to the exercise this athlete trains today needs their rung and their
 * equipment, neither of which belongs in a pure function — so this stays as
 * written and `PrescriptionService` does the rest.
 */
export type ProgramSlotMovement = {
  id: string;
  order: number;
  line: string | null;
  exerciseId: string | null;
  sets: number;
  reps: number;
  restSeconds: number;
};

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
  /** Empty on every kind but `movements` — see `resolveProgramDay`. */
  movements: ProgramSlotMovement[];
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
  /** A `movements` day: straight sets rather than a WOD (DN-19). */
  | {
      kind: 'prescribed';
      day: ProgramDayContext;
      movements: ProgramSlotMovement[];
    }
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

  if (slot.kind === 'movements' && slot.movements.length > 0) {
    // Ordered here rather than trusted from the query, so a caller that
    // forgets an `orderBy` still hands the athlete the session in the order
    // it was written -- which is the whole content of `order`.
    return {
      kind: 'prescribed',
      day,
      movements: [...slot.movements].sort((a, b) => a.order - b.order),
    };
  }

  // Everything else generates, which covers these cases on purpose:
  //
  //   - `wod_generated`, the ordinary one, with the slot's constraints.
  //   - a `movements` slot with nothing prescribed, and a `wod_pinned` slot
  //     whose WOD is somehow null. A CHECK makes the second unrepresentable
  //     and `planSlotSchema`'s refinement refuses to author the first, so
  //     neither is a case so much as a refusal to turn an impossible row into
  //     an empty screen. An athlete on such a day still trains.
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
 * Which axis a slot constrained, for reporting what the ladder gave up.
 *
 * Named after the `SlotConstraints` fields rather than prose, because these
 * end up in an operator's logs and the thing an operator then wants to do is
 * find the authored slot that set one.
 */
export type SlotAxis =
  'maxTimeCapMinutes' | 'wodType' | 'pattern' | 'allowNamed';

/**
 * The narrowed pool, and the axes the slot asked for that it could not get.
 *
 * `relaxed` is the point of the pair. A pool on its own cannot say whether it
 * is what the program wanted or what was left after the ladder gave up, and
 * those are very different facts: the second one is a library hole, and it
 * stays invisible until something reports it (DN-14).
 */
export type NarrowedPool<C> = {
  candidates: C[];
  /**
   * Dropped axes, outermost first — the order the ladder gave them up in.
   * Empty when the slot was satisfied exactly as authored, which is the
   * ordinary case and the one that should stay silent.
   *
   * Only axes the slot actually constrained appear here. Dropping a null
   * axis costs nothing and asked for nothing, so reporting it would bury the
   * real holes in noise from every unconstrained slot.
   */
  relaxed: SlotAxis[];
};

/**
 * The ladder, outermost (given up first) to innermost (protected longest).
 *
 * ## The order is settled (DN-14), and this is the losing argument
 *
 * DN-14 originally specified the opposite at the sharp end —
 * `wodType → maxTimeCapMinutes → allowNamed → pattern`, protecting `pattern`
 * longest — and the reasoning was good: **the emphasis is the program's
 * intent.** A pull day that hands over a squat workout is not the session the
 * author wrote, and on that view a named on-pattern WOD is the lesser
 * compromise.
 *
 * It lost to this: `allowNamed` is the only axis that exists to prevent a
 * *surprise* rather than to express a preference. An author who turned
 * benchmarks off did it so Fran does not land in the middle of a progression
 * block, and an athlete who gets one anyway has been handed a maximal effort
 * they did not plan for. An off-pattern WOD, by contrast, is a normal
 * training day that is not the one the program wanted — disappointing, not
 * disruptive. So the axis protecting against harm outranks the axis
 * protecting intent.
 *
 * Both arguments are real; this records which one won so it is not quietly
 * re-flipped. The `maxTimeCapMinutes`/`wodType` order at the front is the
 * same question in miniature and matters much less — either is defensible,
 * and a time cap is the most cosmetic thing a slot can ask for.
 */
const SLOT_AXES: {
  axis: SlotAxis;
  /** Whether the slot asked anything of this axis at all. */
  constrains: (c: SlotConstraints) => boolean;
  matches: (wod: ConstrainableWod, c: SlotConstraints) => boolean;
}[] = [
  {
    axis: 'maxTimeCapMinutes',
    constrains: (c) => c.maxTimeCapMinutes !== null,
    matches: (wod, c) =>
      c.maxTimeCapMinutes === null || wod.timeCapMinutes <= c.maxTimeCapMinutes,
  },
  {
    axis: 'wodType',
    constrains: (c) => c.wodType !== null,
    matches: (wod, c) => c.wodType === null || wod.type === c.wodType,
  },
  {
    axis: 'pattern',
    constrains: (c) => c.pattern !== null,
    matches: (wod, c) =>
      c.pattern === null || wod.dominantPattern === c.pattern,
  },
  {
    // Constrained only when named WODs are *disallowed*: `allowNamed: true`
    // asks for nothing and so can never be relaxed.
    axis: 'allowNamed',
    constrains: (c) => !c.allowNamed,
    matches: (wod, c) => c.allowNamed || !wod.isNamed,
  },
];

/**
 * Narrows the candidate pool to what the slot asked for, dropping axes in a
 * stated order rather than ever handing back nothing.
 *
 * The order, and the argument that lost, are recorded on `SLOT_AXES` above.
 * This is the same discipline `applyEquipmentFloor` and `pickWod`'s own
 * relaxation ladder keep, for the same reason: the library is small, and an
 * athlete with no workout at all is a worse answer than an off-pattern one.
 *
 * Returns what it gave up alongside what it kept (DN-14). The ladder firing
 * is the app's best evidence of a library hole -- with no squat- or
 * hinge-dominant unnamed WODs seeded it fires today -- and a function that
 * returned only the pool left the caller unable to tell a satisfied slot from
 * an exhausted one.
 */
export function narrowToSlot<C extends ConstrainableWod>(
  candidates: C[],
  constraints: SlotConstraints,
): NarrowedPool<C> {
  for (let from = 0; from < SLOT_AXES.length; from++) {
    const kept = candidates.filter((c) =>
      SLOT_AXES.slice(from).every((a) => a.matches(c, constraints)),
    );
    if (kept.length > 0) {
      return { candidates: kept, relaxed: relaxedBefore(from, constraints) };
    }
  }
  // Every axis spent and still nothing -- which means the pool was empty to
  // begin with, since the last rung asks nothing of any candidate. Handing
  // back the pool keeps the never-throws promise, and everything the slot
  // asked for counts as given up.
  return {
    candidates,
    relaxed: relaxedBefore(SLOT_AXES.length, constraints),
  };
}

function relaxedBefore(from: number, constraints: SlotConstraints): SlotAxis[] {
  return SLOT_AXES.slice(0, from)
    .filter((a) => a.constrains(constraints))
    .map((a) => a.axis);
}
