import { useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  repsLabel,
  restClockSeconds,
  restStateAt,
  straightSetsStateAt,
  type SessionMovement,
  type WorkoutSession,
} from "@regimen-works/shared";
import { api } from "../../lib/api";
import { elapsedSecondsSince } from "../../lib/clock";
import {
  countdownTickCue,
  restStartCue,
  sequenceCompleteCue,
  workStartCue,
} from "../../lib/cues";
import { useNow } from "./useWorkoutSession";
import type { WorkoutChrome } from "./WorkoutChrome";

/** The last seconds of a rest tick, so the next set never lands cold. */
const TICK_FROM_SECONDS = 3;

/**
 * The straight-sets screen: a prescribed day, worked one set at a time
 * (DN-20).
 *
 * The third runner beside the round-tap stopwatch and the interval countdown,
 * and the one with no clock over it. An AMRAP is scored against the time it
 * ran and an EMOM advances itself on a timer; "5 × 3, rest 90s" is neither.
 * The athlete works at their own pace and taps when a set is done, which is
 * the only moment this screen has to record -- so it is the only moment it
 * writes.
 *
 * Where the session has got to lives on the server as one number, and the
 * position is derived back from it against the session's own snapshot. So a
 * locked phone, a refresh, or the whole app being killed between sets all come
 * back to the same set, and a tap replayed on a flaky connection writes the
 * count it already had rather than skipping a set.
 *
 * The one clock here is the rest between sets, which counts down from the
 * second it started rather than tick by tick -- a backgrounded tab that fired
 * no timers still shows the right number when the athlete looks back at it.
 */
export function StraightSetsWorkout({
  assignmentId,
  session,
  isFinished,
  onFinish,
  finishPending,
  chrome,
}: {
  assignmentId: string;
  session: WorkoutSession;
  isFinished: boolean;
  onFinish: () => void;
  finishPending: boolean;
  chrome: React.ReactElement<typeof WorkoutChrome>;
}) {
  const queryClient = useQueryClient();
  const now = useNow(250, !isFinished);
  const elapsedSeconds = elapsedSecondsSince(session.startedAt, now);

  const logSetMutation = useMutation({
    mutationFn: (body: { setsCompleted: number; restStartedAtSeconds: number | null }) =>
      api.logSet(assignmentId, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["today"] }),
  });

  const movements = session.movements;
  // Null would mean this is not a straight-sets session, which is what the
  // fork in ActiveWorkoutPage has already ruled out.
  const setsCompleted = session.setsCompleted ?? 0;
  const state = straightSetsStateAt(
    movements.map((m) => ({ sets: m.sets ?? 0 })),
    setsCompleted,
  );
  const movement = movements[state.movementIndex] as SessionMovement | undefined;

  // Null for straight through and for a rest nobody stated alike: neither has
  // a countdown. Never `?? 0` here -- the snapshot's null is a fact about the
  // prescription, and the resolver upstream is the only place it may be filled.
  const restClock = restClockSeconds(movement?.restSeconds ?? null);
  const rest =
    session.restStartedAtSeconds === null || state.isComplete || restClock === null
      ? null
      : restStateAt(elapsedSeconds, session.restStartedAtSeconds, restClock);
  const isResting = rest !== null && !rest.isOver;

  // One cue per transition, and none on the first pass: a screen reopened
  // mid-rest has no transition to announce, it is just where the athlete is.
  const cuedRef = useRef<string | null>(null);
  useEffect(() => {
    if (isFinished) return;
    const key = state.isComplete
      ? "complete"
      : `${setsCompleted}:${isResting ? "rest" : "work"}`;
    if (cuedRef.current === key) return;

    const isFirstPass = cuedRef.current === null;
    cuedRef.current = key;
    if (isFirstPass) return;

    if (state.isComplete) sequenceCompleteCue();
    else if (isResting) restStartCue();
    else workStartCue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setsCompleted, isResting, state.isComplete, isFinished]);

  const tickedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!rest || isFinished || rest.isOver) return;
    if (rest.secondsRemaining > TICK_FROM_SECONDS) return;

    const key = `${setsCompleted}:${rest.secondsRemaining}`;
    if (tickedRef.current === key) return;
    tickedRef.current = key;
    countdownTickCue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rest?.secondsRemaining, rest?.isOver, setsCompleted, isFinished]);

  /**
   * A set is done. The rest starts now unless this movement has no clock --
   * straight through, or no rest stated anywhere -- or unless that was the last set of the day -- resting after the workout is
   * a countdown to nothing.
   */
  function handleSetDone() {
    const next = setsCompleted + 1;
    const isLast = next >= state.totalSets;
    logSetMutation.mutate({
      setsCompleted: next,
      restStartedAtSeconds:
        isLast || restClock === null ? null : Math.floor(elapsedSeconds),
    });
  }

  /** Back to work early. The set count does not move — only the rest ends. */
  function handleSkipRest() {
    logSetMutation.mutate({ setsCompleted, restStartedAtSeconds: null });
  }

  return (
    <div
      className="flex min-h-screen flex-col"
      style={{ background: "var(--bg)", color: "var(--ink)" }}
    >
      {chrome}

      <div className="pt-5 text-center">
        <div
          className="text-xs font-semibold tracking-[0.14em]"
          style={{ color: "var(--ink-faint)", fontFamily: "var(--font-mono)" }}
        >
          STRAIGHT SETS · {state.totalSets} SETS · CUES ON
        </div>
        {/* No elapsed clock. This day is untimed on purpose, and a running
            number at the top of the screen is a thing to race whether or not
            anybody says it is. */}
      </div>

      {state.isComplete ? (
        <CompletePanel
          totalSets={state.totalSets}
          onFinish={onFinish}
          finishPending={finishPending}
        />
      ) : (
        <div className="flex flex-1 flex-col">
          <div className="px-5 pt-8 text-center">
            <div
              className="text-sm font-bold tracking-[0.3em]"
              style={{
                color: isResting ? "var(--glow-dim)" : "var(--glow)",
                fontFamily: "var(--font-mono)",
              }}
            >
              {isResting ? "REST" : "WORK"}
            </div>

            {isResting ? (
              <div
                className="mt-1 leading-none"
                style={{
                  fontSize: "5.5rem",
                  fontWeight: 800,
                  fontFamily: "var(--font-mono)",
                  fontVariantNumeric: "tabular-nums",
                  color: "var(--glow-dim)",
                }}
              >
                {rest.secondsRemaining}
              </div>
            ) : (
              // The rep count, at the size the rest countdown has: on a
              // working set it is the number the athlete is counting to, and
              // nothing else on the screen competes with it.
              <div
                className="mt-1 leading-none"
                style={{
                  fontSize: "5.5rem",
                  fontWeight: 800,
                  fontFamily: "var(--font-mono)",
                  fontVariantNumeric: "tabular-nums",
                  color: "var(--glow)",
                  textShadow: "0 0 20px var(--glow-tint), 0 0 4px var(--glow)",
                }}
              >
                {movement ? repsLabel(movement, movement.exercise.unit) : "—"}
              </div>
            )}

            <div
              className="mt-3 text-3xl font-extrabold uppercase leading-tight"
              style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}
            >
              {movement?.exercise.name ?? "—"}
            </div>
            <div
              className="mt-1 text-sm font-semibold tracking-[0.14em]"
              style={{
                color: "var(--ink-soft)",
                fontFamily: "var(--font-mono)",
              }}
            >
              SET {state.setNumber} OF {state.setsInMovement}
            </div>
          </div>

          <div className="mt-auto px-5 pb-6 pt-8">
            {isResting ? (
              <button
                onClick={handleSkipRest}
                disabled={logSetMutation.isPending}
                className="w-full py-6 text-lg font-bold tracking-[0.2em]"
                style={{
                  background: "var(--panel-2)",
                  border: "1px solid var(--border)",
                  color: "var(--ink)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                START NEXT SET
              </button>
            ) : (
              <button
                onClick={handleSetDone}
                disabled={logSetMutation.isPending}
                className="w-full py-6 text-lg font-bold tracking-[0.2em]"
                style={{
                  background: "var(--glow)",
                  color: "var(--bg)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                SET DONE
              </button>
            )}

            <SessionList
              movements={movements}
              activeIndex={state.movementIndex}
              setsCompleted={setsCompleted}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * How many of each movement's own sets are behind the athlete.
 *
 * The session stores one absolute count for the whole day, so a row can only
 * say "1 of 3" once the sets before it have been spent against it.
 */
function setsDoneEach(
  movements: SessionMovement[],
  setsCompleted: number,
): number[] {
  let spent = 0;
  return movements.map((m) => {
    const sets = m.sets ?? 0;
    const done = Math.max(0, Math.min(sets, setsCompleted - spent));
    spent += sets;
    return done;
  });
}

/**
 * The day at a glance: what is done, what is running, what is still to come.
 *
 * Read-only, unlike the round-tap list, where each row opens the movement's
 * instructions. That list reads the live WOD; this one has only the session's
 * snapshot, which keeps no coaching prose (DN-90), so there is nothing behind
 * a row to open.
 */
function SessionList({
  movements,
  activeIndex,
  setsCompleted,
}: {
  movements: SessionMovement[];
  activeIndex: number;
  setsCompleted: number;
}) {
  const donePerMovement = setsDoneEach(movements, setsCompleted);

  return (
    <div className="mt-6">
      <div
        className="text-[11px] font-semibold tracking-[0.14em]"
        style={{ color: "var(--ink-faint)", fontFamily: "var(--font-mono)" }}
      >
        SESSION
      </div>
      <div className="mt-2.5 flex flex-col">
        {movements.map((m, index) => {
          const sets = m.sets ?? 0;
          const done = donePerMovement[index];
          const isActive = index === activeIndex;

          return (
            <div
              key={m.planSlotMovementId ?? m.order}
              // Colour alone would say which row is live to everybody except
              // the readers who need telling.
              aria-current={isActive ? "step" : undefined}
              className="flex items-center justify-between gap-3 border-b py-2"
              style={{ borderColor: "var(--border)" }}
            >
              <span
                className="truncate text-sm font-semibold"
                style={{
                  color: isActive ? "var(--glow)" : "var(--ink-soft)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {m.exercise.name.toUpperCase()}
              </span>
              <span
                className="text-lg font-bold"
                style={{
                  fontFamily: "var(--font-mono)",
                  fontVariantNumeric: "tabular-nums",
                  color: isActive ? "var(--glow)" : "var(--ink)",
                }}
              >
                {done}/{sets}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CompletePanel({
  totalSets,
  onFinish,
  finishPending,
}: {
  totalSets: number;
  onFinish: () => void;
  finishPending: boolean;
}) {
  return (
    <div className="flex flex-1 flex-col justify-center px-5 py-10 text-center">
      <div
        className="text-5xl font-extrabold uppercase leading-none"
        style={{
          fontFamily: "var(--font-display)",
          color: "var(--glow)",
          textShadow: "0 0 20px var(--glow-tint)",
        }}
      >
        All sets done
      </div>
      <p
        className="mt-3 text-sm"
        style={{ color: "var(--ink-soft)", fontFamily: "var(--font-mono)" }}
      >
        {totalSets} / {totalSets} COMPLETE
      </p>
      <button
        onClick={onFinish}
        disabled={finishPending}
        className="mt-6 w-full py-6 text-lg font-bold tracking-[0.2em]"
        style={{
          background: "var(--glow)",
          color: "var(--bg)",
          fontFamily: "var(--font-mono)",
        }}
      >
        FINISH SESSION
      </button>
    </div>
  );
}
