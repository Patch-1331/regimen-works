import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type ApiExercise } from "../../lib/api";
import { MovementPicker } from "../../components/MovementPicker";
import { SwapPanel } from "../../components/MovementSwap";
import { buildAlternativeRows, canSwap } from "../../lib/swapOptions";
import { lineMovementName, lineProblems, type DraftLine } from "../../lib/programDraft";
import { display, mono } from "./chrome";
import { SchemeFields } from "./SchemeFields";

const outlined =
  "border border-[var(--border)] px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em]";

/**
 * One movement of a day, on a page of its own (DN-193): what it is, how its
 * sets are written, and duplicating or removing it. Was the line's in-place
 * expansion on the week sheet.
 */
export function MovementStep({
  line,
  where,
  dayName,
  library,
  pickable,
  canCreate,
  onChange,
  onDuplicate,
  onRemove,
}: {
  line: DraftLine;
  /** For the picker's header: "Monday · movement 2". */
  where: string;
  /** "Monday", or "Day 2": where Remove takes it from. */
  dayName: string;
  library: ApiExercise[];
  pickable: ApiExercise[];
  canCreate: boolean;
  onChange: (line: DraftLine) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const [picking, setPicking] = useState(false);
  // The alternatives or the search, never both (DN-185).
  const [swapping, setSwapping] = useState(false);
  const problems = lineProblems(line);
  const exercise = library.find((e) => e.id === line.exerciseId);
  // A group line has no ⇄: it already names any of its members (DN-185).
  const swappable =
    exercise !== undefined && canSwap(exercise, { isSwapped: false, prescribedId: null });
  const panelId = `alternatives-${line.id}`;
  const named = line.exerciseId !== null || line.movementGroup !== null;

  return (
    <>
      <h1 className="mt-8 text-4xl font-bold text-[var(--ink)]" style={display}>
        {lineMovementName(line, library)}
      </h1>
      {problems.map((p) => (
        <p key={p} className="mt-1 text-sm text-[var(--danger)]">
          {p}
        </p>
      ))}

      <div className="mt-4 flex flex-wrap gap-2" style={mono}>
        <button
          type="button"
          onClick={() => {
            setPicking(true);
            setSwapping(false);
          }}
          className={outlined}
          style={{ color: "var(--glow)" }}
        >
          {named ? "Change movement" : "Choose movement"}
        </button>
        {swappable && (
          <button
            type="button"
            onClick={() => {
              setSwapping(!swapping);
              setPicking(false);
            }}
            aria-expanded={swapping}
            aria-controls={panelId}
            className={outlined}
            style={{ color: swapping ? "var(--glow)" : "var(--ink-soft)" }}
          >
            <span aria-hidden>⇄ </span>
            Alternatives
          </button>
        )}
      </div>

      {swappable && swapping && (
        <LineAlternatives
          id={panelId}
          current={exercise}
          pickable={pickable}
          onPick={(exerciseId) => {
            onChange({ ...line, exerciseId, movementGroup: null });
            setSwapping(false);
          }}
        />
      )}
      {picking && (
        <MovementPicker
          library={pickable}
          context={where}
          heading={named ? "Change movement" : "Add a movement"}
          allowCreate={canCreate}
          onClose={() => setPicking(false)}
          onPick={(choice) => {
            onChange({ ...line, ...choice });
            setPicking(false);
          }}
        />
      )}

      <SchemeFields line={line} onChange={onChange} />

      <div className="mt-8 flex gap-6 text-xs tracking-[0.14em]" style={mono}>
        <button type="button" className="text-[var(--ink-soft)]" onClick={onDuplicate}>
          DUPLICATE
        </button>
        <button type="button" className="text-[var(--danger)]" onClick={onRemove}>
          REMOVE FROM {dayName.toUpperCase()}
        </button>
      </div>
    </>
  );
}

/**
 * A line's alternatives, read when the ⇄ opens (DN-185): Today's sections for
 * the movement, narrowed to what this program may name. A pick changes the
 * line being written -- its numbers stay -- and nothing more until Save.
 */
function LineAlternatives({
  id,
  current,
  pickable,
  onPick,
}: {
  id: string;
  current: ApiExercise;
  pickable: ApiExercise[];
  onPick: (exerciseId: string) => void;
}) {
  const { data, isError } = useQuery({
    queryKey: ["exercise-alternatives", current.id],
    queryFn: () => api.exerciseAlternatives(current.id),
  });
  return (
    <SwapPanel
      id={id}
      label="ALTERNATIVES"
      rows={data ? buildAlternativeRows(data, current, pickable) : null}
      failed={isError}
      isSwapped={false}
      prescribedName={null}
      prescribedReason={null}
      onPick={onPick}
      onRevert={() => undefined}
    />
  );
}
