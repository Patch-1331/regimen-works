import { useState } from "react";
import {
  movementPattern,
  wodType,
  type CreateWod,
  type WodType,
} from "@regimen-works/shared";
import type { ApiExercise } from "../lib/api";
import { patternLabel } from "../lib/progressions";
import {
  EMPTY_MOVEMENT,
  type MovementDraft,
  type WodDraft,
  intervalFallback,
  isIntervalType,
  parseRepScheme,
  problemsWith,
  schemeTotal,
  toWodWriteBody,
} from "../lib/wodDraft";

const WOD_TYPE_LABELS: Record<WodType, string> = {
  amrap: "AMRAP",
  for_time: "For time",
  emom: "EMOM",
  tabata: "Tabata",
};

const field = "mt-1 w-full px-3 py-2 text-sm";
const fieldStyle = {
  background: "var(--panel-2)",
  border: "1px solid var(--border)",
  color: "var(--ink)",
  fontFamily: "var(--font-mono)",
} as const;

const labelClass =
  "text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-faint)]";

function Label({ htmlFor, children }: { htmlFor: string; children: string }) {
  return (
    <label
      htmlFor={htmlFor}
      className={labelClass}
      style={{ fontFamily: "var(--font-mono)" }}
    >
      {children}
    </label>
  );
}

/**
 * One movement of the workout: what, and how many.
 *
 * The flat/ladder choice is a pair of radios rather than two fields the
 * author fills in as they like, which is what keeps the CHECK constraint
 * `reps = sum(repScheme)` unreachable — only one count is ever on screen, so
 * "both" and "neither" are not states this form can be in.
 */
function MovementFields({
  index,
  movement,
  choices,
  removable,
  onChange,
  onRemove,
}: {
  index: number;
  movement: MovementDraft;
  choices: ApiExercise[];
  removable: boolean;
  onChange: (next: MovementDraft) => void;
  onRemove: () => void;
}) {
  const position = index + 1;
  const scheme =
    movement.mode === "ladder" ? parseRepScheme(movement.repScheme) : null;

  return (
    <li
      className="flex flex-col gap-3 p-3"
      style={{ borderTop: "1px solid var(--border)" }}
    >
      <div className="flex items-center gap-2">
        <span className={labelClass} style={{ fontFamily: "var(--font-mono)" }}>
          {`Movement ${position}`}
        </span>
        {removable && (
          <button
            type="button"
            onClick={onRemove}
            className="ml-auto px-2 py-1 text-[11px] uppercase tracking-[0.14em]"
            style={{
              border: "1px solid var(--danger)",
              color: "var(--danger)",
              fontFamily: "var(--font-mono)",
            }}
            aria-label={`Remove movement ${position}`}
          >
            Remove
          </button>
        )}
      </div>

      <div>
        <Label htmlFor={`movement-${position}-exercise`}>Movement</Label>
        <select
          id={`movement-${position}-exercise`}
          className={field}
          style={fieldStyle}
          value={movement.exerciseId}
          onChange={(e) => onChange({ ...movement, exerciseId: e.target.value })}
        >
          <option value="">Choose…</option>
          {choices.map((exercise) => (
            <option key={exercise.id} value={exercise.id}>
              {exercise.name}
            </option>
          ))}
        </select>
      </div>

      <fieldset>
        <legend className={labelClass} style={{ fontFamily: "var(--font-mono)" }}>
          How many
        </legend>
        <div className="mt-2 flex gap-4">
          {(["flat", "ladder"] as const).map((mode) => (
            <label
              key={mode}
              className="flex cursor-pointer items-center gap-2 text-[13px] text-[var(--ink-soft)]"
            >
              <input
                type="radio"
                name={`movement-${position}-mode`}
                checked={movement.mode === mode}
                onChange={() => onChange({ ...movement, mode })}
              />
              {mode === "flat" ? "Same every round" : "Ladder"}
            </label>
          ))}
        </div>
      </fieldset>

      {movement.mode === "flat" ? (
        <div>
          <Label htmlFor={`movement-${position}-reps`}>Reps per round</Label>
          <input
            id={`movement-${position}-reps`}
            type="number"
            min={1}
            className={field}
            style={fieldStyle}
            value={movement.reps}
            onChange={(e) => onChange({ ...movement, reps: e.target.value })}
          />
        </div>
      ) : (
        <div>
          <Label htmlFor={`movement-${position}-scheme`}>Reps by round</Label>
          <input
            id={`movement-${position}-scheme`}
            className={field}
            style={fieldStyle}
            placeholder="21-15-9"
            value={movement.repScheme}
            onChange={(e) =>
              onChange({ ...movement, repScheme: e.target.value })
            }
          />
          <p className="mt-1 text-[11px] text-[var(--ink-faint)]">
            {/* Shown, never typed: the total is the database's `reps`, and the
                API derives it. An author who could edit it could disagree
                with the sum. */}
            {scheme
              ? `${scheme.length} rounds, ${schemeTotal(scheme)} reps in total.`
              : "One number per round — 21-15-9."}
          </p>
        </div>
      )}
    </li>
  );
}

/**
 * The whole of a workout, as an author states it (DN-29).
 *
 * One form for both tiers and for both create and edit, for the reason
 * `ExerciseForm` is one: what differs between them is the route the page
 * calls, never the fields.
 *
 * It validates before it submits and reports what the API said when it is
 * refused anyway — `problemsWith` explains why that is not a second source of
 * truth.
 */
export function WodForm({
  initial,
  choices,
  saving,
  serverError,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: WodDraft;
  choices: ApiExercise[];
  saving: boolean;
  serverError: string | null;
  submitLabel: string;
  onSubmit: (body: CreateWod) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  // Held back until the first attempt, so the form is not red while the name
  // is still being typed. See ExerciseForm.
  const [attempted, setAttempted] = useState(false);

  const problems = problemsWith(draft, choices);
  const showing = attempted ? problems : [];
  const interval = isIntervalType(draft.type);
  const fallback = intervalFallback(draft);

  function set<K extends keyof WodDraft>(key: K, value: WodDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function setMovement(index: number, next: MovementDraft) {
    set(
      "movements",
      draft.movements.map((m, i) => (i === index ? next : m)),
    );
  }

  return (
    <form
      className="mt-4 flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        setAttempted(true);
        if (problems.length === 0) onSubmit(toWodWriteBody(draft));
      }}
    >
      <div>
        <Label htmlFor="wod-name">Name</Label>
        <input
          id="wod-name"
          className={field}
          style={fieldStyle}
          value={draft.name}
          onChange={(e) => set("name", e.target.value)}
        />
      </div>

      <div className="flex gap-3">
        <div className="flex-1">
          <Label htmlFor="wod-type">Format</Label>
          <select
            id="wod-type"
            className={field}
            style={fieldStyle}
            value={draft.type}
            onChange={(e) => set("type", e.target.value as WodType)}
          >
            {wodType.options.map((t) => (
              <option key={t} value={t}>
                {WOD_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <div className="w-28">
          <Label htmlFor="wod-cap">Cap (min)</Label>
          <input
            id="wod-cap"
            type="number"
            min={1}
            className={field}
            style={fieldStyle}
            value={draft.timeCapMinutes}
            onChange={(e) => set("timeCapMinutes", e.target.value)}
          />
        </div>
      </div>

      <div className="flex gap-3">
        <div className="flex-1">
          <Label htmlFor="wod-pattern">Dominant pattern</Label>
          <p className="mt-1 text-[11px] text-[var(--ink-faint)]">
            What this workout mostly is. The warm-up and cool-down are built
            from it.
          </p>
          <select
            id="wod-pattern"
            className={field}
            style={fieldStyle}
            value={draft.dominantPattern}
            onChange={(e) =>
              set("dominantPattern", e.target.value as WodDraft["dominantPattern"])
            }
          >
            {movementPattern.options.map((p) => (
              <option key={p} value={p}>
                {patternLabel(p)}
              </option>
            ))}
          </select>
        </div>
        <div className="w-24">
          <Label htmlFor="wod-rounds">Rounds</Label>
          <input
            id="wod-rounds"
            type="number"
            min={1}
            className={field}
            style={fieldStyle}
            value={draft.rounds}
            onChange={(e) => set("rounds", e.target.value)}
          />
        </div>
      </div>

      {/* Only on the formats that run a timer. `resolveIntervalConfig` returns
          null for AMRAP and For Time, so anything stored here would be
          written, never read, and never reported. */}
      {interval && (
        <fieldset
          className="flex flex-col gap-3 p-3"
          style={{ border: "1px solid var(--border)" }}
        >
          <legend className={labelClass} style={{ fontFamily: "var(--font-mono)" }}>
            Interval timer
          </legend>
          <p className="text-[11px] text-[var(--ink-faint)]">
            {/* Left empty, the workout keeps following the format's classic
                structure rather than freezing today's numbers into the row. */}
            {fallback
              ? `Leave these empty for ${WOD_TYPE_LABELS[draft.type]}'s usual ${fallback.workSeconds}s on, ${fallback.restSeconds}s off, ×${fallback.intervalCount}.`
              : ""}
          </p>
          <div className="flex gap-3">
            <div className="flex-1">
              <Label htmlFor="wod-work">Work (s)</Label>
              <input
                id="wod-work"
                type="number"
                min={1}
                className={field}
                style={fieldStyle}
                value={draft.workSeconds}
                onChange={(e) => set("workSeconds", e.target.value)}
              />
            </div>
            <div className="flex-1">
              <Label htmlFor="wod-rest">Rest (s)</Label>
              <input
                id="wod-rest"
                type="number"
                min={0}
                className={field}
                style={fieldStyle}
                value={draft.restSeconds}
                onChange={(e) => set("restSeconds", e.target.value)}
              />
            </div>
            <div className="flex-1">
              <Label htmlFor="wod-intervals">Intervals</Label>
              <input
                id="wod-intervals"
                type="number"
                min={1}
                className={field}
                style={fieldStyle}
                value={draft.intervalCount}
                onChange={(e) => set("intervalCount", e.target.value)}
              />
            </div>
          </div>
        </fieldset>
      )}

      <div>
        <Label htmlFor="wod-description">How it is meant to be done</Label>
        <p className="mt-1 text-[11px] text-[var(--ink-faint)]">
          The intent no other field carries — "one pass, for time". Not where
          the rep numbers go.
        </p>
        <textarea
          id="wod-description"
          rows={3}
          className={field}
          style={fieldStyle}
          value={draft.description}
          onChange={(e) => set("description", e.target.value)}
        />
      </div>

      <label className="flex cursor-pointer items-center gap-2 text-[13px] text-[var(--ink-soft)]">
        <input
          type="checkbox"
          checked={draft.isNamed}
          onChange={(e) => set("isNamed", e.target.checked)}
        />
        A named workout — Fran, Cindy, Murph
      </label>

      <div>
        <span className={labelClass} style={{ fontFamily: "var(--font-mono)" }}>
          Movements
        </span>
        <ul
          aria-label="Movements in this workout"
          className="mt-2"
          style={{ background: "var(--panel-2)", border: "1px solid var(--border)" }}
        >
          {draft.movements.map((movement, index) => (
            <MovementFields
              // Position, not id: two rows may name the same exercise, and a
              // row with none chosen has no id at all.
              key={index}
              index={index}
              movement={movement}
              choices={choices}
              // A workout with no movements hands the athlete an empty screen
              // at the moment they meant to train, so the last one stays.
              removable={draft.movements.length > 1}
              onChange={(next) => setMovement(index, next)}
              onRemove={() =>
                set(
                  "movements",
                  draft.movements.filter((_, i) => i !== index),
                )
              }
            />
          ))}
        </ul>
        <button
          type="button"
          onClick={() => set("movements", [...draft.movements, EMPTY_MOVEMENT])}
          className="mt-2 w-full py-2 text-[12px] font-semibold uppercase tracking-[0.14em]"
          style={{
            background: "var(--panel-2)",
            border: "1px solid var(--border)",
            color: "var(--glow)",
            fontFamily: "var(--font-mono)",
          }}
        >
          Add a movement
        </button>
      </div>

      {(showing.length > 0 || serverError) && (
        <ul
          role="alert"
          className="flex flex-col gap-1 p-3 text-[12px]"
          style={{
            background: "var(--danger-tint)",
            border: "1px solid var(--danger)",
            color: "var(--ink)",
          }}
        >
          {showing.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
          {serverError && <li>{serverError}</li>}
        </ul>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={saving}
          className="flex-1 py-2.5 text-[12px] font-semibold uppercase tracking-[0.14em] disabled:opacity-50"
          style={{
            background: "var(--glow)",
            color: "var(--panel)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {saving ? "Saving…" : submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2.5 text-[12px] font-semibold uppercase tracking-[0.14em]"
          style={{
            background: "var(--panel-2)",
            border: "1px solid var(--border)",
            color: "var(--ink-soft)",
            fontFamily: "var(--font-mono)",
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
