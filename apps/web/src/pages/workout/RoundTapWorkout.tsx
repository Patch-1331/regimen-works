import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  anchorMovement,
  capStateAt,
  effectiveRounds,
  hasRepScheme,
  repsForRound,
  roundsFromReps,
  type Wod,
  type WorkoutSession,
} from "@regimen-works/shared";
import { api } from "../../lib/api";
import { elapsedSecondsSince, formatClock } from "../../lib/clock";
import { roundCompleteCue, capReachedCue } from "../../lib/cues";
import { MinusIcon, PlusIcon } from "../../components/StepperIcons";
import { InstructionsCaret, InstructionsPeek } from "../../components/MovementInstructions";
import { useNow } from "./useWorkoutSession";
import { WorkoutChrome } from "./WorkoutChrome";

/**
 * The AMRAP / For Time screen: a running stopwatch the athlete taps once
 * per round, which stops itself at the WOD's time cap. EMOM and Tabata
 * advance themselves instead — see IntervalWorkout.
 */
export function RoundTapWorkout({
  assignmentId,
  wod,
  session,
  isFinished,
  onFinish,
  finishPending,
  stopAtCap,
  chrome,
}: {
  assignmentId: string;
  wod: Wod;
  session: WorkoutSession;
  isFinished: boolean;
  onFinish: () => void;
  finishPending: boolean;
  stopAtCap: () => void;
  chrome: React.ReactElement<typeof WorkoutChrome>;
}) {
  const queryClient = useQueryClient();
  const now = useNow(1000, !isFinished);

  // A session's cap is null only on a prescribed day (DN-20), which never
  // reaches this screen. Falling back to the WOD's own cap rather than
  // asserting: it is the number the session was seeded from, so if the two
  // could ever disagree the clock would still read something true.
  const capSeconds = session.capSeconds ?? wod.timeCapMinutes * 60;

  // The clock the whole screen reads. `autoStopAtCap` is the athlete's setting
  // as it stood when this session started, so it decides whether the cap is a
  // boundary or only a marker the clock runs past.
  const cap = capStateAt(elapsedSecondsSince(session.startedAt, now), capSeconds);
  const autoStop = session.autoStopAtCap;
  const isCapStopped = autoStop && cap.isCapped;

  const logRoundMutation = useMutation({
    mutationFn: (round: { round: number; atSeconds: number }) => api.logRound(assignmentId, round),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["today"] }),
  });

  // The cap is the end of the workout, so reaching it stops the clock rather
  // than only announcing itself: the session is finished at the cap, which is
  // what freezes this readout (`isFinished` stops the ticker) and releases the
  // wake lock. Cues once and posts once — the ref holds across the second or
  // two before the finish comes back through the query.
  //
  // With the opt-out the cue is all the cap does, which is where this screen
  // stood before the auto-stop: the clock runs on and the athlete taps FINISH.
  const capReachedRef = useRef(false);
  useEffect(() => {
    capReachedRef.current = false;
  }, [session.id]);
  useEffect(() => {
    if (isFinished || capReachedRef.current || !cap.isCapped) return;
    // A round tapped inside the cap's last second still counts, so let it
    // land first — the API rejects a split posted after the session is
    // finished, and that tap is the one the athlete just earned.
    if (autoStop && logRoundMutation.isPending) return;

    capReachedRef.current = true;
    capReachedCue();
    if (autoStop) stopAtCap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cap.isCapped, autoStop, isFinished, logRoundMutation.isPending]);

  const splitMutation = useMutation({
    mutationFn: (roundSplitCount: number | null) => api.setRoundSplit(assignmentId, { roundSplitCount }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["today"] }),
  });

  // Which movement's instructions are being read, by movement id. An overlay
  // rather than an expanding row: this screen's layout is fixed to the
  // viewport, and the round button must not move under a waiting thumb.
  const [peekMovementId, setPeekMovementId] = useState<string | null>(null);
  const [splitPanelOpen, setSplitPanelOpen] = useState(false);
  const [splitMode, setSplitMode] = useState<"rounds" | "reps">("rounds");
  const [splitInput, setSplitInput] = useState(5);

  // Splits are stamped with the clock, not the wall clock, so nothing is
  // logged at a second the athlete never saw — which past the cap is the cap
  // itself, unless the athlete opted out of stopping there.
  const elapsedSeconds = autoStop ? cap.clockSeconds : cap.elapsedSeconds;
  const progress = Math.min(1, elapsedSeconds / capSeconds);
  const splits = [...session.roundSplits].sort((a, b) => b.round - a.round);
  const currentRound = session.roundSplits.length + 1;

  const peekMovement = wod.movements.find((m) => m.id === peekMovementId);
  const anchor = anchorMovement(wod.movements);
  // A rep scheme is the workout's own structure, so it outranks a manual
  // split — and leaves the SPLIT control nothing to do. `roundSplitCount` may
  // still be set on a session that started before the WOD gained its scheme;
  // ignoring it here is what makes the scheme win rather than a migration.
  const isSchemeDriven = hasRepScheme(wod.movements);
  const roundSplitCount = isSchemeDriven ? null : session.roundSplitCount;
  const totalRounds = effectiveRounds(wod);

  function repsForMovement(m: (typeof wod.movements)[number]) {
    return repsForRound(m, currentRound - 1, roundSplitCount);
  }

  // Once the cap lands the clock has stopped, and the screen says so rather
  // than leaving a live-looking readout: the time goes red and the round
  // button becomes the one thing left to do. `isFinished` joins it there —
  // a session finished early is just as stopped — but keeps the clock's own
  // colour, since finishing the work is not the same as running out of time.
  // A clock still running past the cap stays lit; only its label goes red.
  const isStopped = isCapStopped || isFinished;
  const clockColor = isCapStopped ? "var(--danger)" : "var(--glow)";

  function handleRoundComplete() {
    roundCompleteCue();
    logRoundMutation.mutate({ round: currentRound, atSeconds: elapsedSeconds });
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden" style={{ background: "var(--bg)", color: "var(--ink)" }}>
      {chrome}

      <div className="pt-5 text-center">
        <div className="text-xs font-semibold tracking-[0.14em]" style={{ color: "var(--ink-faint)", fontFamily: "var(--font-mono)" }}>
          {wod.name.toUpperCase()} · {wod.type.toUpperCase()} {wod.timeCapMinutes} · CUES ON
        </div>
        {wod.description && (
          <p className="mx-auto mt-1 max-w-[85vw] text-[11px] leading-snug" style={{ color: "var(--ink-soft)" }}>
            {wod.description}
          </p>
        )}
        <div
          className="mt-1.5 text-6xl font-bold"
          style={{
            fontVariantNumeric: "tabular-nums",
            fontFamily: "var(--font-mono)",
            color: clockColor,
            textShadow: isCapStopped
              ? "0 0 16px var(--danger-tint)"
              : "0 0 16px var(--glow-tint), 0 0 3px var(--glow)",
          }}
        >
          {formatClock(elapsedSeconds)}
        </div>
        <div className="mx-auto mt-3.5 h-1.5 w-72 max-w-[70vw] overflow-hidden" style={{ background: "var(--panel-2)", border: "1px solid var(--border)" }}>
          <div
            className="h-full"
            style={{
              width: `${progress * 100}%`,
              background: clockColor,
              boxShadow: isCapStopped ? "none" : "0 0 8px var(--glow)",
            }}
          />
        </div>
        <div
          className="mt-1.5 text-[11px] font-semibold tracking-[0.14em]"
          style={{ color: cap.isCapped ? "var(--danger)" : "var(--ink-faint)", fontFamily: "var(--font-mono)" }}
        >
          {capLabel(capSeconds, cap.isCapped, autoStop)}
        </div>
      </div>

      <div className="py-5 text-center">
        <div className="text-xs font-semibold tracking-[0.14em]" style={{ color: "var(--ink-faint)", fontFamily: "var(--font-mono)" }}>
          ROUND
        </div>
        <div
          className="text-8xl font-extrabold leading-none"
          style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", color: "var(--glow)", textShadow: "0 0 16px var(--glow-tint), 0 0 3px var(--glow)" }}
        >
          {currentRound}
          {totalRounds ? (
            <span className="text-4xl" style={{ color: "var(--ink-faint)", textShadow: "none" }}> / {totalRounds}</span>
          ) : null}
        </div>
      </div>

      <div className="px-5 pb-2">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-semibold tracking-[0.14em]" style={{ color: "var(--ink-faint)", fontFamily: "var(--font-mono)" }}>
            MOVEMENTS
          </div>
          {isSchemeDriven ? (
            // Not a disabled button: the scheme already prescribes the rounds,
            // so there's no split to offer — just the shape of the ladder.
            <span
              className="text-[11px] font-semibold tracking-[0.14em]"
              style={{ color: "var(--glow)", fontFamily: "var(--font-mono)" }}
            >
              {schemeLabel(wod.movements)}
            </span>
          ) : (
            <button
              onClick={() => {
                setSplitInput(roundSplitCount ?? 5);
                setSplitMode("rounds");
                setSplitPanelOpen((v) => !v);
              }}
              className="text-[11px] font-semibold tracking-[0.14em]"
              style={{ color: roundSplitCount ? "var(--glow)" : "var(--ink-faint)", fontFamily: "var(--font-mono)" }}
            >
              {roundSplitCount ? `SPLIT ${roundSplitCount}×` : "SPLIT"}
            </button>
          )}
        </div>

        {splitPanelOpen && !isSchemeDriven && (
          <div className="mt-2 p-3" style={{ background: "var(--panel)", border: "1px solid var(--border)" }}>
            <div className="flex gap-2">
              <button
                onClick={() => setSplitMode("rounds")}
                className="flex-1 py-1.5 text-xs font-semibold"
                style={
                  splitMode === "rounds"
                    ? { background: "var(--glow)", color: "var(--bg)", fontFamily: "var(--font-mono)" }
                    : { background: "var(--panel-2)", color: "var(--ink-soft)", fontFamily: "var(--font-mono)" }
                }
              >
                BY ROUNDS
              </button>
              <button
                onClick={() => setSplitMode("reps")}
                className="flex-1 py-1.5 text-xs font-semibold"
                style={
                  splitMode === "reps"
                    ? { background: "var(--glow)", color: "var(--bg)", fontFamily: "var(--font-mono)" }
                    : { background: "var(--panel-2)", color: "var(--ink-soft)", fontFamily: "var(--font-mono)" }
                }
              >
                BY REPS
              </button>
            </div>

            <div className="mt-3 flex items-center justify-center gap-4">
              <button
                onClick={() => setSplitInput((v) => Math.max(1, v - 1))}
                className="flex h-8 w-8 items-center justify-center rounded-full border"
                style={{ borderColor: "var(--ink-faint)", color: "var(--ink-faint)" }}
              >
                <MinusIcon color="var(--ink-faint)" />
              </button>
              <span
                className="min-w-[3rem] text-center text-2xl font-semibold"
                style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", color: "var(--glow)" }}
              >
                {splitInput}
              </span>
              <button
                onClick={() => setSplitInput((v) => v + 1)}
                className="flex h-8 w-8 items-center justify-center rounded-full border"
                style={{ borderColor: "var(--glow)", color: "var(--glow)" }}
              >
                <PlusIcon color="var(--glow)" />
              </button>
            </div>
            <p className="mt-1 text-center text-[11px]" style={{ color: "var(--ink-faint)", fontFamily: "var(--font-mono)" }}>
              {splitMode === "rounds"
                ? `${splitInput} rounds`
                : `${splitInput} reps of ${anchor.exercise.name} → ${roundsFromReps(anchor.reps, splitInput)} rounds`}
            </p>

            <div className="mt-3 flex gap-2">
              <button
                onClick={() => {
                  const rounds = splitMode === "rounds" ? splitInput : roundsFromReps(anchor.reps, splitInput);
                  splitMutation.mutate(rounds);
                  setSplitPanelOpen(false);
                }}
                disabled={splitMutation.isPending}
                className="flex-1 py-2 text-xs font-bold"
                style={{ background: "var(--glow)", color: "var(--bg)", fontFamily: "var(--font-mono)" }}
              >
                APPLY
              </button>
              {roundSplitCount !== null && (
                <button
                  onClick={() => {
                    splitMutation.mutate(null);
                    setSplitPanelOpen(false);
                  }}
                  disabled={splitMutation.isPending}
                  className="px-4 py-2 text-xs font-semibold"
                  style={{ background: "var(--panel-2)", color: "var(--ink-soft)", fontFamily: "var(--font-mono)" }}
                >
                  CLEAR
                </button>
              )}
            </div>
          </div>
        )}

        <div className="mt-2.5 flex flex-col">
          {wod.movements.map((m) => {
            const count = m.exercise.unit === "seconds" ? `${repsForMovement(m)}s` : repsForMovement(m);
            const rowContent = (
              <>
                <span className="truncate text-sm font-semibold" style={{ color: "var(--ink-soft)", fontFamily: "var(--font-mono)" }}>
                  {m.exercise.name.toUpperCase()}
                </span>
                <span className="flex items-center gap-2">
                  <span
                    className="text-lg font-bold"
                    style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", color: "var(--ink)" }}
                  >
                    {count}
                  </span>
                  {/* Trailing rather than leading: the count is what the eye
                      comes here for mid-round, and nothing should sit between
                      the name and it. */}
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
              <div key={m.id} className="flex items-center justify-between gap-3 border-b py-2" style={{ borderColor: "var(--border)" }}>
                {rowContent}
              </div>
            );
          })}
        </div>
      </div>

      <div className="px-5">
        {isStopped ? (
          // The same thumb target, repurposed: with the clock stopped there is
          // no round left to tap, and logging is the only way on.
          <button
            onClick={onFinish}
            disabled={finishPending}
            className="flex w-full flex-col items-center justify-center gap-2"
            style={{ height: 168, background: "var(--glow)", color: "var(--bg)" }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--bg)" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" width={34} height={34}>
              <path d="M20 6 9 17l-5-5" />
            </svg>
            <span className="text-base font-bold tracking-[0.14em]" style={{ fontFamily: "var(--font-mono)" }}>
              LOG RESULT
            </span>
          </button>
        ) : (
          <button
            onClick={handleRoundComplete}
            disabled={logRoundMutation.isPending}
            className="flex w-full flex-col items-center justify-center gap-2"
            style={{ height: 168, background: "var(--glow)", color: "var(--bg)" }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--bg)" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" width={34} height={34}>
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
            <span className="text-base font-bold tracking-[0.14em]" style={{ fontFamily: "var(--font-mono)" }}>
              ROUND COMPLETE
            </span>
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-5">
        <div className="text-[11px] font-semibold tracking-[0.14em]" style={{ color: "var(--ink-faint)", fontFamily: "var(--font-mono)" }}>
          SPLITS
        </div>
        <div className="mt-2.5 flex flex-col">
          {splits.map((s) => (
            <div
              key={s.round}
              className="flex justify-between border-b py-2.5 text-sm"
              style={{ borderColor: "var(--border)", fontFamily: "var(--font-mono)" }}
            >
              <span style={{ color: "var(--ink-soft)" }}>ROUND {s.round}</span>
              <span style={{ fontVariantNumeric: "tabular-nums", color: "var(--ink)" }}>{formatClock(s.atSeconds)}</span>
            </div>
          ))}
        </div>
      </div>

      {peekMovement?.exercise.instructions && (
        <InstructionsPeek
          name={peekMovement.exercise.name}
          text={peekMovement.exercise.instructions}
          onDismiss={() => setPeekMovementId(null)}
        />
      )}
    </div>
  );
}

/**
 * The line under the progress bar: the cap ahead, the cap that stopped the
 * clock, or — with the auto-stop off — the cap the athlete has run past and is
 * now working beyond.
 */
function capLabel(capSeconds: number, isCapped: boolean, autoStop: boolean): string {
  const cap = formatClock(capSeconds);
  if (!isCapped) return `CAP ${cap}`;
  return autoStop ? `TIME CAP ${cap} — CLOCK STOPPED` : `CAP ${cap} — PASSED`;
}

/** "21-15-9" — the ladder's shape, shown where the SPLIT control would be. */
function schemeLabel(movements: { repScheme: number[] }[]): string {
  const scheme = movements.find((m) => m.repScheme.length > 0);
  return scheme ? scheme.repScheme.join("-") : "";
}
