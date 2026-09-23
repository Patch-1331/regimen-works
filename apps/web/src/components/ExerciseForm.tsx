import { useState } from "react";
import {
  EQUIPMENT_CATALOG,
  type CreateExercise,
  type Equipment,
  exercisePhase,
  exerciseUnit,
  movementPattern,
  movementGroup,
} from "@regimen-works/shared";
import type { ApiExercise } from "../lib/api";
import { lineLabel, patternLabel } from "../lib/progressions";
import {
  type ExerciseDraft,
  problemsWith,
  toWriteBody,
} from "../lib/exerciseDraft";

const field = "mt-1 w-full px-3 py-2 text-sm";
const fieldStyle = {
  background: "var(--panel-2)",
  border: "1px solid var(--border)",
  color: "var(--ink)",
  fontFamily: "var(--font-mono)",
} as const;

function Label({ htmlFor, children }: { htmlFor: string; children: string }) {
  return (
    <label
      htmlFor={htmlFor}
      className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-faint)]"
      style={{ fontFamily: "var(--font-mono)" }}
    >
      {children}
    </label>
  );
}

/**
 * The whole of a movement, as an author states it (DN-28).
 *
 * One form for both tiers and for both create and edit: what differs between
 * them is the route the page calls, never the fields, so a second form would
 * be the same ten inputs kept in step by hand.
 *
 * It validates before it submits — see `problemsWith` for why that is not a
 * second source of truth — and it reports what the API said when it is
 * refused anyway. Both lists render in the same place, because to the author
 * "you cannot save this yet" is one question however it was answered.
 */
export function ExerciseForm({
  initial,
  alternatives,
  saving,
  serverError,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: ExerciseDraft;
  alternatives: ApiExercise[];
  saving: boolean;
  serverError: string | null;
  submitLabel: string;
  onSubmit: (body: CreateExercise) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  // Held back until the first attempt: a form that turns red while the name is
  // still being typed is telling the author about a state they are passing
  // through, not one they chose.
  const [attempted, setAttempted] = useState(false);

  const problems = problemsWith(draft, alternatives);
  const showing = attempted ? problems : [];

  function set<K extends keyof ExerciseDraft>(key: K, value: ExerciseDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function toggleEquipment(piece: Equipment, owned: boolean) {
    set(
      "equipment",
      owned
        ? [...draft.equipment, piece]
        : draft.equipment.filter((p) => p !== piece),
    );
  }

  return (
    <form
      className="mt-4 flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        setAttempted(true);
        if (problems.length === 0) onSubmit(toWriteBody(draft));
      }}
    >
      <div>
        <Label htmlFor="exercise-name">Name</Label>
        <input
          id="exercise-name"
          className={field}
          style={fieldStyle}
          value={draft.name}
          onChange={(e) => set("name", e.target.value)}
        />
      </div>

      <div className="flex gap-3">
        <div className="flex-1">
          <Label htmlFor="exercise-pattern">Pattern</Label>
          <select
            id="exercise-pattern"
            className={field}
            style={fieldStyle}
            value={draft.pattern}
            onChange={(e) =>
              set("pattern", e.target.value as ExerciseDraft["pattern"])
            }
          >
            {/* Null is a real answer: general warm-up and cool-down filler is
                not tied to a pattern. */}
            <option value="">None</option>
            {movementPattern.options.map((p) => (
              <option key={p} value={p}>
                {patternLabel(p)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <Label htmlFor="exercise-unit">Counted in</Label>
          <select
            id="exercise-unit"
            className={field}
            style={fieldStyle}
            value={draft.unit}
            onChange={(e) =>
              set("unit", e.target.value as ExerciseDraft["unit"])
            }
          >
            {exerciseUnit.options.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <Label htmlFor="exercise-instructions">How it is performed</Label>
        <textarea
          id="exercise-instructions"
          rows={3}
          className={field}
          style={fieldStyle}
          value={draft.instructions}
          onChange={(e) => set("instructions", e.target.value)}
        />
      </div>

      <div className="flex gap-3">
        <div className="flex-1">
          <Label htmlFor="exercise-movementGroup">
            Progression movementGroup
          </Label>
          <select
            id="exercise-movementGroup"
            className={field}
            style={fieldStyle}
            value={draft.movementGroup}
            onChange={(e) =>
              set(
                "movementGroup",
                e.target.value as ExerciseDraft["movementGroup"],
              )
            }
          >
            <option value="">None</option>
            {movementGroup.options.map((l) => (
              <option key={l} value={l}>
                {lineLabel(l)}
              </option>
            ))}
          </select>
        </div>
        <div className="w-24">
          <Label htmlFor="exercise-sort-order">Order</Label>
          <input
            id="exercise-sort-order"
            type="number"
            min={0}
            className={field}
            style={fieldStyle}
            value={draft.sortOrder}
            onChange={(e) => set("sortOrder", e.target.value)}
          />
        </div>
      </div>

      <div>
        <Label htmlFor="exercise-phase">Warm-up / cool-down</Label>
        <select
          id="exercise-phase"
          className={field}
          style={fieldStyle}
          value={draft.phase}
          onChange={(e) =>
            set("phase", e.target.value as ExerciseDraft["phase"])
          }
        >
          {/* Most movements are neither — they are the workout itself. */}
          <option value="">Neither</option>
          {exercisePhase.options.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      <fieldset>
        <legend
          className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-faint)]"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          Equipment it needs
        </legend>
        <p className="mt-1 text-[11px] text-[var(--ink-faint)]">
          Leave every box empty for a bodyweight movement. Anything ticked means
          an athlete without it is given the alternative instead.
        </p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {EQUIPMENT_CATALOG.map((piece) => (
            <label
              key={piece.value}
              className="flex cursor-pointer items-center gap-2 text-[13px] text-[var(--ink-soft)]"
            >
              <input
                type="checkbox"
                checked={draft.equipment.includes(piece.value)}
                onChange={(e) => toggleEquipment(piece.value, e.target.checked)}
              />
              {piece.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <Label htmlFor="exercise-fallback">Alternative</Label>
        <p className="mt-1 text-[11px] text-[var(--ink-faint)]">
          What an athlete is given instead when they don't own the equipment.
        </p>
        <select
          id="exercise-fallback"
          className={field}
          style={fieldStyle}
          value={draft.fallbackExerciseId}
          onChange={(e) => set("fallbackExerciseId", e.target.value)}
        >
          <option value="">None</option>
          {alternatives.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </div>

      <label className="flex cursor-pointer items-center gap-2 text-[13px] text-[var(--ink-soft)]">
        <input
          type="checkbox"
          checked={draft.scalable}
          onChange={(e) => set("scalable", e.target.checked)}
        />
        Scalable — the rep count can be adjusted to the athlete
      </label>

      {(showing.length > 0 || serverError) && (
        <ul
          // Announced rather than only shown: the author has just pressed
          // Save and their attention is on the button, not on the paragraph
          // that appeared above it.
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
