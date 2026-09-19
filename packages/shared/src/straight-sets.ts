/**
 * Where a straight-sets session has got to (DN-20).
 *
 * The other two runners are clock-shaped: an AMRAP's state is elapsed time
 * and an EMOM's is which interval the elapsed time lands in. A prescribed day
 * has no clock over it at all -- the athlete works at their own pace -- so its
 * state is a position in a list: "movement 2, set 3 of 5".
 *
 * That position is stored as one number, `setsCompleted`, and derived back
 * into a position here. One counter rather than a movement index beside a set
 * index, for two reasons:
 *
 *   - it cannot disagree with itself. Two columns can say "movement 2, set 7"
 *     about a movement with five sets; one number cannot express that.
 *   - the client posts the absolute count, so a tap replayed after a flaky
 *     connection writes the same value rather than incrementing twice. The
 *     same property `mergeRoundSplit` has to work for.
 *
 * Derived against the session's own snapshot rather than today's live
 * prescription, which is the load-bearing half: an index only means anything
 * against a list that cannot move under it. A swap made mid-session, or a rung
 * re-resolved overnight, would otherwise leave the athlete resuming on a
 * different movement than the one they were on.
 */

/** Enough of a snapshotted movement to find the athlete's place in it. */
export type SetCountedMovement = { sets: number };

export type StraightSetsState = {
  /** Which movement is in progress, 0-based. The last one, once complete. */
  movementIndex: number;
  /** The set now being worked, 1-based. Once complete, the last one done. */
  setNumber: number;
  /** How many sets that movement prescribes. */
  setsInMovement: number;
  /** Sets behind the athlete across the whole session. */
  setsCompleted: number;
  /** Sets the session comes to in total. */
  totalSets: number;
  /** Every prescribed set is done. */
  isComplete: boolean;
};

/**
 * The athlete's place in the session, `setsCompleted` sets in.
 *
 * Out-of-range counts are clamped rather than refused: a session resumed
 * against a snapshot is the one place a stored count could outrun the list it
 * indexes, and a screen that renders the end of the workout is a better answer
 * there than one that throws.
 */
export function straightSetsStateAt(
  movements: SetCountedMovement[],
  setsCompleted: number,
): StraightSetsState {
  const totalSets = movements.reduce((sum, m) => sum + m.sets, 0);
  const done = Math.min(Math.max(0, Math.floor(setsCompleted)), totalSets);

  // A session with nothing prescribed is already over, and has no movement to
  // point at. Unrepresentable through the API -- `resolveProgramDay` only
  // calls a slot prescribed when it has movements -- so this is a refusal to
  // turn an impossible row into a crash, not a case anyone reaches.
  if (movements.length === 0) {
    return {
      movementIndex: 0,
      setNumber: 0,
      setsInMovement: 0,
      setsCompleted: 0,
      totalSets: 0,
      isComplete: true,
    };
  }

  if (done >= totalSets) {
    const lastIndex = movements.length - 1;
    return {
      movementIndex: lastIndex,
      // The set they finished, not a seventh set of five: at the end of the
      // session the number on the screen is the one they just did.
      setNumber: movements[lastIndex].sets,
      setsInMovement: movements[lastIndex].sets,
      setsCompleted: done,
      totalSets,
      isComplete: true,
    };
  }

  let remaining = done;
  for (const [index, movement] of movements.entries()) {
    if (remaining < movement.sets) {
      return {
        movementIndex: index,
        setNumber: remaining + 1,
        setsInMovement: movement.sets,
        setsCompleted: done,
        totalSets,
        isComplete: false,
      };
    }
    remaining -= movement.sets;
  }

  // Unreachable: `done < totalSets` means some movement still has room, and
  // the loop above returns on the first one that does.
  throw new Error("straightSetsStateAt: fell past the end of the session");
}

/** The rest between sets, as the countdown reads it. */
export type RestState = {
  /** Seconds of rest still to run; 0 once it is spent. */
  secondsRemaining: number;
  /** The rest has run out, so the next set is due. */
  isOver: boolean;
};

/**
 * Where a rest countdown stands, `elapsedSeconds` into the session.
 *
 * Derived from the elapsed time and the second the rest began rather than
 * counted down tick by tick, for the same reason `capStateAt` and
 * `intervalStateAt` are: a locked screen, a backgrounded tab or a throttled
 * timer all come back to the right second instead of to however many ticks
 * they managed to fire. It is the whole point of storing when the rest
 * started rather than how much of it is left.
 */
export function restStateAt(
  elapsedSeconds: number,
  restStartedAtSeconds: number,
  restSeconds: number,
): RestState {
  const spent = Math.max(0, Math.floor(elapsedSeconds) - restStartedAtSeconds);
  const secondsRemaining = Math.max(0, restSeconds - spent);
  return { secondsRemaining, isOver: secondsRemaining === 0 };
}
