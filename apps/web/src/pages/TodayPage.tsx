import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ProgramCompletionCard } from "../components/ProgramCompletionCard";
import {
  DEFAULT_PROGRAM_ID,
  effectiveRounds,
  type MakeupOffer as MakeupOfferBlock,
  type NotStartedProgram,
  type PrescribedMovement,
  type RunningProgram,
  type TodayProgram,
} from "@regimen-works/shared";
import { api } from "../lib/api";
import { DigitReadout } from "../components/DigitReadout";
import { InstructionsCaret, InstructionsPanel } from "../components/MovementInstructions";
import { hasInstructions } from "../lib/instructions";
import { LiveSwapPanel, SwapButton } from "../components/MovementSwap";
import { canSwap as swappable } from "../lib/swapOptions";
import { movementCount } from "../lib/movementCount";
import { setByStep, uniformCount } from "../lib/prescribedSets";
import { WEEKDAYS, weekdayName } from "../lib/weekdays";

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

  async function handleStartToday() {
    const day = await api.startProgramToday();
    queryClient.setQueryData(["today"], day);
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
      programSlotMovementId: null,
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
    programSlotMovementId: string,
    exerciseId: string,
  ) {
    setSwapMovementId(null);
    await api.setSubstitution(assignmentId, {
      wodMovementId: null,
      programSlotMovementId,
      exerciseId,
    });
    await queryClient.invalidateQueries({ queryKey: ["today"] });
  }

  async function handlePrescribedRevert(programSlotMovementId: string) {
    setSwapMovementId(null);
    await api.clearPrescribedSubstitution(assignmentId, programSlotMovementId);
    await queryClient.invalidateQueries({ queryKey: ["today"] });
  }

  // Just WODs is the absence of programming (DN-13), so naming it would be
  // telling the athlete about a program they never chose. Everything below
  // reads `program` rather than `data.program` for that reason.
  const program = namedProgram(data.program);

  // Before the start date there is nothing to train (DN-200), so the day is
  // the wait itself. Only with no assignment: a day already under way from
  // before the athlete chose the program is still theirs to finish.
  if (data.program?.status === "not-started" && !data.assignment) {
    return (
      <ProgramNotStarted
        program={data.program}
        today={data.date}
        onStartToday={handleStartToday}
        onLookThrough={() => navigate("/programs")}
      />
    );
  }

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
      {program && <ProgramStrip program={program} date={data.date} />}
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
              // The options are read when the panel opens (DN-170); whether
              // the row has a control at all is decided here, the same as on
              // the WOD plate.
              const canSwap = swappable(m.exercise, m);

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
                  {isOpen && hasInstructions(instructions) && (
                    <InstructionsPanel id={panelId} steps={instructions} />
                  )}
                  {isSwapOpen && (
                    <LiveSwapPanel
                      id={swapPanelId}
                      assignmentId={assignmentId}
                      swapKey={{ wodMovementId: null, programSlotMovementId: m.id }}
                      current={m.exercise}
                      prescribedId={m.prescribedId}
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
      {program && <ProgramStrip program={program} date={data.date} />}
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
            // Only where there is something to match on, or a way back: a
            // swapped or substituted row keeps its control whatever it now
            // holds, because revert is the only way back and without it the
            // swap is a one-way door. The options themselves are read when
            // the panel opens (DN-170).
            const canSwap = swappable(m.exercise, m);

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
                  {hasInstructions(instructions) ? (
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
                {isOpen && hasInstructions(instructions) && (
                  <InstructionsPanel id={panelId} steps={instructions} />
                )}
                {isSwapOpen && (
                  <LiveSwapPanel
                    id={swapPanelId}
                    assignmentId={assignmentId}
                    swapKey={{ wodMovementId: m.id, programSlotMovementId: null }}
                    current={m.exercise}
                    prescribedId={m.prescribedId}
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

/** How many working sets the whole day comes to. */
function totalSets(movements: PrescribedMovement[]): number {
  return movements.reduce((sum, m) => sum + m.sets.length, 0);
}

/**
 * The rest between the line's sets, or "varies" where they differ. The rest
 * after the last set is left out: it is the pace's, not the line's, and it is
 * what lets a drop set read as straight through (ADR 0011, decision 4).
 */
function lineRest(movement: PrescribedMovement): number | null | "varies" {
  const between =
    movement.sets.length > 1 ? movement.sets.slice(0, -1) : movement.sets;
  const [first, ...more] = between.map((s) => s.restSeconds);
  return more.every((r) => r === first) ? first : "varies";
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
  instructions: readonly string[];
  isOpen: boolean;
  panelId: string;
  movement: PrescribedMovement;
  onToggle: () => void;
}) {
  const eachCount = uniformCount(movement.sets, movement.exercise.unit);
  const rest = lineRest(movement);
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
          stops that being a number anyone reads at a glance. No line at all
          where nobody stated a rest: "STRAIGHT THROUGH" there would be a
          prescription the source never made (DN-143). */}
      {eachCount === null && (
        <span
          className="text-xs tracking-[0.05em] text-[var(--ink-soft)]"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {setByStep(movement.sets, movement.exercise.unit)}
        </span>
      )}
      {rest !== null && (
        <span
          className="text-[10px] tracking-[0.1em] text-[var(--ink-faint)]"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {rest === "varies" ? "REST VARIES" : restCopy(rest)}
        </span>
      )}
    </span>
  );
  const count = (
    <span
      className="shrink-0 whitespace-nowrap text-lg font-bold"
      style={{
        fontFamily: "var(--font-mono)",
        fontVariantNumeric: "tabular-nums",
        color: "var(--ink)",
      }}
    >
      {eachCount === null
        ? `${movement.sets.length} SETS`
        : `${movement.sets.length} × ${eachCount}`}
    </span>
  );

  if (!hasInstructions(instructions)) {
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
 * nobody filled in. Null -- no rest stated anywhere -- never reaches here.
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
 * enrollment, a program that has not started — which has a screen of its own
 * (DN-200) — and Just WODs, which is a real enrollment and deliberately not a
 * program anyone chose.
 */
function namedProgram(program: TodayProgram | null): RunningProgram | null {
  return program?.status === "running" && program.programId !== DEFAULT_PROGRAM_ID
    ? program
    : null;
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

function restDayCopy(program: RunningProgram | null, date: string): string {
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
function ProgramStrip({ program, date }: { program: RunningProgram; date: string }) {
  const parts = [
    program.name.toUpperCase(),
    program.totalWeeks === null
      ? `WK ${program.week}`
      : `WK ${program.week}/${program.totalWeeks}`,
    `D ${dayOfProgramWeek(date)}`,
    // The authored week's own name, when it has one to add — "Deload" is the
    // part of today an athlete most wants to know before they start.
    ...(program.weekLabel ? [program.weekLabel.toUpperCase()] : []),
    // And the day's, from a program that names its days (DN-155).
    ...(program.dayLabel ? [program.dayLabel.toUpperCase()] : []),
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

/**
 * Today before the program's start date (DN-200): how long to go, when it
 * begins and what comes first, and the way to begin now instead.
 *
 * No rest-day plate and no makeup: nothing is owed on a day the athlete chose
 * not to start yet, and dimmed instruments would say otherwise.
 */
function ProgramNotStarted({
  program,
  today,
  onStartToday,
  onLookThrough,
}: {
  program: NotStartedProgram;
  today: string;
  onStartToday: () => Promise<void>;
  onLookThrough: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const daysToGo = daysBetween(today, program.startDate);
  const first = program.firstSession;
  const picked = WEEKDAYS.filter((d) => program.trainingDays.includes(d.value))
    .map((d) => d.short)
    .join(" · ");

  async function startToday() {
    setBusy(true);
    setFailed(null);
    try {
      await onStartToday();
    } catch (e) {
      setFailed(e instanceof Error ? e.message : "Couldn't start the program.");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col justify-center p-6">
      <p
        className="text-xs font-bold tracking-[0.18em] text-[var(--glow)]"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {daysToGo} {daysToGo === 1 ? "DAY" : "DAYS"} TO GO
      </p>
      <h1
        className="mt-3 text-4xl font-extrabold uppercase leading-none"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {program.name} starts {startsWord(today, program.startDate)}
      </h1>
      <p className="mt-3 text-[var(--ink-soft)]">
        {picked ? `You picked ${picked}. ` : ""}Nothing to do today.
      </p>

      {first && (
        <section
          className="mt-6 rounded-sm p-4"
          style={{ background: "var(--panel)", border: "1px solid var(--ink-faint)" }}
        >
          <p
            className="text-xs tracking-[0.18em] text-[var(--ink-soft)]"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {shortDate(first.date)} · FIRST UP
          </p>
          <h2 className="mt-2 text-2xl font-bold">{sessionName(first)}</h2>
          {sessionFacts(first) && (
            <p className="mt-1 text-[var(--ink-soft)]">{sessionFacts(first)}</p>
          )}
        </section>
      )}

      <button
        onClick={startToday}
        disabled={busy}
        className="mt-8 self-start text-sm font-semibold tracking-[0.14em] text-[var(--glow)] underline underline-offset-4"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        START TODAY INSTEAD →
      </button>
      {failed && <p className="mt-2 text-sm text-[var(--danger)]">{failed}</p>}

      <button
        onClick={onLookThrough}
        className="mt-8 self-start text-sm tracking-[0.14em] text-[var(--ink-soft)]"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        LOOK THROUGH THE PROGRAM
      </button>
    </div>
  );
}

function daysBetween(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/** "tomorrow", a weekday within the week, or the date beyond it. */
function startsWord(today: string, startDate: string): string {
  const days = daysBetween(today, startDate);
  if (days === 1) return "tomorrow";
  if (days < 7) return weekdayName(new Date(`${startDate}T00:00:00Z`).getUTCDay());
  return shortDate(startDate).toLowerCase().replace(/^\w+ /, "");
}

/** "MON 21 SEP" — the plate's own date style. */
function shortDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const weekday = WEEKDAYS.find((w) => w.value === d.getUTCDay())?.short ?? "";
  return `${weekday} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`.toUpperCase();
}

// Spelled out rather than asked of the locale, which says "Sept" in some.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function sessionName(first: NonNullable<NotStartedProgram["firstSession"]>): string {
  if (first.name) return first.name;
  return first.slotKind === "movements" ? "Strength" : "A WOD picked on the day";
}

function sessionFacts(first: NonNullable<NotStartedProgram["firstSession"]>): string {
  return [
    first.movementCount === null
      ? null
      : `${first.movementCount} ${first.movementCount === 1 ? "movement" : "movements"}`,
    first.minutes === null ? null : `about ${first.minutes} minutes`,
  ]
    .filter(Boolean)
    .join(" · ");
}
