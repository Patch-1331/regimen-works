import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { AdvanceInterval, IntervalConfig, Wod, WorkoutSession } from "@regimen-works/shared";
import { api } from "../../lib/api";
import { InstructionsCaret, InstructionsPeek } from "../../components/MovementInstructions";
import { elapsedSecondsSince, formatClock } from "../../lib/clock";
import {
  countdownTickCue,
  restStartCue,
  sequenceCompleteCue,
  workStartCue,
} from "../../lib/cues";
import type { MovementRotation } from "../../lib/intervals";
import {
  intervalStateAt,
  movementForInterval,
  rotationForWodType,
  timelineOriginSeconds,
} from "../../lib/intervals";
import { useNow } from "./useWorkoutSession";
import type { WorkoutChrome } from "./WorkoutChrome";

/** The last seconds of a phase get a tick so the switch never lands cold. */
const TICK_FROM_SECONDS = 3;

/**
 * The EMOM / Tabata screen: a countdown that advances itself, interval after
 * interval, with sound and vibration carrying each transition.
 *
 * The sequence is anchored to a START tap rather than to the session's own
 * start, so a 20-second Tabata round doesn't begin while the phone is still
 * being propped against a wall. Where it has got to is autosaved on every
 * rollover, so a locked screen or a refresh resumes mid-interval instead of
 * starting the sequence over.
 */
export function IntervalWorkout({
  assignmentId,
  wod,
  session,
  config,
  isFinished,
  onFinish,
  finishPending,
  stopAtCap,
  chrome,
}: {
  assignmentId: string;
  wod: Wod;
  session: WorkoutSession;
  config: IntervalConfig;
  isFinished: boolean;
  onFinish: () => void;
  finishPending: boolean;
  stopAtCap: () => void;
  chrome: React.ReactElement<typeof WorkoutChrome>;
}) {
  const queryClient = useQueryClient();
  // Sub-second so a transition lands on the beat rather than up to a second late.
  const now = useNow(250, !isFinished);

  const advanceMutation = useMutation({
    mutationFn: (next: AdvanceInterval) => api.advanceInterval(assignmentId, next),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["today"] }),
  });

  const cycleSeconds = config.workSeconds + config.restSeconds;
  // Uncapped on purpose, unlike the round-tap screen's clock: the sequence is
  // this format's cap, and it's anchored to the START tap rather than to the
  // session, so a late start can legitimately carry the last interval past
  // `capSeconds`. Stopping the clock there would cut the workout short.
  const elapsedSeconds = elapsedSecondsSince(session.startedAt, now);

  const savedIndex = session.intervalIndex;
  const savedStart = session.intervalStartedAtSeconds;
  const originSeconds =
    savedIndex !== null && savedStart !== null
      ? timelineOriginSeconds(config, savedIndex, savedStart)
      : null;
  const state =
    originSeconds === null ? null : intervalStateAt(elapsedSeconds - originSeconds, config);

  // Autosaves each rollover. Guarded by both what the server already knows
  // and what's in flight, so the four ticks a second don't each post one.
  const postedIndexRef = useRef<number | null>(null);
  useEffect(() => {
    if (!state || isFinished || originSeconds === null || savedIndex === null) return;
    if (state.index <= savedIndex) return;
    if (postedIndexRef.current !== null && postedIndexRef.current >= state.index) return;

    postedIndexRef.current = state.index;
    advanceMutation.mutate({
      intervalIndex: state.index,
      atSeconds: originSeconds + state.index * cycleSeconds,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.index, savedIndex, originSeconds, isFinished]);

  // The sequence running out is where an EMOM/Tabata's time cap lands, so the
  // clock stops there rather than leaving the session running behind the "all
  // intervals done" panel. Gated on the *saved* index rather than the local
  // one so the final rollover is persisted first — a finished session takes no
  // further writes, and that last interval is a round split worth keeping.
  //
  // Skipped entirely for a session started with the auto-stop off: the panel
  // then waits for a FINISH tap, as it did before the stop existed.
  const autoStop = session.autoStopAtCap;
  const stoppedAtCapRef = useRef(false);
  useEffect(() => {
    stoppedAtCapRef.current = false;
  }, [session.id]);
  useEffect(() => {
    if (isFinished || stoppedAtCapRef.current || !autoStop) return;
    if (savedIndex === null || savedIndex < config.intervalCount) return;
    if (advanceMutation.isPending) return;

    stoppedAtCapRef.current = true;
    stopAtCap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedIndex, config.intervalCount, autoStop, isFinished, advanceMutation.isPending]);

  // One cue per transition. The first pass only records where we are — on a
  // refresh mid-interval there's no transition to announce.
  const cuedPhaseRef = useRef<string | null>(null);
  useEffect(() => {
    if (!state || isFinished) return;
    const key = state.isComplete ? "complete" : `${state.index}:${state.phase}`;
    if (cuedPhaseRef.current === key) return;

    const isFirstPass = cuedPhaseRef.current === null;
    cuedPhaseRef.current = key;
    if (isFirstPass) return;

    if (state.isComplete) sequenceCompleteCue();
    else if (state.phase === "work") workStartCue();
    else restStartCue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.index, state?.phase, state?.isComplete, isFinished]);

  const tickedSecondRef = useRef<string | null>(null);
  useEffect(() => {
    if (!state || isFinished || state.isComplete) return;
    if (state.secondsRemaining > TICK_FROM_SECONDS || state.secondsRemaining <= 0) return;

    const key = `${state.index}:${state.phase}:${state.secondsRemaining}`;
    if (tickedSecondRef.current === key) return;
    tickedSecondRef.current = key;
    countdownTickCue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.index, state?.phase, state?.secondsRemaining, isFinished]);

  function handleStart() {
    workStartCue();
    advanceMutation.mutate({ intervalIndex: 0, atSeconds: elapsedSeconds });
  }

  // Which movement's instructions are being read, by movement id. An overlay
  // rather than an expanding row: this clock advances itself, so nothing on
  // the screen may shift under a glance.
  const [peekMovementId, setPeekMovementId] = useState<string | null>(null);
  const peekMovement = wod.movements.find((m) => m.id === peekMovementId);

  const rotation = rotationForWodType(wod.type);
  const activeIndex = state && !state.isComplete ? state.index : null;
  const currentMovement =
    activeIndex === null
      ? null
      : movementForInterval(wod.movements, activeIndex, config.intervalCount, rotation);
  const nextMovement =
    activeIndex === null || activeIndex + 1 >= config.intervalCount
      ? null
      : movementForInterval(wod.movements, activeIndex + 1, config.intervalCount, rotation);

  // During rest the screen is already about what's coming, not what just
  // finished — Tabata's blocks change movement on that boundary.
  const focusMovement = state?.phase === "rest" ? (nextMovement ?? currentMovement) : currentMovement;
  const isRest = state?.phase === "rest" && !state.isComplete;
  const phaseColor = isRest ? "var(--glow-dim)" : "var(--glow)";
  const intervalsDone = state ? Math.min(state.index, config.intervalCount) : 0;

  return (
    <div className="flex min-h-screen flex-col" style={{ background: "var(--bg)", color: "var(--ink)" }}>
      {chrome}

      <div className="pt-5 text-center">
        <div className="text-xs font-semibold tracking-[0.14em]" style={{ color: "var(--ink-faint)", fontFamily: "var(--font-mono)" }}>
          {wod.name.toUpperCase()} · {wod.type.toUpperCase()} {config.workSeconds}
          {config.restSeconds > 0 ? `/${config.restSeconds}` : ""} · CUES ON
        </div>
        {wod.description && (
          <p className="mx-auto mt-1 max-w-[85vw] text-[11px] leading-snug" style={{ color: "var(--ink-soft)" }}>
            {wod.description}
          </p>
        )}
        <div className="mt-1 text-[11px]" style={{ color: "var(--ink-faint)", fontFamily: "var(--font-mono)" }}>
          ELAPSED {formatClock(elapsedSeconds)} · CAP {formatClock(session.capSeconds ?? wod.timeCapMinutes * 60)}
        </div>
      </div>

      {state === null ? (
        <ReadyPanel
          config={config}
          movements={wod.movements}
          rotation={rotation}
          onStart={handleStart}
          startPending={advanceMutation.isPending}
          onPeek={setPeekMovementId}
        />
      ) : state.isComplete ? (
        <CompletePanel
          intervalCount={config.intervalCount}
          autoStop={autoStop}
          onFinish={onFinish}
          finishPending={finishPending}
        />
      ) : (
        <div className="flex flex-1 flex-col">
          <div className="px-5 pt-6 text-center">
            <div
              className="text-sm font-bold tracking-[0.3em]"
              style={{ color: phaseColor, fontFamily: "var(--font-mono)" }}
            >
              {isRest ? "REST" : "WORK"}
            </div>
            <div
              className="mt-1 leading-none"
              style={{
                fontSize: "5.5rem",
                fontWeight: 800,
                fontFamily: "var(--font-mono)",
                fontVariantNumeric: "tabular-nums",
                color: phaseColor,
                textShadow: isRest ? "none" : "0 0 20px var(--glow-tint), 0 0 4px var(--glow)",
              }}
            >
              {state.phaseSeconds >= 60 ? formatClock(state.secondsRemaining) : state.secondsRemaining}
            </div>

            <div className="mx-auto mt-4 h-2 w-72 max-w-[80vw] overflow-hidden" style={{ background: "var(--panel-2)", border: "1px solid var(--border)" }}>
              <div
                className="h-full"
                style={{
                  width: `${(state.secondsElapsedInPhase / state.phaseSeconds) * 100}%`,
                  background: phaseColor,
                  boxShadow: isRest ? "none" : "0 0 8px var(--glow)",
                }}
              />
            </div>

            <div className="mt-2 text-xs font-semibold tracking-[0.14em]" style={{ color: "var(--ink-faint)", fontFamily: "var(--font-mono)" }}>
              INTERVAL {state.index + 1} / {config.intervalCount}
            </div>
          </div>

          <div className="px-5 pt-6 text-center">
            <div className="text-[11px] font-semibold tracking-[0.14em]" style={{ color: "var(--ink-faint)", fontFamily: "var(--font-mono)" }}>
              {isRest ? "NEXT UP" : "THIS INTERVAL"}
            </div>
            <div
              className="mt-1 text-3xl font-extrabold uppercase leading-tight"
              style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}
            >
              {focusMovement?.exercise.name ?? "—"}
            </div>
            {focusMovement && (
              <div className="mt-1 text-sm" style={{ color: "var(--ink-soft)", fontFamily: "var(--font-mono)" }}>
                {repsLabel(focusMovement)}
              </div>
            )}
          </div>

          <div className="mt-auto px-5 pb-6 pt-6">
            <div className="text-[11px] font-semibold tracking-[0.14em]" style={{ color: "var(--ink-faint)", fontFamily: "var(--font-mono)" }}>
              MOVEMENTS
            </div>
            <div className="mt-2.5 flex flex-col">
              {wod.movements.map((m) => {
                const isActive = focusMovement?.id === m.id;
                const rowContent = (
                  <>
                    <span
                      className="truncate text-sm font-semibold"
                      style={{ color: isActive ? "var(--glow)" : "var(--ink-soft)", fontFamily: "var(--font-mono)" }}
                    >
                      {isActive ? "▸ " : "  "}
                      {m.exercise.name.toUpperCase()}
                    </span>
                    <span className="flex items-center gap-2">
                      <span
                        className="text-lg font-bold"
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontVariantNumeric: "tabular-nums",
                          color: isActive ? "var(--glow)" : "var(--ink)",
                        }}
                      >
                        {m.exercise.unit === "seconds" ? `${m.reps}s` : m.reps}
                      </span>
                      {/* Trailing, so nothing comes between the name and the
                          count — and clear of the ▸ that marks the interval
                          in progress. */}
                      {m.exercise.instructions ? <InstructionsCaret open={false} /> : <span aria-hidden="true" style={{ width: 12 }} />}
                    </span>
                  </>
                );

                return m.exercise.instructions ? (
                  <button
                    key={m.id}
                    onClick={() => setPeekMovementId(m.id)}
                    aria-label={`How to do ${m.exercise.name}`}
                    className="flex items-center justify-between gap-3 border-b py-2 text-left"
                    style={{ borderColor: "var(--border)" }}
                  >
                    {rowContent}
                  </button>
                ) : (
                  <div
                    key={m.id}
                    className="flex items-center justify-between gap-3 border-b py-2"
                    style={{ borderColor: "var(--border)" }}
                  >
                    {rowContent}
                  </div>
                );
              })}
            </div>

            <div className="mt-4 h-1.5 overflow-hidden" style={{ background: "var(--panel-2)", border: "1px solid var(--border)" }}>
              <div
                className="h-full"
                style={{ width: `${(intervalsDone / config.intervalCount) * 100}%`, background: "var(--glow-dim)" }}
              />
            </div>
            <div className="mt-1.5 text-[11px]" style={{ color: "var(--ink-faint)", fontFamily: "var(--font-mono)" }}>
              {intervalsDone} OF {config.intervalCount} INTERVALS DONE
            </div>
          </div>
        </div>
      )}

      {/* Outside the phase branches on purpose: the READY panel and the
          running clock both open it, and it outlives the rollover between
          them. */}
      {peekMovement?.exercise.instructions && (
        <InstructionsPeek
          name={peekMovement.exercise.name}
          text={peekMovement.exercise.instructions}
          onDismiss={() => setPeekMovementId(null)}
          dismissLabel={state === null ? "CLOSE" : "BACK TO THE CLOCK"}
        />
      )}
    </div>
  );
}

function repsLabel(movement: Wod["movements"][number]): string {
  if (movement.exercise.unit === "seconds") return `${movement.reps}s hold`;
  return `${movement.reps} rep${movement.reps === 1 ? "" : "s"}`;
}

function ReadyPanel({
  config,
  movements,
  rotation,
  onStart,
  startPending,
  onPeek,
}: {
  config: IntervalConfig;
  movements: Wod["movements"];
  rotation: MovementRotation;
  onStart: () => void;
  startPending: boolean;
  onPeek: (movementId: string) => void;
}) {
  return (
    <div className="flex flex-1 flex-col justify-center px-5 py-10">
      <div className="p-5 text-center" style={{ background: "var(--panel)", border: "1px solid var(--border)" }}>
        <div className="text-xs font-semibold tracking-[0.2em]" style={{ color: "var(--ink-faint)", fontFamily: "var(--font-mono)" }}>
          READY
        </div>
        <div
          className="mt-2 text-4xl font-extrabold"
          style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", color: "var(--ink)" }}
        >
          {config.intervalCount} × {config.workSeconds}s
          {config.restSeconds > 0 ? ` / ${config.restSeconds}s` : ""}
        </div>
        <p className="mt-2 text-xs" style={{ color: "var(--ink-soft)", fontFamily: "var(--font-mono)" }}>
          {config.restSeconds > 0 ? "WORK, THEN REST" : "STRAIGHT THROUGH"} ·{" "}
          {rotation === "block" ? "A BLOCK EACH" : "ONE PER INTERVAL"}
        </p>

        <div className="mt-4 flex flex-col">
          {movements.map((m) => {
            const rowContent = (
              <>
                <span className="truncate text-sm font-semibold" style={{ color: "var(--ink-soft)", fontFamily: "var(--font-mono)" }}>
                  {m.exercise.name.toUpperCase()}
                </span>
                <span className="flex items-center gap-2">
                  <span
                    className="text-base font-bold"
                    style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", color: "var(--ink)" }}
                  >
                    {m.exercise.unit === "seconds" ? `${m.reps}s` : m.reps}
                  </span>
                  {m.exercise.instructions ? <InstructionsCaret open={false} /> : <span aria-hidden="true" style={{ width: 12 }} />}
                </span>
              </>
            );

            // The last look before the clock starts running itself — the one
            // moment on this screen where checking a movement is free.
            return m.exercise.instructions ? (
              <button
                key={m.id}
                onClick={() => onPeek(m.id)}
                aria-label={`How to do ${m.exercise.name}`}
                className="flex items-center justify-between gap-3 border-t py-2 text-left"
                style={{ borderColor: "var(--border)" }}
              >
                {rowContent}
              </button>
            ) : (
              <div
                key={m.id}
                className="flex items-center justify-between gap-3 border-t py-2"
                style={{ borderColor: "var(--border)" }}
              >
                {rowContent}
              </div>
            );
          })}
        </div>
      </div>

      <button
        onClick={onStart}
        disabled={startPending}
        className="mt-5 w-full py-6 text-lg font-bold tracking-[0.2em]"
        style={{ background: "var(--glow)", color: "var(--bg)", fontFamily: "var(--font-mono)" }}
      >
        START INTERVALS
      </button>
      <p className="mt-3 text-center text-[11px]" style={{ color: "var(--ink-faint)", fontFamily: "var(--font-mono)" }}>
        THE CLOCK ADVANCES ITSELF — NO TAPS UNTIL YOU'RE DONE
      </p>
    </div>
  );
}

function CompletePanel({
  intervalCount,
  autoStop,
  onFinish,
  finishPending,
}: {
  intervalCount: number;
  autoStop: boolean;
  onFinish: () => void;
  finishPending: boolean;
}) {
  return (
    <div className="flex flex-1 flex-col justify-center px-5 py-10 text-center">
      <div
        className="text-5xl font-extrabold uppercase leading-none"
        style={{ fontFamily: "var(--font-display)", color: "var(--glow)", textShadow: "0 0 20px var(--glow-tint)" }}
      >
        All intervals done
      </div>
      <p className="mt-3 text-sm" style={{ color: "var(--ink-soft)", fontFamily: "var(--font-mono)" }}>
        {intervalCount} / {intervalCount} COMPLETE — {autoStop ? "CLOCK STOPPED" : "TAP TO LOG IT"}
      </p>
      <button
        onClick={onFinish}
        disabled={finishPending}
        className="mt-6 w-full py-6 text-lg font-bold tracking-[0.2em]"
        style={{ background: "var(--glow)", color: "var(--bg)", fontFamily: "var(--font-mono)" }}
      >
        LOG RESULT
      </button>
    </div>
  );
}
