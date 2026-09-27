/**
 * PROTOTYPE — DN-137, variant C: "Paste it in".
 *
 * Stance: text is the editor. The athlete types or pastes the routine the way
 * it's written anywhere else, and the app reads it back line by line — what it
 * understood, what it dropped (a load), and what it refuses (a movement the
 * library doesn't have). Repetition is copy-paste. A weekday heading pins the
 * day; "Day 1" doesn't. This is also DN-137's "routine from elsewhere" answer:
 * the same screen serves designing and bringing one in.
 */
import { useMemo, useState } from "react";
import type { ApiExercise } from "../../../lib/api";
import {
  Caps, SearchPicker, StatePanel, WEEKDAYS, WORKED_EXAMPLE_TEXT, display, formatRest, formatScheme,
  mono, movementName, parseRoutine, problemsOf, unitOf, type Draft,
} from "./shared";

export const name = "Paste it in";

export function VariantPaste({ library }: { library: ApiExercise[] }) {
  const [text, setText] = useState(WORKED_EXAMPLE_TEXT);
  const [title, setTitle] = useState("");
  /** Picks made against a refused line, keyed by the line's source text. */
  const [resolved, setResolved] = useState<Record<string, { exerciseId: string | null; group: string | null }>>({});
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [picking, setPicking] = useState<string | null>(null);

  const draft: Draft = useMemo(() => {
    const d = parseRoutine(text, library);
    d.name = title;
    d.days = d.days.map((day) => ({
      ...day,
      items: day.items
        .filter((rx) => !skipped.has(rx.source))
        .map((rx) => (resolved[rx.source] ? { ...rx, ...resolved[rx.source] } : rx)),
    }));
    return d;
  }, [text, library, resolved, skipped, title]);

  const all = draft.days.flatMap((d) => d.items);
  const refused = all.filter((rx) => problemsOf(rx).length > 0);

  return (
    <div className="px-4 pb-4">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Name this routine"
        className="mt-2 w-full border-b border-[var(--border)] bg-transparent pb-1 text-2xl font-bold text-[var(--ink)] outline-none"
        style={display}
      />

      <div className="mt-4 flex items-baseline justify-between">
        <Caps>WRITE IT THE WAY YOU'D WRITE IT ANYWHERE</Caps>
        <button className="text-[11px] text-[var(--ink-faint)]" style={mono} onClick={() => { setText(""); setResolved({}); setSkipped(new Set()); }}>CLEAR</button>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        rows={14}
        placeholder={"Monday — Push\nBench press 5x5\nDips 3x8-12 rest 90s\n\nWednesday — Pull\n…"}
        className="mt-2 w-full border border-[var(--border)] bg-[var(--panel-2)] p-2 text-xs leading-5 text-[var(--ink)]"
        style={mono}
      />
      <p className="mt-1 text-[11px] text-[var(--ink-faint)]">
        A weekday heading pins that day to the weekday. “Day 1, Day 2…” means any days, in order. <span style={mono}>5x5</span>, <span style={mono}>3x8-12</span>, <span style={mono}>2xfailure</span>, <span style={mono}>3x60s</span>, <span style={mono}>&amp;</span> for two schemes, <span style={mono}>rest 90s</span>.
      </p>

      <div className="mt-4 flex items-baseline justify-between">
        <Caps>WHAT THE APP READ</Caps>
        <span className="text-[11px]" style={mono}>
          <span className="text-[var(--glow)]">{all.length - refused.length} ok</span>
          {" · "}
          <span className={refused.length ? "text-[var(--danger)]" : "text-[var(--ink-faint)]"}>{refused.length} need you</span>
        </span>
      </div>
      <p className="mt-1 text-[11px] text-[var(--ink-soft)]">
        {draft.pinned ? "Pinned to weekdays — " : "Any days, in order — "}
        {draft.days.length} training days{draft.pinned ? `: ${draft.days.map((d) => WEEKDAYS[d.weekday ?? 0]).join(", ")}. The rest are rest days.` : "."}
      </p>

      <div className="mt-2 space-y-3">
        {draft.days.map((day) => (
          <section key={day.id} className="border border-[var(--border)] bg-[var(--panel)] p-3">
            <header className="flex items-baseline gap-2">
              <span className="text-xs text-[var(--glow)]" style={mono}>{day.weekday !== null ? WEEKDAYS[day.weekday].toUpperCase() : "DAY"}</span>
              <span className="text-base font-semibold text-[var(--ink)]" style={display}>{day.name}</span>
            </header>
            <ul className="mt-1">
              {day.items.map((rx) => {
                const problems = problemsOf(rx);
                const guessed = rx.exerciseId && !resolved[rx.source];
                return (
                  <li key={rx.id} className="border-t border-[var(--border)] py-1.5 first:border-t-0">
                    <div className="flex items-baseline gap-2">
                      <span className="w-4 text-xs" style={mono}>{problems.length ? <span className="text-[var(--danger)]">✕</span> : <span className="text-[var(--glow)]">✓</span>}</span>
                      <span className="flex-1 text-sm text-[var(--ink)]">
                        {problems.length ? rx.source.replace(/\s*\d.*$/, "") : movementName(rx, library)}
                        {guessed && movementName(rx, library).toLowerCase() !== rx.source.replace(/\s*\d.*$/, "").toLowerCase() && (
                          <span className="block text-[11px] text-[var(--ink-faint)]">read “{rx.source.replace(/\s*\d.*$/, "")}” as this</span>
                        )}
                      </span>
                      <span className="text-xs text-[var(--ink-soft)]" style={mono}>{formatScheme(rx, unitOf(rx, library))}</span>
                      <span className="w-24 text-right text-[11px] text-[var(--ink-faint)]" style={mono}>{formatRest(rx)}</span>
                    </div>
                    {rx.droppedLoad && <p className="ml-6 text-[11px] text-[var(--ink-faint)]">Load “{rx.droppedLoad}” dropped — the app doesn't track weight.</p>}
                    {problems.length > 0 && (
                      <div className="ml-6">
                        {problems.map((p) => <p key={p} className="text-[11px] text-[var(--danger)]">{p}</p>)}
                        <div className="mt-1 flex gap-3 text-[11px]" style={mono}>
                          <button className="text-[var(--glow)]" onClick={() => setPicking(rx.id)}>PICK FROM LIBRARY</button>
                          <button className="text-[var(--ink-faint)]" onClick={() => setSkipped(new Set(skipped).add(rx.source))}>LEAVE IT OUT</button>
                        </div>
                        {picking === rx.id && (
                          <SearchPicker
                            library={library}
                            initial={rx.source.replace(/\s*\d.*$/, "")}
                            onClose={() => setPicking(null)}
                            onPick={(p) => { setResolved({ ...resolved, [rx.source]: p }); setPicking(null); }}
                          />
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      {skipped.size > 0 && (
        <p className="mt-3 text-[11px] text-[var(--ink-faint)]">
          Left out: {[...skipped].join(" · ")}{" "}
          <button className="underline" onClick={() => setSkipped(new Set())}>undo</button>
        </p>
      )}
      <p className="mt-4 text-xs text-[var(--ink-faint)]">No length here: you choose how many weeks, or none, when you start it.</p>
      <StatePanel draft={draft} library={library} />
    </div>
  );
}
