import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DEFAULT_PLAN_ID,
  effectiveRounds,
  type TodayPlan,
} from "@regimen-works/shared";
import { api } from "../lib/api";
import { DigitReadout } from "../components/DigitReadout";
import {
  InstructionsCaret,
  InstructionsPanel,
} from "../components/MovementInstructions";
import { SwapButton, SwapPanel } from "../components/MovementSwap";
import { buildSwapOptions } from "../lib/swapOptions";

export function TodayPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // Which movement's instructions are open, by movement id. One at a time:
  // the plate is a briefing to read down, not a set of panels to leave open.
  const [openMovementId, setOpenMovementId] = useState<string | null>(null);
  // The swap ladder, by movement id. Separate state from the instructions
  // above, but only one of the two is ever open: the row is a briefing line,
  // not a stack of drawers. Opening either closes the other.
  const [swapMovementId, setSwapMovementId] = useState<string | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ["today"],
    queryFn: api.today,
  });
  // The ladder's rungs. Library content, the same for everyone and unchanged
  // between visits, so it's fetched once and shared with the Stats page's
  // cache rather than being carried on every today response.
  const { data: exercises } = useQuery({
    queryKey: ["exercises"],
    queryFn: api.exercises,
    staleTime: Infinity,
  });

  if (isLoading)
    return <p className="p-6 text-[var(--ink-faint)]">Loading today's WOD…</p>;
  if (error)
    return (
      <p className="p-6 text-[var(--danger)]">
        Couldn't reach the API — is it running on :3001?
      </p>
    );
  if (!data) return null;

  async function handleSkip() {
    await api.skipToday();
    await queryClient.invalidateQueries({ queryKey: ["today"] });
  }

  // Both close the panel first: the choice is made, and leaving the ladder
  // open over a row that has already changed reads as though it hadn't.
  async function handleSwap(wodMovementId: string, exerciseId: string) {
    setSwapMovementId(null);
    await api.setSubstitution(assignmentId, { wodMovementId, exerciseId });
    await queryClient.invalidateQueries({ queryKey: ["today"] });
  }

  async function handleRevert(wodMovementId: string) {
    setSwapMovementId(null);
    await api.clearSubstitution(assignmentId, wodMovementId);
    await queryClient.invalidateQueries({ queryKey: ["today"] });
  }

  // Just WODs is the absence of programming (DN-13), so naming it would be
  // telling the athlete about a program they never chose. Everything below
  // reads `program` rather than `data.plan` for that reason.
  const program = namedProgram(data.plan);

  if (data.isRestDay || !data.assignment) {
    return (
      <div className="p-6">
        <h1
          className="text-4xl font-extrabold uppercase leading-none"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Rest day
        </h1>
        <p className="mt-3 text-[var(--ink-soft)]">
          {restDayCopy(program, data.date)}
        </p>

        {/* de-energized instrument bank — the panel is still there, just unlit */}
        <div className="mt-6 grid grid-cols-2 gap-2.5">
          <DigitReadout value="--:--" label="Time cap" dim />
          <DigitReadout value="--" label="Rounds" dim />
        </div>
      </div>
    );
  }

  const { id: assignmentId, wod, status } = data.assignment;
  const isCompleted = status === "completed";
  const isInProgress = status === "in_progress";
  // A session already exists once in progress, so the warm-up checklist —
  // shown before a session starts — has either already run or doesn't apply.
  const hasWarmup =
    data.warmupCooldownEnabled && (data.warmup?.length ?? 0) > 0;
  const startPath =
    !isInProgress && hasWarmup
      ? `/warmup/${assignmentId}`
      : `/workout/${assignmentId}`;
  // True whenever at least one movement is on a tracked progression line
  // (Feature #2) — the scheduler already substituted every such movement
  // for the exercise at the user's current rung before this response left
  // the API. The badge says the plate has been fitted to the athlete, not
  // that it's fixed: those same rows are the ones that carry a swap control.
  const isAutoScaled = wod.movements.some((m) => m.exercise.line !== null);
  // A ladder's own scheme sets the rounds — a 21-15-9 is three rounds whether
  // or not the WOD row happens to declare it.
  const totalRounds = effectiveRounds(wod);

  return (
    <div className="flex flex-1 flex-col p-6">
      {program && <ProgramStrip plan={program} date={data.date} />}
      <h1
        className="text-5xl font-extrabold uppercase leading-none"
        style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}
      >
        {wod.name}
      </h1>
      <div className="mt-2 flex items-center gap-2">
        <p
          className="text-xs font-semibold tracking-[0.14em] text-[var(--ink-faint)]"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {wod.type.toUpperCase()}
        </p>
        {isAutoScaled && (
          <span
            className="inline-flex items-center px-2 py-0.5 text-[10px] font-bold tracking-[0.1em]"
            style={{
              fontFamily: "var(--font-mono)",
              color: "var(--glow)",
              background: "var(--glow-tint)",
            }}
          >
            AUTO-SCALED
          </span>
        )}
      </div>

      {/* how the workout is meant to be performed — engraved, not lit, and
          absent entirely on the WODs whose movement list already says it */}
      {wod.description && (
        <p className="mt-3 text-sm leading-relaxed text-[var(--ink-soft)]">
          {wod.description}
        </p>
      )}

      {/* the readout bank — the world's signature moment */}
      <div className="mt-5 grid grid-cols-2 gap-2.5">
        <DigitReadout
          value={String(wod.timeCapMinutes).padStart(2, "0")}
          label="Time cap (min)"
          size="lg"
        />
        <DigitReadout
          value={totalRounds ? String(totalRounds) : "—"}
          label="Rounds"
          size="lg"
        />
      </div>

      {/* engraved plate — the fixed layer, never editable, never lit */}
      <div
        className="mt-2.5"
        style={{
          background: "var(--panel)",
          border: "1px solid var(--border)",
        }}
      >
        <p
          className="px-4 pt-3 text-[10px] font-semibold tracking-[0.14em] text-[var(--ink-faint)]"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          MOVEMENTS
        </p>
        <div className="divide-y" style={{ borderColor: "var(--border)" }}>
          {wod.movements.map((m) => {
            const instructions = m.exercise.instructions;
            const isOpen = openMovementId === m.id;
            const panelId = `movement-instructions-${m.id}`;
            const swapPanelId = `movement-swap-${m.id}`;
            const isSwapOpen = swapMovementId === m.id;
            // Empty only where there is nothing to offer: no ladder and no
            // no-equipment alternative either (DN-80).
            const swapOptions = buildSwapOptions(
              exercises ?? [],
              m.exercise.line,
              m.exercise.id,
              // What the library asked for, where an automatic layer replaced
              // it — the one movement the athlete could read but not pick
              // until now (DN-110).
              m.prescribedId,
            );
            // A swapped row keeps its control even when the movement it now
            // holds offers nothing further — the alternative sits off every
            // line, so the ladder that led here is gone from under it and
            // revert is the only way back. Without this the swap is a
            // one-way door.
            const canSwap = swapOptions.length > 0 || m.isSwapped;

            const name = (
              <>
                <span
                  className="truncate font-semibold tracking-wide text-[var(--ink-soft)]"
                  style={{ fontFamily: "var(--font-mono)" }}
                >
                  {m.exercise.name.toUpperCase()}
                </span>
                {/* An automatic substitution used to be applied silently, so
                    the plate showed a movement the library never prescribed
                    with nothing to say it had been changed (DN-88). Quiet on
                    purpose: it marks the row without arguing about it, and
                    the swap panel carries what was prescribed and why.

                    Two different things wear this badge, and they get two
                    different words: the athlete's own standing choice, and a
                    movement dropped for equipment they do not own (DN-79). */}
                {m.prescribedName && (
                  <span
                    className="shrink-0 text-[10px] tracking-[0.1em] text-[var(--ink-faint)]"
                    style={{ fontFamily: "var(--font-mono)" }}
                  >
                    {m.prescribedReason === "equipment"
                      ? "NO KIT"
                      : "YOUR PICK"}
                  </span>
                )}
              </>
            );
            const count = (
              <span
                className="text-lg font-bold"
                style={{
                  fontFamily: "var(--font-mono)",
                  fontVariantNumeric: "tabular-nums",
                  color: "var(--ink)",
                }}
              >
                {movementCount(m)}
              </span>
            );

            return (
              <div key={m.id} style={{ borderColor: "var(--border)" }}>
                <div className="flex items-center gap-1 pr-2.5">
                  {/* The name half keeps the instructions disclosure exactly
                      as it was. A movement with no copy is still an inert
                      label — but the row it sits in is no longer inert, so
                      the two halves are separate controls rather than one. */}
                  {instructions ? (
                    <button
                      type="button"
                      onClick={() => {
                        setSwapMovementId(null);
                        setOpenMovementId(isOpen ? null : m.id);
                      }}
                      aria-expanded={isOpen}
                      aria-controls={panelId}
                      aria-label={`How to do ${m.exercise.name.toLowerCase()}`}
                      className="flex min-w-0 flex-1 items-center justify-between gap-3 py-3 pl-4 text-left"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <InstructionsCaret open={isOpen} />
                        {name}
                      </span>
                      {count}
                    </button>
                  ) : (
                    <div className="flex min-w-0 flex-1 items-center justify-between gap-3 py-3 pl-4">
                      <span className="flex min-w-0 items-center gap-2">
                        {/* Holds the caret's place so a movement without copy
                            still lines up with the ones that have it. */}
                        <span
                          aria-hidden="true"
                          style={{ width: 12, flexShrink: 0 }}
                        />
                        {name}
                      </span>
                      {count}
                    </div>
                  )}
                  {canSwap ? (
                    <SwapButton
                      name={m.exercise.name}
                      open={isSwapOpen}
                      panelId={swapPanelId}
                      onClick={() => {
                        setOpenMovementId(null);
                        setSwapMovementId(isSwapOpen ? null : m.id);
                      }}
                    />
                  ) : (
                    // Holds the control's place so an unswappable row's count
                    // still lines up with the ones that have it.
                    <span
                      aria-hidden="true"
                      style={{ width: 44, flexShrink: 0 }}
                    />
                  )}
                </div>
                {isOpen && instructions && (
                  <InstructionsPanel id={panelId} text={instructions} />
                )}
                {isSwapOpen && (
                  <SwapPanel
                    id={swapPanelId}
                    options={swapOptions}
                    isSwapped={m.isSwapped}
                    prescribedName={m.prescribedName}
                    prescribedReason={m.prescribedReason}
                    onPick={(exerciseId) => void handleSwap(m.id, exerciseId)}
                    onRevert={() => void handleRevert(m.id)}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* the panel's control row — anchored to the bottom of the instrument,
          not left to drift wherever the content happens to end */}
      <div className="mt-auto pt-6">
        {isCompleted ? (
          <button
            onClick={() => navigate(`/log/${assignmentId}`)}
            className="flex w-full items-center justify-center gap-2 py-4 text-sm font-bold tracking-[0.14em]"
            style={{
              fontFamily: "var(--font-mono)",
              background: "var(--panel-2)",
              border: "1px solid var(--border)",
              color: "var(--ink)",
            }}
          >
            <CheckIcon /> VIEW RESULT
          </button>
        ) : (
          <>
            <ToggleStart
              onClick={() => navigate(startPath)}
              label={isInProgress ? "RESUME WORKOUT" : "START WORKOUT"}
              energized={isInProgress}
            />
            {!isInProgress && (
              <button
                onClick={handleSkip}
                className="mt-3 w-full text-center text-xs font-semibold tracking-[0.08em] text-[var(--ink-faint)]"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                MARK TODAY AS REST
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * What the plate shows for a movement: the ladder as prescribed ("21-15-9")
 * where there is one, otherwise the flat count. `reps` is the ladder's total,
 * which is the one number that would tell the athlete nothing.
 */
function movementCount(m: {
  reps: number;
  repScheme: number[];
  exercise: { unit: string };
}): string {
  const suffix = m.exercise.unit === "seconds" ? "s" : "";
  if (m.repScheme.length > 0) return `${m.repScheme.join("-")}${suffix}`;
  return `${m.reps}${suffix}`;
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--ink)"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      width={16}
      height={16}
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

// The panel's physical toggle switch — flips lit when the session is live.
function ToggleStart({
  onClick,
  label,
  energized,
}: {
  onClick: () => void;
  label: string;
  energized: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center justify-center gap-3 py-4 text-sm font-bold tracking-[0.14em]"
      style={{
        fontFamily: "var(--font-mono)",
        background: energized ? "var(--glow-tint)" : "var(--glow)",
        color: energized ? "var(--glow)" : "var(--bg)",
        border: energized ? "1px solid var(--glow)" : "none",
      }}
    >
      <span
        className="inline-block h-2.5 w-2.5 rounded-full"
        style={{
          background: energized ? "var(--glow)" : "var(--bg)",
          boxShadow: energized ? "0 0 6px var(--glow)" : "none",
        }}
      />
      {label}
    </button>
  );
}

/**
 * The program worth naming, or null.
 *
 * Null covers three situations the athlete experiences identically: no
 * enrollment, a program that has not started, and Just WODs — which is a real
 * enrollment and deliberately not a program anyone chose.
 */
function namedProgram(plan: TodayPlan | null): TodayPlan | null {
  return plan && plan.planId !== DEFAULT_PLAN_ID ? plan : null;
}

/**
 * Which day of the program week a date is, Monday-first and 1-based.
 *
 * Monday-first is display-only, which is why it is computed here and not
 * carried on the response: the API's weekday numbering is Sunday-first
 * everywhere (`Date.getUTCDay()`), and program weeks align to Mon–Sun
 * calendar weeks. This is the same date the API resolved the day from, so the
 * two cannot drift.
 */
function dayOfProgramWeek(date: string): number {
  return ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
}

function restDayCopy(program: TodayPlan | null, date: string): string {
  // "Planned rest" only when the program actually planned one. A flexible
  // program defers to the athlete's own training days, and telling them the
  // program planned a day they themselves took off would be the app taking
  // credit for their decision — which is why `slotKind` is null in that case.
  if (program?.slotKind === "rest") {
    return `Planned rest — week ${program.week}, day ${dayOfProgramWeek(date)} of ${program.name}. Come back tomorrow for the next session.`;
  }
  return "Today isn't one of your training days, or it was marked as rest. Come back tomorrow for the next WOD.";
}

/** Where the athlete is in their program, above the plate. */
function ProgramStrip({ plan, date }: { plan: TodayPlan; date: string }) {
  const parts = [
    plan.name.toUpperCase(),
    plan.totalWeeks === null
      ? `WK ${plan.week}`
      : `WK ${plan.week}/${plan.totalWeeks}`,
    `D ${dayOfProgramWeek(date)}`,
    // The authored week's own name, when it has one to add — "Deload" is the
    // part of today an athlete most wants to know before they start.
    ...(plan.weekLabel ? [plan.weekLabel.toUpperCase()] : []),
  ];
  return (
    <p
      className="mb-2 text-[11px] font-bold tracking-[0.18em] text-[var(--glow)]"
      style={{ fontFamily: "var(--font-mono)" }}
    >
      {parts.join(" · ")}
    </p>
  );
}
