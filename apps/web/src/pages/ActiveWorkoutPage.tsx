import { useParams } from "react-router-dom";
import { resolveIntervalConfig } from "@regimen-works/shared";
import { IntervalWorkout } from "./workout/IntervalWorkout";
import { RoundTapWorkout } from "./workout/RoundTapWorkout";
import { StraightSetsWorkout } from "./workout/StraightSetsWorkout";
import { WorkoutChrome } from "./workout/WorkoutChrome";
import { useWorkoutSession } from "./workout/useWorkoutSession";

/**
 * Picks the screen the day needs. A prescribed day (DN-20) gets the untimed
 * straight-sets runner; a WOD gets the screen its format needs (Feature #30),
 * the auto-advancing interval countdown for EMOM and Tabata, the round-tap
 * stopwatch for AMRAP and For Time. All three share the session, the wake
 * lock and the finish/cancel bar.
 */
export function ActiveWorkoutPage() {
  const { assignmentId = "" } = useParams();
  const {
    isLoading,
    wod,
    session,
    isFinished,
    finish,
    finishPending,
    stopAtCap,
    cancel,
    cancelPending,
  } = useWorkoutSession(assignmentId);

  if (isLoading || !session) {
    return <p className="p-6 text-[var(--ink-faint)]">Starting your workout…</p>;
  }

  const chrome = (
    <WorkoutChrome
      onFinish={finish}
      finishPending={finishPending}
      onCancel={cancel}
      cancelPending={cancelPending}
      stopped={isFinished}
    />
  );

  // The session's own record of which kind of day it is, rather than the
  // assignment's: a straight-sets session is the one that counts sets, and the
  // same field being non-null is what guarantees the runner below has the
  // snapshot it reads. Checked before `wod`, because a prescribed day has none.
  if (session.setsCompleted !== null) {
    return (
      <StraightSetsWorkout
        assignmentId={assignmentId}
        session={session}
        isFinished={isFinished}
        onFinish={finish}
        finishPending={finishPending}
        chrome={chrome}
      />
    );
  }

  if (!wod) {
    return <p className="p-6 text-[var(--ink-faint)]">Starting your workout…</p>;
  }

  const intervalConfig = resolveIntervalConfig(wod);

  if (intervalConfig) {
    return (
      <IntervalWorkout
        assignmentId={assignmentId}
        wod={wod}
        session={session}
        config={intervalConfig}
        isFinished={isFinished}
        onFinish={finish}
        finishPending={finishPending}
        stopAtCap={stopAtCap}
        chrome={chrome}
      />
    );
  }

  return (
    <RoundTapWorkout
      assignmentId={assignmentId}
      wod={wod}
      session={session}
      isFinished={isFinished}
      onFinish={finish}
      finishPending={finishPending}
      stopAtCap={stopAtCap}
      chrome={chrome}
    />
  );
}
