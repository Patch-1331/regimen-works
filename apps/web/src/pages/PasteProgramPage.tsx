import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { MovementPicker } from "../components/MovementPicker";
import { api, type ApiExercise } from "../lib/api";
import {
  choiceOf,
  pasteProblems,
  readBack,
  toPastedDraft,
  type ReadBackLine,
} from "../lib/pasteProgram";
import {
  blankLine,
  formatScheme,
  lineMovementName,
} from "../lib/programDraft";
import { WEEKDAYS } from "../lib/weekdays";

/**
 * Pasting a program in from elsewhere (DN-152, DN-137's verdict).
 *
 * Not a second editor: the text is read back line by line, each line ✓ with
 * the library movement it was read as, or ✕ with why not. A ✕ is answered
 * here -- picked from the library or left out -- and then everything lands
 * on the week sheet as an unsaved draft, where the sheet's own rules apply.
 *
 * Nothing is approximated. A line that matches nothing, or several things
 * equally, is refused; a line read as a different name says so; a load is
 * dropped out loud, because the app doesn't track weight (ADR 0005).
 */

const mono = { fontFamily: "var(--font-mono)" } as const;
const display = { fontFamily: "var(--font-display)" } as const;

const PLACEHOLDER = `Monday — Lower body
Barbell Squat 5x5 @ 225
Leg Press 3x15-20 rest 90s

Wednesday — Upper body
Floor Press 2x10-15 & 2x5-8
Plank 3x60s`;

export function PasteProgramPage() {
  const navigate = useNavigate();
  const { data: library = [] } = useQuery({
    queryKey: ["exercises"],
    queryFn: api.exercises,
  });

  const [text, setText] = useState("");
  const [read, setRead] = useState<ReturnType<typeof readBack> | null>(null);
  const [picking, setPicking] = useState<string | null>(null);

  const put = (next: ReadBackLine) =>
    setRead(
      (r) =>
        r && {
          ...r,
          lines: r.lines.map((l) => (l.id === next.id ? next : l)),
        },
    );

  const problems = read ? pasteProblems(read.program, read.lines) : [];

  return (
    <div className="mx-auto max-w-md p-6 pb-32">
      <Link
        to="/programs"
        className="text-xs text-[var(--ink-faint)]"
        style={mono}
      >
        ← CANCEL
      </Link>
      <h1 className="mt-4 text-2xl font-bold text-[var(--ink)]" style={display}>
        Paste a program
      </h1>
      <p className="mt-2 text-sm text-[var(--ink-soft)]">
        One movement per line, with its sets × reps. Head each day with a
        weekday, or with “Day 1”, “Day 2” for any days in order.
      </p>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={PLACEHOLDER}
        aria-label="Pasted program"
        rows={10}
        className="mt-4 w-full border border-[var(--border)] bg-[var(--panel)] p-2 text-sm text-[var(--ink)]"
        style={mono}
      />
      <button
        type="button"
        disabled={text.trim() === "" || library.length === 0}
        onClick={() => {
          setRead(readBack(text, library));
          setPicking(null);
        }}
        className="mt-2 w-full border border-[var(--glow)] py-2 text-sm font-semibold uppercase tracking-[0.1em] text-[var(--glow)] disabled:opacity-40"
        style={mono}
      >
        {read ? "Read it again" : "Read it"}
      </button>
      {read && (
        <p className="mt-1 text-[11px] text-[var(--ink-faint)]">
          Reading it again starts the read-back over.
        </p>
      )}

      {read?.program.days.map((day, index) => (
        <section
          key={index}
          aria-label={dayLabel(read.program.scheduleMode, day.dayOfWeek, index)}
          className="mt-4 border border-[var(--border)] bg-[var(--panel)] p-3"
        >
          <header className="flex items-baseline gap-3">
            <span className="text-xs text-[var(--glow)]" style={mono}>
              {dayLabel(read.program.scheduleMode, day.dayOfWeek, index).toUpperCase()}
            </span>
            {day.heading && (
              <span className="text-sm text-[var(--ink-faint)]">
                {day.heading}
              </span>
            )}
          </header>
          <ul className="mt-1">
            {read.lines
              .filter((l) => l.day === index)
              .map((l) => (
                <ReadBackRow
                  key={l.id}
                  line={l}
                  library={library}
                  picking={picking === l.id}
                  onPick={(on) => setPicking(on ? l.id : null)}
                  onChange={put}
                />
              ))}
          </ul>
        </section>
      ))}

      {read && (
        <footer
          className="fixed inset-x-0 bottom-0 border-t border-[var(--border)] p-4"
          style={{ background: "var(--bg)" }}
        >
          <div className="mx-auto max-w-md">
            {problems.map((p) => (
              <p
                key={p}
                className="mb-2 text-xs text-[var(--danger)]"
                style={mono}
              >
                {p}
              </p>
            ))}
            <button
              type="button"
              disabled={problems.length > 0}
              onClick={() =>
                navigate("/programs/new", {
                  state: { pasted: toPastedDraft(read.program, read.lines) },
                })
              }
              className="w-full py-3 text-sm font-semibold uppercase tracking-[0.1em] disabled:opacity-40"
              style={{ ...mono, background: "var(--glow)", color: "var(--bg)" }}
            >
              Open on the week sheet
            </button>
          </div>
        </footer>
      )}
    </div>
  );
}

function dayLabel(
  mode: "fixed" | "flexible",
  dayOfWeek: number | null,
  index: number,
): string {
  if (mode === "fixed" && dayOfWeek !== null) {
    return WEEKDAYS.find((d) => d.value === dayOfWeek)?.short ?? `Day ${index + 1}`;
  }
  return `Day ${index + 1}`;
}

function ReadBackRow({
  line: l,
  library,
  picking,
  onPick,
  onChange,
}: {
  line: ReadBackLine;
  library: ApiExercise[];
  picking: boolean;
  onPick: (on: boolean) => void;
  onChange: (line: ReadBackLine) => void;
}) {
  const choice = choiceOf(l);
  const pasted = l.line.name || l.line.source;
  const schemes = l.line.schemes
    .map((s) => formatScheme({ ...blankLine(), ...s }, s.seconds ? "seconds" : "reps"))
    .join(" & ");

  if (l.leftOut) {
    return (
      <li className="flex items-baseline gap-2 border-t border-[var(--border)] py-1.5 first:border-t-0">
        <span className="flex-1 text-sm text-[var(--ink-faint)] line-through">
          {pasted}
        </span>
        <span className="text-[11px] text-[var(--ink-faint)]">Left out</span>
        <button
          type="button"
          onClick={() => onChange({ ...l, leftOut: false })}
          className="text-[11px] text-[var(--glow)]"
          style={mono}
        >
          UNDO
        </button>
      </li>
    );
  }

  return (
    <li className="border-t border-[var(--border)] py-1.5 first:border-t-0">
      <div className="flex items-baseline gap-2">
        <span
          className="flex-1 text-sm"
          style={{ color: choice ? "var(--ink)" : "var(--danger)" }}
        >
          {choice
            ? `✓ ${lineMovementName({ ...blankLine(), ...choice }, library)}`
            : `✕ ${pasted}`}
        </span>
        <span className="text-xs text-[var(--ink-soft)]" style={mono}>
          {schemes || "no sets × reps"}
        </span>
      </div>

      {choice && !l.picked && l.match.kind === "match" && l.match.guessed && (
        <p className="mt-0.5 text-[11px] text-[var(--ink-soft)]">
          Read “{pasted}” as this.
        </p>
      )}
      {l.picked && (
        <p className="mt-0.5 text-[11px] text-[var(--ink-soft)]">
          Picked for “{pasted}”.
        </p>
      )}
      {!choice && (
        <p className="mt-0.5 text-[11px] text-[var(--danger)]">
          {l.match.kind === "ambiguous"
            ? `Could be any of ${l.match.candidates.map((c) => c.name).join(", ")}.`
            : "Nothing in the library is this movement."}
        </p>
      )}
      {l.line.droppedLoad && (
        <p className="mt-0.5 text-[11px] text-[var(--ink-faint)]">
          Load {l.line.droppedLoad} dropped — the app doesn't track weight.
        </p>
      )}

      <div className="mt-1 flex gap-3 text-[11px]" style={mono}>
        <button
          type="button"
          onClick={() => onPick(!picking)}
          className="text-[var(--glow)]"
        >
          {choice ? "CHANGE" : "PICK FROM LIBRARY"}
        </button>
        <button
          type="button"
          onClick={() => {
            onPick(false);
            onChange({ ...l, leftOut: true });
          }}
          className="text-[var(--ink-soft)]"
        >
          LEAVE IT OUT
        </button>
      </div>
      {picking && (
        <MovementPicker
          library={library}
          initialQuery={pasted}
          onClose={() => onPick(false)}
          onPick={(picked) => {
            onChange({ ...l, picked });
            onPick(false);
          }}
        />
      )}
    </li>
  );
}
