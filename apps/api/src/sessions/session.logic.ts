import type {
  ExerciseUnit,
  ProgressionLine,
  RoundSplit,
  SessionMovement,
} from '@regimen-works/shared';

/** The resolved movement as the scheduler hands it over -- see MovementResolutionService. */
export type ResolvedMovementInput = {
  id: string;
  order: number;
  reps: number;
  repScheme: number[];
  isSwapped: boolean;
  exercise: {
    id: string;
    name: string;
    unit: string;
    line: string | null;
    rung: number | null;
  };
};

/**
 * Pins the resolved movement list down as it stood when the session started
 * (DN-90). Copies rather than references: the point is that nothing which
 * moves afterwards -- the rung on record, the swap rows, an exercise's name
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
      order: m.order,
      reps: m.reps,
      repScheme: [...m.repScheme],
      isSwapped: m.isSwapped,
      exercise: {
        id: m.exercise.id,
        name: m.exercise.name,
        unit: m.exercise.unit as ExerciseUnit,
        line: m.exercise.line as ProgressionLine | null,
        rung: m.exercise.rung,
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
