import type {
  ExerciseUnit,
  MovementGroup,
  RoundSplit,
  SessionMovement,
  SubstitutionReason,
} from '@regimen-works/shared';

/** The resolved movement as the scheduler hands it over -- see MovementResolutionService. */
export type ResolvedMovementInput = {
  id: string;
  order: number;
  reps: number;
  repScheme: number[];
  isSwapped: boolean;
  prescribedName: string | null;
  prescribedReason: SubstitutionReason | null;
  exercise: {
    id: string;
    name: string;
    unit: string;
    movementGroup: string | null;
    sortOrder: number | null;
  };
};

/**
 * Pins the resolved movement list down as it stood when the session started
 * (DN-90). Copies rather than references: the point is that nothing which
 * moves afterwards -- the choice on record, the swap rows, an exercise's name
 * -- can change what this session says was trained.
 *
 * Only what history needs is kept. Coaching prose, equipment flags and the
 * alternative exercise id describe the movement in general, and stay on
 * Exercise; a row here is a fact about one day.
 */
export function snapshotMovements(
  movements: ResolvedMovementInput[],
): SessionMovement[] {
  return [...movements]
    .sort((a, b) => a.order - b.order)
    .map((m) => ({
      wodMovementId: m.id,
      planSlotMovementId: null,
      // A WOD movement has rounds, not sets. Null rather than zero, which
      // would read as a movement nobody was asked to do.
      sets: null,
      restSeconds: null,
      order: m.order,
      reps: m.reps,
      // A WOD is always the fixed shape (DN-142). "As many as you can" is a
      // format -- an AMRAP -- rather than a rep count, so no WOD movement
      // carries a range or a set worked to failure.
      repsMax: null,
      toFailure: false,
      repScheme: [...m.repScheme],
      isSwapped: m.isSwapped,
      prescribedName: m.prescribedName,
      prescribedReason: m.prescribedReason,
      exercise: {
        id: m.exercise.id,
        name: m.exercise.name,
        unit: m.exercise.unit as ExerciseUnit,
        movementGroup: m.exercise.movementGroup as MovementGroup | null,
        sortOrder: m.exercise.sortOrder,
      },
    }));
}

/**
 * Merges a newly-tapped round split into the existing list.
 *
 * A resubmission of the same round number (e.g. a retried request after a
 * flaky connection) replaces rather than duplicates, and the result is
 * always sorted by round number regardless of tap order — a locked screen
 * can deliver taps out of sequence once it reconnects.
 */
export function mergeRoundSplit(
  existing: RoundSplit[],
  next: RoundSplit,
): RoundSplit[] {
  const withoutThisRound = existing.filter((s) => s.round !== next.round);
  return [...withoutThisRound, next].sort((a, b) => a.round - b.round);
}

export type IntervalProgress = {
  roundSplits: RoundSplit[];
  intervalIndex: number;
  intervalStartedAtSeconds: number;
};

/**
 * Records an EMOM/Tabata interval rollover.
 *
 * `intervalIndex` is the 0-based interval now starting — so it doubles as
 * the count of intervals already behind the athlete, and each rollover
 * closes out the one before it as a round split. That keeps the interval
 * screen feeding the same `roundSplits` the AMRAP screen does, so the
 * result prefill and history read an EMOM without knowing it was one.
 *
 * Starting interval 0 closes nothing, and a replayed rollover (a retried
 * request, or two ticks racing on a reconnect) rewrites the same split
 * rather than adding one — see mergeRoundSplit.
 */
export function advanceInterval(
  existing: RoundSplit[],
  next: { intervalIndex: number; atSeconds: number },
): IntervalProgress {
  const roundSplits =
    next.intervalIndex > 0
      ? mergeRoundSplit(existing, {
          round: next.intervalIndex,
          atSeconds: next.atSeconds,
        })
      : existing;

  return {
    roundSplits,
    intervalIndex: next.intervalIndex,
    intervalStartedAtSeconds: next.atSeconds,
  };
}

/** The resolved prescribed movement, as `resolvePrescription` hands it over. */
export type ResolvedPrescribedInput = {
  id: string;
  order: number;
  sets: number;
  /** The prescribed count, in all three of its shapes — see `repShapeFields`. */
  reps: number | null;
  repsMax: number | null;
  toFailure: boolean;
  restSeconds: number;
  isSwapped: boolean;
  prescribedName: string | null;
  prescribedReason: SubstitutionReason | null;
  exercise: {
    id: string;
    name: string;
    unit: string;
    movementGroup: string | null;
    sortOrder: number | null;
  };
};

/**
 * The same snapshot for a straight-sets day (DN-20), against the prescription
 * rather than a WOD.
 *
 * DN-90's argument applies unchanged -- the choice, the swap rows and the
 * exercise names all keep moving, so a past day re-read through them describes
 * today's settings rather than that day's training. It is load-bearing for a
 * second reason here: the session's progress is stored as a count of sets, and
 * a count only means anything against a list that cannot move under it. A swap
 * made after the session started would otherwise shift which movement the
 * athlete resumes on.
 *
 * `reps` is the count in one set, not the movement's total. Everything that
 * reads a snapshot -- the runner, history -- asks what one set is, and the
 * total is `sets * reps` for anything that wants it.
 */
export function snapshotPrescribedMovements(
  movements: ResolvedPrescribedInput[],
): SessionMovement[] {
  return [...movements]
    .sort((a, b) => a.order - b.order)
    .map((m) => ({
      wodMovementId: null,
      planSlotMovementId: m.id,
      sets: m.sets,
      restSeconds: m.restSeconds,
      order: m.order,
      // All three shapes carry through from the prescription (DN-142): the
      // snapshot is what the runner renders, so a range collapsed to its floor
      // here would show the athlete a number the day never asked for.
      reps: m.reps,
      repsMax: m.repsMax,
      toFailure: m.toFailure,
      // A prescribed movement is the same count every set, so there is no
      // ladder to record. Empty rather than [reps] repeated: a repScheme means
      // "the counts descend as written", which this is not.
      repScheme: [],
      isSwapped: m.isSwapped,
      prescribedName: m.prescribedName,
      prescribedReason: m.prescribedReason,
      exercise: {
        id: m.exercise.id,
        name: m.exercise.name,
        unit: m.exercise.unit as ExerciseUnit,
        movementGroup: m.exercise.movementGroup as MovementGroup | null,
        sortOrder: m.exercise.sortOrder,
      },
    }));
}
