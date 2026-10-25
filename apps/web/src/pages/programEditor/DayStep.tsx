import { useState } from "react";
import type { ApiExercise } from "../../lib/api";
import { MovementPicker } from "../../components/MovementPicker";
import {
  copyDay,
  formatRest,
  formatScheme,
  lineMovementName,
  lineProblems,
  moveLine,
  pickedDays,
  type DraftLine,
  type ProgramDraft,
} from "../../lib/programDraft";
import { weekdayName } from "../../lib/weekdays";
import { caption, display, mono, primaryButton, primaryStyle } from "./chrome";

/**
 * One training day (DN-193): its name, its movements as cards, and the way
 * to add one. A card opens the movement's own page. An empty day offers to
 * copy a day already written instead -- the old sheet's COPY TO…, turned
 * round so it is asked where the copy is wanted.
 */
export function DayStep({
  draft,
  day,
  title,
  eyebrow,
  library,
  pickable,
  canCreate,
  onChange,
  onOpenLine,
  onAddLine,
}: {
  draft: ProgramDraft;
  day: number;
  /** "Monday", or "Day 2" when the days are trained in order. */
  title: string;
  /** "DAY 1 OF 3", or the weekday a flexible day is listed under. */
  eyebrow: string;
  library: ApiExercise[];
  pickable: ApiExercise[];
  canCreate: boolean;
  onChange: (draft: ProgramDraft) => void;
  onOpenLine: (id: string) => void;
  onAddLine: (choice: Pick<DraftLine, "exerciseId" | "movementGroup">) => void;
}) {
  const [adding, setAdding] = useState(false);
  const lines = draft.days[day] ?? [];
  const short = weekdayName(day).slice(0, 3);
  // Written days to copy from, in week order, this one aside.
  const sources = pickedDays(draft).filter((d) => d !== day && (draft.days[d]?.length ?? 0) > 0);

  const picker = adding && (
    <MovementPicker
      library={pickable}
      context={`${title} · movement ${lines.length + 1}`}
      heading="Add a movement"
      allowCreate={canCreate}
      onClose={() => setAdding(false)}
      onPick={(choice) => {
        setAdding(false);
        onAddLine(choice);
      }}
    />
  );

  return (
    <>
      <p className={`mt-8 ${caption}`} style={{ ...mono, color: "var(--glow)" }}>
        {eyebrow}
      </p>
      <h1 className="mt-1 text-4xl font-bold text-[var(--ink)]" style={display}>
        {title}
      </h1>

      <label className="mt-5 block">
        <span className={caption} style={mono}>
          NAME THIS DAY · OPTIONAL
        </span>
        <input
          value={draft.labels[day] ?? ""}
          onChange={(e) =>
            onChange({ ...draft, labels: { ...draft.labels, [day]: e.target.value } })
          }
          placeholder="e.g. Pull"
          aria-label={`Name for ${short}`}
          maxLength={40}
          className="mt-2 w-full border border-[var(--border)] bg-[var(--panel)] px-3 py-3 text-base text-[var(--ink)] outline-none"
        />
      </label>

      {lines.length === 0 ? (
        <div className="mt-5 border border-dashed border-[var(--border)] p-4 text-center">
          <p className="text-[var(--ink-soft)]">Nothing on {title} yet.</p>
          <button
            type="button"
            onClick={() => setAdding(true)}
            className={`${primaryButton} mt-3`}
            style={primaryStyle}
          >
            + Add first movement
          </button>
          {sources.length > 0 && (
            <>
              <p className="my-3 flex items-center gap-3 text-[11px] text-[var(--ink-faint)]" style={mono}>
                <span className="h-px flex-1 bg-[var(--border)]" aria-hidden />
                OR
                <span className="h-px flex-1 bg-[var(--border)]" aria-hidden />
              </p>
              <ul className="space-y-2 text-left">
                {sources.map((from) => (
                  <li key={from}>
                    <button
                      type="button"
                      onClick={() => onChange(copyDay(draft, from, [day]))}
                      className="w-full border border-[var(--border)] bg-[var(--panel)] p-3 text-left"
                    >
                      <span className="block text-[var(--ink)]">Copy {weekdayName(from)}</span>
                      <span className="block text-sm text-[var(--ink-soft)]">
                        {[
                          draft.labels[from]?.trim(),
                          (draft.days[from] ?? [])
                            .map((l) => lineMovementName(l, library))
                            .join(", "),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : (
        <>
          <p className={`mt-6 ${caption}`} style={mono}>
            MOVEMENTS · {lines.length}
          </p>
          <ol className="mt-2 space-y-2">
            {lines.map((line, i) => (
              <MovementCard
                key={line.id}
                line={line}
                library={library}
                first={i === 0}
                last={i === lines.length - 1}
                onOpen={() => onOpenLine(line.id)}
                onMove={(by) => onChange(moveLine(draft, day, line.id, by))}
              />
            ))}
          </ol>
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="mt-2 w-full border border-dashed py-3 text-sm uppercase tracking-[0.14em]"
            style={{ ...mono, borderColor: "var(--glow)", color: "var(--glow)" }}
          >
            + Add movement
          </button>
        </>
      )}

      <p className="mt-4 text-sm text-[var(--ink-faint)]">
        You can leave a day half-done and come back to it; Review lists what's
        still missing.
      </p>
      {picker}
    </>
  );
}

function MovementCard({
  line,
  library,
  first,
  last,
  onOpen,
  onMove,
}: {
  line: DraftLine;
  library: ApiExercise[];
  first: boolean;
  last: boolean;
  onOpen: () => void;
  onMove: (by: -1 | 1) => void;
}) {
  const wrong = lineProblems(line).length > 0;
  const name = lineMovementName(line, library);
  const unit = library.find((e) => e.id === line.exerciseId)?.unit ?? "reps";
  return (
    <li
      className="flex items-stretch border bg-[var(--panel)]"
      style={{ borderColor: wrong ? "var(--danger)" : "var(--border)" }}
    >
      <div className="flex flex-col justify-center border-r border-[var(--border)] text-[var(--ink-faint)]">
        {/* Up and down rather than a drag: a thumb can hit them, and so can a keyboard. */}
        <button
          type="button"
          disabled={first}
          onClick={() => onMove(-1)}
          aria-label={`Move ${name} up`}
          className="px-3 py-1.5 disabled:opacity-25"
        >
          ▴
        </button>
        <button
          type="button"
          disabled={last}
          onClick={() => onMove(1)}
          aria-label={`Move ${name} down`}
          className="px-3 py-1.5 disabled:opacity-25"
        >
          ▾
        </button>
      </div>
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center p-3 text-left">
        <span className="min-w-0 flex-1">
          <span
            className="block text-lg font-semibold"
            style={{ color: wrong ? "var(--danger)" : "var(--ink)" }}
          >
            {wrong ? "✕ " : ""}
            {name}
          </span>
          <span className="block text-sm text-[var(--ink-soft)]" style={mono}>
            {formatScheme(line, unit)} · {formatRest(line)}
          </span>
        </span>
        <span aria-hidden className="text-xl text-[var(--ink-faint)]">
          ›
        </span>
      </button>
    </li>
  );
}
