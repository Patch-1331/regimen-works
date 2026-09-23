import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ProgramCompletionCard } from "../components/ProgramCompletionCard";
import {
  DEFAULT_PLAN_ID,
  effectiveRounds,
  type MakeupOffer as MakeupOfferBlock,
  type PrescribedMovement,
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
  // The swap group, by movement id. Separate state from the instructions
  // above, but only one of the two is ever open: the row is a briefing line,
  // not a stack of drawers. Opening either closes the other.
  const [swapMovementId, setSwapMovementId] = useState<string | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ["today"],
    queryFn: api.today,
  });
  // The group's members. Library content, the same for everyone and unchanged
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

  async function handleMakeup() {
    await api.trainMakeup();
    await queryClient.invalidateQueries({ queryKey: ["today"] });
  }

  // Both close the panel first: the choice is made, and leaving the group
  // open over a row that has already changed reads as though it hadn't.
  async function handleSwap(wodMovementId: string, exerciseId: string) {
    setSwapMovementId(null);
    await api.setSubstitution(assignmentId, {
      wodMovementId,
      planSlotMovementId: null,
      exerciseId,
    });
    await queryClient.invalidateQueries({ queryKey: ["today"] });
  }

  async function handleRevert(wodMovementId: string) {
    setSwapMovementId(null);
    await api.clearSubstitution(assignmentId, wodMovementId);
    await queryClient.invalidateQueries({ queryKey: ["today"] });
  }

  // The same two, against a prescribed day's movements (DN-125). Separate
  // functions rather than one with a flag, because the two ids come from
  // different tables and the endpoints say so.
  async function handlePrescribedSwap(
    planSlotMovementId: string,
    exerciseId: string,
  ) {
    setSwapMovementId(null);
    await api.setSubstitution(assignmentId, {
      wodMovementId: null,
      planSlotMovementId,
      exerciseId,
    });
    await queryClient.invalidateQueries({ queryKey: ["today"] });
  }

  async function handlePrescribedRevert(planSlotMovementId: string) {
    setSwapMovementId(null);
    await api.clearPrescribedSubstitution(assignmentId, planSlotMovementId);
    await queryClient.invalidateQueries({ queryKey: ["today"] });
  }

  // Just WODs is the absence of programming (DN-13), so naming it would be
  // telling the athlete about a program they never chose. Everything below
  // reads `program` rather than `data.plan` for that reason.
  const program = namedProgram(data.plan);

  if (data.isRestDay || !data.assignment) {
    return (
      <div className="p-6">
        {data.completedProgram && (
          <ProgramCompletionCard program={data.completedProgram} />
        )}
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

        {data.makeup && (
          <MakeupOffer offer={data.makeup} onTrain={handleMakeup} />
        )}
      </div>
    );
  }

  const { id: assignmentId, wod, prescription, status } = data.assignment;

  // A prescribed day -- straight sets rather than a WOD (DN-19). Its own plate
  // rather than a variant of the one below: a WOD is scored against a clock and
  // this is not, so the two screens share the panel and almost nothing else.
  //
  // The control row at the bottom is the WOD plate's, because starting a day
  // is the one thing the two kinds of day do identically: the same warm-up,
  // the same session, the same rest-day escape. Which runner it lands on is
  // decided by the session (DN-20), not here.
  if (prescription) {
    const isPrescriptionCompleted = status === "completed";
    const isPrescriptionInProgress = status === "in_progress";
    const prescribedStartPath =
      !isPrescriptionInProgress &&
      data.warmupCooldownEnabled &&
      (data.warmup?.length ?? 0) > 0
        ? `/warmup/${assignmentId}`
        : `/workout/${assignmentId}`;

    return (
      <div className="flex flex-1 flex-col p-6">
        {data.completedProgram && (
        <ProgramCompletionCard program={data.completedProgram} />
      )}
      {program && <ProgramStrip plan={program} date={data.date} />}
        <h1
          className="text-5xl font-extrabold uppercase leading-none"
          style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}
        >
          Strength
        </h1>
        <p
          className="mt-2 text-xs font-semibold tracking-[0.14em] text-[var(--ink-faint)]"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          STRAIGHT SETS
        </p>

        {/* The instrument bank, reading what this day actually has.
            A prescribed day has no time cap and no rounds, and both of the
            obvious answers to that are wrong: dimming the WOD readouts says
            today is a lesser day, and filling them in says something false.
            So the two slots hold the two numbers a strength session does
            have — how many movements, and how many working sets in total —
            lit, because this is a session like any other. */}
        <div className="mt-5 grid grid-cols-2 gap-2.5">
          <DigitReadout
            value={String(prescription.movements.length)}
            label="Movements"
            size="lg"
          />
          <DigitReadout
            value={String(totalSets(prescription.movements))}
            label="Sets"
            size="lg"
          />
        </div>

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
            {/* Neither "MOVEMENTS", which the readout above already says, nor
                "PRESCRIBED", which is the swap panel's word for one particular
                row. A word used twice on one screen makes the reader work out
                whether the two uses mean the same thing. */}
            SESSION
          </p>
          <div className="divide-y" style={{ borderColor: "var(--border)" }}>
            {prescription.movements.map((m) => {
              const instructions = m.exercise.instructions;
              const isOpen = openMovementId === m.id;
              const panelId = `movement-instructions-${m.id}`;
              const swapPanelId = `movement-swap-${m.id}`;
              const isSwapOpen = swapMovementId === m.id;
              // Built off the exercise the athlete is actually holding, the
              // same as the WOD plate: where equipment dropped them off the
              // program's line, `prescribedId` is what puts it back on offer.
              const swapOptions = buildSwapOptions(
                exercises ?? [],
                m.exercise.movementGroup,
                m.exercise.id,
                m.prescribedId,
              );
              const canSwap = swapOptions.length > 0 || m.isSwapped;

              return (
                <div key={m.id} style={{ borderColor: "var(--border)" }}>
                  <div className="flex items-center gap-1 pr-2.5">
                    <PrescribedName
                      instructions={instructions}
                      isOpen={isOpen}
                      panelId={panelId}
                      movement={m}
                      onToggle={() => {
                        setSwapMovementId(null);
                        setOpenMovementId(isOpen ? null : m.id);
                      }}
                    />
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
                      onPick={(exerciseId) =>
                        void handlePrescribedSwap(m.id, exerciseId)
                      }
                      onRevert={() => void handlePrescribedRevert(m.id)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-auto pt-6">
          {isPrescriptionCompleted ? (
            // The WOD plate's control, word for word. This said SESSION
            // COMPLETE and did nothing while a strength day had no result to
            // view (DN-126); now it has one, and a finished day is a finished
            // day whichever kind it was.
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
                onClick={() => navigate(prescribedStartPath)}
                label={
                  isPrescriptionInProgress ? "RESUME SESSION" : "START SESSION"
                }
                energized={isPrescriptionInProgress}
              />
              {!isPrescriptionInProgress && (
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

  // Neither a WOD nor a prescription is a row the API refuses to build --
  // `todayAssignmentSchema` states the xor -- so there is nothing honest to
  // render here and nothing to say about it.
  if (!wod) return null;

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
  // True whenever at least one movement is on a tracked movement groups
  // (Feature #2) — the scheduler already substituted every such movement
  // for the movement the athlete had chosen before this response left
  // the API. The badge says the plate has been fitted to the athlete, not
  // that it's fixed: those same rows are the ones that carry a swap control.
  const isAutoScaled = wod.movements.some((m) => m.exercise.movementGroup !== null);
  // A ladder's own scheme sets the rounds — a 21-15-9 is three rounds whether
  // or not the WOD row happens to declare it.
  const totalRounds = effectiveRounds(wod);

  return (
    <div className="flex flex-1 flex-col p-6">
      {data.completedProgram && (
        <ProgramCompletionCard program={data.completedProgram} />
      )}
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
            // Empty only where there is nothing to offer: no group and no
            // no-equipment alternative either (DN-80).
            const swapOptions = buildSwapOptions(
              exercises ?? [],
              m.exercise.movementGroup,
              m.exercise.id,
              // What the library asked for, where an automatic layer replaced
              // it — the one movement the athlete could read but not pick
              // until now (DN-110).
              m.prescribedId,
            );
            // A swapped row keeps its control even when the movement it now
            // holds offers nothing further — the alternative sits off every
            // line, so the group that led here is gone from under it and
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

/** How many working sets the whole day comes to. */
function totalSets(movements: PrescribedMovement[]): number {
  return movements.reduce((sum, m) => sum + m.sets, 0);
}

/**
 * One row of a prescribed day's plate (DN-125).
 *
 * Deliberately its own component rather than a shape shared with the WOD
 * plate's rows. The two look alike and are not the same row: this one carries
 * sets × reps and a prescribed rest, and a WOD's carries a ladder that a rest
 * interval would have nothing to do with. One component covering both would be
 * a parameter per difference.
 *
 * What it does keep identical is the disclosure behaviour: a movement with no
 * written copy is an inert label, the row it sits in is not, and the caret's
 * width is held either way so the two line up.
 */
function PrescribedName({
  instructions,
  isOpen,
  panelId,
  movement,
  onToggle,
}: {
  instructions: string | null;
  isOpen: boolean;
  panelId: string;
  movement: PrescribedMovement;
  onToggle: () => void;
}) {
  const name = (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="flex min-w-0 items-center gap-2">
        <span
          className="truncate font-semibold tracking-wide text-[var(--ink-soft)]"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {movement.exercise.name.toUpperCase()}
        </span>
        {/* Only equipment can move a prescribed movement without the athlete
            asking (DN-19) — resolving the group through their choice is the
            prescription rather than a substitution for it — so there is one
            word here where the WOD plate has two. */}
        {movement.prescribedName && (
          <span
            className="shrink-0 text-[10px] tracking-[0.1em] text-[var(--ink-faint)]"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            NO KIT
          </span>
        )}
      </span>
      {/* Rest sits under the name rather than beside the count: it is part of
          the prescription, and a rest interval crammed in next to "5 × 3"
          stops that being a number anyone reads at a glance. */}
      <span
        className="text-[10px] tracking-[0.1em] text-[var(--ink-faint)]"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {restCopy(movement.restSeconds)}
      </span>
    </span>
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
      {movement.sets} × {movement.reps}
      {movement.exercise.unit === "seconds" ? "s" : ""}
    </span>
  );

  if (!instructions) {
    return (
      <div className="flex min-w-0 flex-1 items-center justify-between gap-3 py-3 pl-4">
        <span className="flex min-w-0 items-center gap-2">
          <span aria-hidden="true" style={{ width: 12, flexShrink: 0 }} />
          {name}
        </span>
        {count}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={isOpen}
      aria-controls={panelId}
      aria-label={`How to do ${movement.exercise.name.toLowerCase()}`}
      className="flex min-w-0 flex-1 items-center justify-between gap-3 py-3 pl-4 text-left"
    >
      <span className="flex min-w-0 items-center gap-2">
        <InstructionsCaret open={isOpen} />
        {name}
      </span>
      {count}
    </button>
  );
}

/**
 * The prescribed rest between sets.
 *
 * Zero is a prescription rather than an omission — the author meant "straight
 * through" — so it gets words instead of "REST 0S", which reads as a field
 * nobody filled in.
 */
function restCopy(restSeconds: number): string {
  if (restSeconds === 0) return "STRAIGHT THROUGH";
  if (restSeconds % 60 === 0) return `REST ${restSeconds / 60}M`;
  return `REST ${restSeconds}S`;
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

/**
 * The offer to train on a rest day while the week is still short (DN-17).
 *
 * The week is the unit of completion: training days say when the app expects
 * the athlete, not when they are allowed. Rendered only when the API offers
 * it, which is never under a fixed program and never once the week is done.
 *
 * The copy is careful. "Short" is a fact about the week, not about the
 * athlete, and there is no debt language anywhere in it: nothing here says
 * behind, owed, missed or caught up. An athlete who simply rests has been
 * told nothing except that the door is open.
 */
function MakeupOffer({
  offer,
  onTrain,
}: {
  offer: MakeupOfferBlock;
  onTrain: () => void;
}) {
  const short = offer.sessionsThisWeek - offer.completedThisWeek;
  return (
    <div className="mt-8">
      <button
        onClick={onTrain}
        className="w-full rounded-sm border border-[var(--ink-faint)] py-3 text-center text-xs font-semibold tracking-[0.14em] text-[var(--ink)]"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        TRAIN ANYWAY
      </button>
      <p className="mt-2 text-center text-xs text-[var(--ink-faint)]">
        {short} {short === 1 ? "session" : "sessions"} short this week — they
        count whichever day you do them.
      </p>
    </div>
  );
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
