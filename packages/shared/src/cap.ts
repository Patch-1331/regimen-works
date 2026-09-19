/**
 * The time cap, as the clock reads it.
 *
 * Every WOD carries a cap (`Wod.timeCapMinutes`, copied onto the session as
 * `capSeconds`) and reaching it ends the workout: an AMRAP scores whatever was
 * done inside the cap, and a For Time that runs out of road is capped rather
 * than credited with however long the athlete kept going. So the clock stops
 * at the cap instead of running past it.
 *
 * This module is the one place that decides where "stopped" is. The workout
 * screen freezes its readout with it and the API records a finish with it, so
 * the number the athlete last saw is the number that gets logged.
 *
 * An athlete can opt out (`Settings.autoStopAtCapEnabled`), which every caller
 * reads off the session's own `autoStopAtCap` rather than from here: the cap
 * arithmetic is the same either way, and only whether it *binds* changes.
 */

/** A session's clock, as far as the cap is concerned. */
export type CapState = {
  /** Wall-clock seconds since the session started — uncapped, so it keeps growing. */
  elapsedSeconds: number;
  /** What the clock reads: the elapsed time, stopped at the cap. */
  clockSeconds: number;
  /** Seconds of the cap still to run; 0 once it's spent. */
  secondsRemaining: number;
  /** The cap has been reached, so the clock has stopped. */
  isCapped: boolean;
};

/**
 * Where the clock stands `secondsSinceStart` into a session with this cap.
 *
 * Derived from elapsed time rather than counted down tick by tick, for the
 * same reason `intervalStateAt` is: a backgrounded tab, a throttled timer or
 * a locked screen all come back to the right second instead of to however
 * many ticks they managed to fire.
 */
export function capStateAt(
  secondsSinceStart: number,
  capSeconds: number,
): CapState {
  const elapsedSeconds = Math.max(0, Math.floor(secondsSinceStart));
  return {
    elapsedSeconds,
    clockSeconds: Math.min(elapsedSeconds, capSeconds),
    secondsRemaining: Math.max(0, capSeconds - elapsedSeconds),
    isCapped: elapsedSeconds >= capSeconds,
  };
}

/**
 * The elapsed time to record for a finish — the clock, which is the point: a
 * FINISH tap that lands after the cap (a locked phone, a tab woken up late)
 * scores the cap rather than the wall clock.
 */
export function finishSecondsAt(
  secondsSinceStart: number,
  capSeconds: number,
): number {
  return capStateAt(secondsSinceStart, capSeconds).clockSeconds;
}

/**
 * Whether a finished session was stopped by the cap rather than finishing its
 * work — the difference between a For Time result that's a completion time and
 * one that's a cap.
 *
 * Derived rather than stored: where the cap binds, the clock stops there, so a
 * finish at the cap is the only way to reach it. A session running with the
 * opt-out is never "capped" however long it ran — the athlete owned the clock
 * and the time they finished at is their real one.
 */
export function wasCappedFinish(session: {
  capSeconds: number | null;
  finishedAtSeconds: number | null;
  autoStopAtCap: boolean;
}): boolean {
  // An untimed session -- a straight-sets day (DN-20) -- has no cap to be
  // stopped by. Worth stating rather than leaving to the arithmetic: a null
  // read as a zero would make every such session report itself capped, since
  // any finish at all is at or past second zero.
  if (session.capSeconds === null) return false;

  return (
    session.autoStopAtCap &&
    session.finishedAtSeconds !== null &&
    session.finishedAtSeconds >= session.capSeconds
  );
}
