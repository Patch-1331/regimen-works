import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  formatSetsResult,
  parseSetsResult,
  wasCappedFinish,
  PRESCRIBED_DAY_NAME,
  type Prescription,
  type ResultType,
  type WorkoutLog,
  type WorkoutSession,
  type WorkoutSetLog,
  type Wod,
} from "@regimen-works/shared";
import { api } from "../lib/api";
import { formatClock } from "../lib/clock";
import { MinusIcon, PlusIcon } from "../components/StepperIcons";
import { MovementChangeCard } from "../components/MovementChangeCard";
import { CompletionCard } from "../components/CompletionCard";
import { useMovementChangeCard } from "../lib/movementChangeDismissal";
import { compareToLastSession, trainingDaysThisWeek } from "../lib/stats";

/**
 * What today was, as this screen needs to read it (DN-126).
 *
 * The two kinds of day share this form rather than getting one each: the
 * header, the completion card, the movement-change offer, RPE, notes and the save
 * are the same screen either way, and only the result itself differs. A
 * union rather than two nullable fields, so "neither" and "both" cannot be
 * written down -- the same rule `todayAssignmentSchema` enforces at the API.
 */
type LogDay =
  | { kind: "wod"; wod: Wod }
  | { kind: "prescribed"; prescription: Prescription };

function resultTypeForWod(wodType: string): ResultType {
  return wodType === "for_time" ? "time_seconds" : "rounds_reps";
}

function splitMMSS(totalSeconds: number) {
  return { m: Math.floor(totalSeconds / 60), s: totalSeconds % 60 };
}

const inputStyle = { borderColor: "var(--border)", background: "var(--panel-2)", color: "var(--ink)" };

export function LogResultPage() {
  const { assignmentId = "" } = useParams();

  const { data: today, isLoading: todayLoading } = useQuery({ queryKey: ["today"], queryFn: api.today });
  const { data: existingLog, isLoading: logLoading } = useQuery({
    queryKey: ["log", assignmentId],
    queryFn: () => api.getLog(assignmentId),
    enabled: assignmentId !== "",
  });
  // Only for "third day you've trained this week" on the completion card. The
  // page renders without it rather than waiting — the card is the least
  // important thing on a screen whose job is saving a result.
  const { data: logs } = useQuery({ queryKey: ["logs"], queryFn: api.logs });

  const assignment = today?.assignment;
  // A prescribed day has no WOD, and until DN-126 that was indistinguishable
  // here from "nothing loaded yet" -- so a strength day parked on Loading
  // forever and the screens routed around it.
  const day: LogDay | null = assignment?.wod
    ? { kind: "wod", wod: assignment.wod }
    : assignment?.prescription
      ? { kind: "prescribed", prescription: assignment.prescription }
      : null;

  if (todayLoading || logLoading || !day) {
    return <p className="p-6 text-[var(--ink-faint)]">Loading…</p>;
  }

  return (
    <LogResultForm
      assignmentId={assignmentId}
      day={day}
      session={today?.assignment?.session ?? null}
      existingLog={existingLog ?? null}
      todayIsoDate={today?.date ?? ""}
      loggedDates={(logs ?? []).map((l) => l.date)}
    />
  );
}

function LogResultForm({
  assignmentId,
  day,
  session,
  existingLog,
  todayIsoDate,
  loggedDates,
}: {
  assignmentId: string;
  day: LogDay;
  session: WorkoutSession | null;
  existingLog: WorkoutLog | null;
  todayIsoDate: string;
  loggedDates: string[];
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const resultType: ResultType =
    day.kind === "wod" ? resultTypeForWod(day.wod.type) : "sets_completed";
  const name = day.kind === "wod" ? day.wod.name : PRESCRIBED_DAY_NAME;
  // What the day prescribes, summed across its movements. The denominator the
  // athlete is counted against, and the one the API checks the saved result's
  // own denominator against — so a form that sent a different number would be
  // refused rather than quietly stored.
  const totalSets =
    day.kind === "prescribed"
      ? day.prescription.movements.reduce((sum, m) => sum + m.sets, 0)
      : 0;

  // Computed once at mount from whatever's already loaded — a timer session's
  // rounds/finish time, a straight-sets session's set count, an existing log
  // being edited, or a blank slate.
  const initial = deriveInitialValues(resultType, session, existingLog, totalSets);

  const [rounds, setRounds] = useState(initial.rounds);
  const [reps, setReps] = useState(initial.reps);
  const [minutes, setMinutes] = useState(initial.minutes);
  const [seconds, setSeconds] = useState(initial.seconds);
  const [setsDone, setSetsDone] = useState(initial.setsDone);
  const [rpe, setRpe] = useState<number | null>(existingLog?.rpe ?? null);
  const [notes, setNotes] = useState(existingLog?.notes ?? "");

  // The sets the runner wrote down (DN-21). Only a prescribed day has any,
  // and only once a session exists -- there is nothing to read back on a day
  // the athlete is logging from memory without having run it.
  const { data: setLogs } = useQuery({
    queryKey: ["set-logs", assignmentId],
    queryFn: () => api.setLogs(assignmentId),
    enabled: day.kind === "prescribed" && session !== null,
  });

  // Every session of every movement, so the completion card can put today's
  // beside the one before it (DN-22). Read on the same condition as the rows
  // above: a WOD day has no movements to compare, and a day logged from
  // memory has no session of its own in the answer to find.
  const { data: movementVolume } = useQuery({
    queryKey: ["movementVolume"],
    queryFn: api.movementVolume,
    enabled: day.kind === "prescribed" && session !== null,
  });

  // Corrections, keyed by position, and only for the sets actually touched.
  // Pre-filling this from the rows would make every set look edited and send
  // the whole session back on save; absent means "as it was recorded".
  const [editedReps, setEditedReps] = useState<Record<string, number>>({});

  // What today's swaps offer to make permanent (WOD-6). Declining is
  // remembered per assignment, so coming back to edit a note doesn't re-ask a
  // question already answered.
  const { dismissed, dismiss } = useMovementChangeCard(assignmentId);
  const { data: proposals } = useQuery({
    queryKey: ["movement-changes", assignmentId],
    queryFn: () => api.proposedMovementChanges(assignmentId),
    enabled: !dismissed,
  });

  const acceptMovementChanges = useMutation({
    mutationFn: async () => {
      // Sequential rather than parallel: these are separate rows and a
      // partial failure should leave the earlier ones written, not race.
      for (const p of proposals ?? []) {
        await api.setSkillLevel(p.movementGroup, { exerciseId: p.toExerciseId });
      }
    },
    onSuccess: async () => {
      dismiss();
      await queryClient.invalidateQueries({ queryKey: ["skillLevels"] });
      // Today's plate reads through the choice, so it has to be re-derived.
      await queryClient.invalidateQueries({ queryKey: ["today"] });
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      // Before the result, because the result is what navigates away: a
      // correction lost to a failed request would be lost silently, and the
      // athlete would have no way to tell it had not been written.
      const corrections = (setLogs ?? [])
        .filter((row) => keyOf(row) in editedReps)
        .map((row) => ({
          movementOrder: row.movementOrder,
          setNumber: row.setNumber,
          actualReps: editedReps[keyOf(row)],
        }));
      if (corrections.length > 0) {
        await api.editSetLogs(assignmentId, { sets: corrections });
      }

      const resultValue =
        resultType === "time_seconds"
          ? String(minutes * 60 + seconds)
          : resultType === "sets_completed"
            ? formatSetsResult({ completed: setsDone, total: totalSets })
            : `${rounds}+${reps}`;
      return api.saveLog(assignmentId, { resultType, resultValue, rpe, notes: notes || null });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["today"] });
      await queryClient.invalidateQueries({ queryKey: ["logs"] });
      await queryClient.invalidateQueries({ queryKey: ["set-logs", assignmentId] });
      navigate("/history");
    },
  });

  return (
    <div className="mx-auto max-w-md p-6">
      <button onClick={() => navigate(-1)} aria-label="Back" className="mb-4">
        <svg viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" width={22} height={22}>
          <path d="M14.5 5 8 12l6.5 7" />
        </svg>
      </button>

      <h1 className="text-4xl font-extrabold uppercase leading-none" style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}>
        {name}
      </h1>
      <p className="mt-1 text-xs font-semibold tracking-[0.1em] text-[var(--ink-faint)]" style={{ fontFamily: "var(--font-mono)" }}>
        {day.kind === "wod"
          ? `${day.wod.type.toUpperCase()} · ${day.wod.timeCapMinutes} MIN`
          : // No cap to report, because a prescribed day has no clock over it
            // (DN-20). The set count is what it has instead.
            `STRAIGHT SETS · ${totalSets} SETS`}
      </p>
      {day.kind === "wod" && day.wod.description && (
        <p className="mt-2 text-sm leading-relaxed text-[var(--ink-soft)]">{day.wod.description}</p>
      )}

      {/* Marks the session on arrival, not on save: the workout is over by the
          time this screen opens, and saving the result is bookkeeping after
          the fact. An existing log means the athlete came back to edit
          something, which is not a finish and gets no card.

          It carries what the timer strip used to say, since that note is only
          relevant on exactly the same screens (DN-8). */}
      {!existingLog && todayIsoDate !== "" && (
        <CompletionCard
          wodName={name}
          trainingDaysThisWeek={trainingDaysThisWeek(loggedDates, todayIsoDate)}
          fromTimer={session !== null}
          comparisons={compareToLastSession(movementVolume ?? [], assignmentId)}
        />
      )}

      {day.kind === "wod" && resultType === "time_seconds" && session && wasCappedFinish(session) && (
        // Only where the cap changes what the score means. A For Time that ran
        // out of road is capped rather than completed, and the time below reads
        // exactly at the cap because that is where the clock stopped. An
        // AMRAP/EMOM/Tabata always runs to its cap, so saying so there would be
        // noise — the rounds are the score either way.
        <div
          className="mt-4 flex items-center gap-2 px-3 py-2 text-xs"
          style={{ border: "1px solid var(--danger)", background: "var(--danger-tint)", color: "var(--danger)", fontFamily: "var(--font-mono)" }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={14} height={14}>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
          Time cap reached — the clock stopped at {formatClock(session.capSeconds ?? day.wod.timeCapMinutes * 60)}
        </div>
      )}

      {!dismissed && (
        <MovementChangeCard
          proposals={proposals ?? []}
          onAccept={() => acceptMovementChanges.mutate()}
          onDismiss={dismiss}
          isSaving={acceptMovementChanges.isPending}
        />
      )}

      <p className="mt-6 text-xs font-semibold tracking-[0.14em] text-[var(--ink-faint)]" style={{ fontFamily: "var(--font-mono)" }}>
        RESULT
      </p>

      {resultType === "time_seconds" ? (
        <div className="mt-3 flex items-center gap-3">
          <input
            type="number"
            min={0}
            value={minutes}
            onChange={(e) => setMinutes(Math.max(0, Number(e.target.value)))}
            className="w-20 border px-3 py-2 text-center text-xl"
            style={{ ...inputStyle, fontFamily: "var(--font-mono)" }}
          />
          <span className="text-xl" style={{ fontFamily: "var(--font-mono)", color: "var(--ink)" }}>:</span>
          <input
            type="number"
            min={0}
            max={59}
            value={seconds}
            onChange={(e) => setSeconds(Math.min(59, Math.max(0, Number(e.target.value))))}
            className="w-20 border px-3 py-2 text-center text-xl"
            style={{ ...inputStyle, fontFamily: "var(--font-mono)" }}
          />
        </div>
      ) : resultType === "sets_completed" ? (
        <div className="mt-3 flex items-center gap-4">
          {/* Bounded by the prescription rather than open-ended: the athlete is
              saying how much of *this day* they got through, and a count above
              the total is not a bigger session, it is a number the API will
              refuse. Pre-filled from the runner, so finishing the whole thing
              is one tap on SAVE. */}
          <Stepper label="SETS DONE" value={setsDone} onChange={setSetsDone} max={totalSets} />
          <span
            className="text-2xl font-bold text-[var(--ink-faint)]"
            style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}
          >
            of {totalSets}
          </span>
        </div>
      ) : (
        <div className="mt-3 flex gap-3">
          <Stepper label="ROUNDS" value={rounds} onChange={setRounds} />
          <Stepper label="+ REPS" value={reps} onChange={setReps} />
        </div>
      )}

      {day.kind === "prescribed" && (setLogs ?? []).length > 0 && (
        <>
          <p className="mt-6 text-xs font-semibold tracking-[0.14em] text-[var(--ink-faint)]" style={{ fontFamily: "var(--font-mono)" }}>
            REPS PER SET
          </p>
          {/* Pre-filled with what the runner recorded, which is the day as
              prescribed: the screen asks for a tap per set, not a count. This
              is where "I said three and did two" gets written down, and it is
              asked here rather than mid-workout because the athlete counting
              reps into a form between sets costs more than the reading is
              worth. Left alone, every set saves exactly as it was run. */}
          <div className="mt-3 flex flex-col gap-2">
            {(setLogs ?? []).map((row) => (
              <SetRepsRow
                key={row.id}
                row={row}
                name={movementName(day.prescription, row.movementOrder)}
                value={editedReps[keyOf(row)] ?? row.actualReps}
                onChange={(n) =>
                  setEditedReps((edits) => ({ ...edits, [keyOf(row)]: n }))
                }
              />
            ))}
          </div>
        </>
      )}

      <p className="mt-6 text-xs font-semibold tracking-[0.14em] text-[var(--ink-faint)]" style={{ fontFamily: "var(--font-mono)" }}>
        EFFORT (RPE)
      </p>
      <div className="mt-3 grid grid-cols-10 gap-1.5">
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            onClick={() => setRpe(n)}
            className="py-2 text-sm font-semibold"
            style={
              rpe === n
                ? { background: "var(--glow)", color: "var(--bg)", fontFamily: "var(--font-mono)" }
                : { background: "var(--panel-2)", border: "1px solid var(--border)", color: "var(--ink-soft)", fontFamily: "var(--font-mono)" }
            }
          >
            {n}
          </button>
        ))}
      </div>

      <p className="mt-6 text-xs font-semibold tracking-[0.14em] text-[var(--ink-faint)]" style={{ fontFamily: "var(--font-mono)" }}>
        NOTES
      </p>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={3}
        placeholder="How did it feel?"
        className="mt-3 w-full border p-3 text-sm"
        style={inputStyle}
      />

      <button
        onClick={() => saveMutation.mutate()}
        disabled={saveMutation.isPending}
        className="mt-6 w-full py-4 text-sm font-bold tracking-[0.14em]"
        style={{ background: "var(--glow)", color: "var(--bg)", fontFamily: "var(--font-mono)" }}
      >
        SAVE RESULT
      </button>
    </div>
  );
}

/** A set's position, which is what identifies it — the row id is the server's. */
function keyOf(row: { movementOrder: number; setNumber: number }) {
  return `${row.movementOrder}:${row.setNumber}`;
}

/**
 * What the movement at this position is called.
 *
 * `movementOrder` indexes the session's own snapshot, and the prescription is
 * that same list read live, so a program that has since reordered the slot
 * can leave a row with no match. Named by its position in that case rather
 * than dropped: the set was done, and hiding it would lose a correction the
 * athlete can still make.
 */
function movementName(prescription: Prescription, movementOrder: number): string {
  const movement = prescription.movements.find((m) => m.order === movementOrder);
  return movement?.exercise.name ?? `Movement ${movementOrder + 1}`;
}

function SetRepsRow({
  row,
  name,
  value,
  onChange,
}: {
  row: WorkoutSetLog;
  name: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex items-center gap-3 border px-3 py-2" style={inputStyle}>
      <span className="flex-1 truncate text-sm" style={{ color: "var(--ink-soft)" }}>
        <span className="uppercase">{name}</span>
        <span className="text-[var(--ink-faint)]" style={{ fontFamily: "var(--font-mono)" }}>
          {" "}· SET {row.setNumber}
        </span>
      </span>
      <input
        type="number"
        min={0}
        value={value}
        // Named with the set it belongs to, because a column of bare number
        // boxes says nothing about which set a reading is for.
        aria-label={`${name} set ${row.setNumber} reps`}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value)))}
        className="w-16 border px-2 py-1 text-center text-sm"
        style={{ ...inputStyle, fontFamily: "var(--font-mono)" }}
      />
      <span className="w-14 text-right text-xs text-[var(--ink-faint)]" style={{ fontFamily: "var(--font-mono)" }}>
        of {row.prescribedReps}
      </span>
    </div>
  );
}

function deriveInitialValues(
  resultType: ResultType,
  session: WorkoutSession | null,
  existingLog: WorkoutLog | null,
  totalSets: number,
) {
  const blank = { minutes: 0, seconds: 0, rounds: 0, reps: 0, setsDone: 0 };

  if (existingLog) {
    if (existingLog.resultType === "time_seconds") {
      const { m, s } = splitMMSS(Number(existingLog.resultValue) || 0);
      return { ...blank, minutes: m, seconds: s };
    }
    if (existingLog.resultType === "sets_completed") {
      // Clamped to today's total, not the saved one: an editor opened after
      // the program changed the day would otherwise show a count the stepper
      // cannot get back to and the API will not accept.
      const sets = parseSetsResult(existingLog.resultValue);
      return { ...blank, setsDone: Math.min(sets?.completed ?? 0, totalSets) };
    }
    const [r, x] = existingLog.resultValue.split("+").map((v) => Number(v) || 0);
    return { ...blank, rounds: r ?? 0, reps: x ?? 0 };
  }

  if (session) {
    if (resultType === "time_seconds") {
      const total = session.finishedAtSeconds ?? session.roundSplits.at(-1)?.atSeconds ?? 0;
      const { m, s } = splitMMSS(total);
      return { ...blank, minutes: m, seconds: s };
    }
    if (resultType === "sets_completed") {
      // Clamped for the same reason `straightSetsStateAt` clamps: a session
      // resumed against its own snapshot can outrun the live prescription.
      return { ...blank, setsDone: Math.min(session.setsCompleted ?? 0, totalSets) };
    }
    return { ...blank, rounds: session.roundSplits.length };
  }

  return blank;
}

function Stepper({
  label,
  value,
  onChange,
  max,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  /** Upper bound, where the count has one. Omitted leaves the stepper open-ended. */
  max?: number;
}) {
  const atMax = max !== undefined && value >= max;
  return (
    <div className="flex-1 border p-4 text-center" style={inputStyle}>
      <p className="text-[11px] font-semibold tracking-[0.1em] text-[var(--ink-faint)]" style={{ fontFamily: "var(--font-mono)" }}>
        {label}
      </p>
      <div className="mt-2 flex items-center justify-center gap-4">
        <button
          onClick={() => onChange(Math.max(0, value - 1))}
          aria-label={`Decrease ${label}`}
          className="flex h-7 w-7 items-center justify-center rounded-full border"
          style={{ borderColor: "var(--border)", color: "var(--ink-faint)" }}
        >
          <MinusIcon color="var(--ink-faint)" />
        </button>
        <span
          // Labelled so the count is addressable on its own. The digits here
          // and the RPE buttons below are the same handful of numerals, and
          // "the 5 on the screen" is otherwise ambiguous to a screen reader
          // for exactly the reason it is ambiguous to a test.
          aria-label={label}
          className="min-w-[2rem] text-2xl font-bold"
          style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", color: "var(--glow)", textShadow: "0 0 8px var(--glow-tint)" }}
        >
          {value}
        </span>
        <button
          onClick={() => onChange(max === undefined ? value + 1 : Math.min(max, value + 1))}
          disabled={atMax}
          aria-label={`Increase ${label}`}
          className="flex h-7 w-7 items-center justify-center rounded-full border"
          style={
            atMax
              ? { borderColor: "var(--border)", color: "var(--ink-faint)", opacity: 0.4 }
              : { borderColor: "var(--glow)", color: "var(--glow)" }
          }
        >
          <PlusIcon color={atMax ? "var(--ink-faint)" : "var(--glow)"} />
        </button>
      </div>
    </div>
  );
}
