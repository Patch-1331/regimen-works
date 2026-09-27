/**
 * PROTOTYPE — DN-137. Throwaway. Do not import from production code.
 *
 * What the three editor variants share: the in-memory draft, the worked
 * example, text matching against the real exercise library, and the panel
 * that shows the routine as it would be saved. Nothing here persists.
 */
import { useState } from "react";
import type { ApiExercise } from "../../../lib/api";

export type Rx = {
  id: string;
  /** What the author wrote, verbatim — kept so a refusal can quote it. */
  source: string;
  exerciseId: string | null;
  /** Set when the author chose "any from the group" rather than one exercise. */
  group: string | null;
  sets: number | null;
  reps: number | null;
  repsMax: number | null;
  toFailure: boolean;
  restSeconds: number | null;
  /** A load the source stated and the editor dropped (ADR 0005, decision 5). */
  droppedLoad: string | null;
};

export type Day = {
  id: string;
  name: string;
  /** 0 = Sunday. Null on a flexible routine, where days are an order, not a date. */
  weekday: number | null;
  items: Rx[];
};

export type Draft = {
  name: string;
  /** Fixed: days land on their weekdays. Flexible: N days a week, in order. */
  pinned: boolean;
  days: Day[];
  /** Null = open-ended. Only variant B asks for it in the editor. */
  weeks: number | null;
};

let seq = 0;
export const uid = () => `p${++seq}`;

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** Monday-first, the order a training week is read in. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export const GROUP_LABELS: Record<string, string> = {
  push_horizontal: "Horizontal push — push-ups, presses",
  push_vertical: "Overhead push — pike, handstand",
  pull: "Vertical pull — pull-ups, rows to the bar",
  squat: "Squat — squats, lunges, step-ups",
  hinge: "Hinge — deadlifts, bridges, swings",
  core_dynamic: "Core, moving — sit-ups, V-ups",
  core_hold: "Core, holding — planks, hollow holds",
  core_side: "Core, side — side planks",
  cardio_rope: "Jump rope",
};

export const groupLabel = (g: string | null) =>
  g ? (GROUP_LABELS[g] ?? g) : "no group";

/** The worked example (DN-131's transcription), as pasted text. */
export const WORKED_EXAMPLE_TEXT = `Monday — Chest and Triceps
Incline Dumbbell Chest Press 3x8
Barbell Bench Press 3x8
Low Cable Fly 4x8-10
Decline Skull Crusher 4x8-10
Dips 4x8-10

Tuesday — Lower Body
Barbell Squat 5x5 @ 225
Barbell Deadlift 5x5
Dumbbell Step Ups 3x8-12
Dumbbell Lunge 3x8-12
Leg Press 3x15-20

Wednesday — Traps and Shoulders
Barbell Row 5x5
Barbell Shrug 5x5
Dumbbell Shoulder Press 5x5
Seated Dumbbell Shrug 4x12
Dumbbell Lateral Raise 4x12

Thursday — Back and Biceps
Weighted Pull Ups 5x5
Underhand Grip Lat Pulldown 3x12-15
Barbell Curl 3x12-15
Dumbbell Palms-Up Curl 3x12-15

Friday — Upper Focused
Bent Over Barbell Row 2x10-15 & 2x5-8
Floor Press 2x10-15 & 2x5-8
Neutral Grip Pull Up 1x10 & 2xfailure
Push Press 1x10 & 2x5-8
Inverted Row 3x10
Plank 3x60s rest 45s
`;

// ---------------------------------------------------------------------------
// Matching free text to the library
// ---------------------------------------------------------------------------

const STOP = new Set(["seated", "weighted", "grip", "underhand", "neutral", "bent", "over", "the", "a"]);
/** An implement the text names must be one the exercise uses — "Barbell Row" is not "Dumbbell row". */
const IMPLEMENTS = new Set(["barbell", "dumbbell", "kettlebell", "cable", "machine", "band", "ring"]);
const words = (s: string) =>
  s.toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter(Boolean);
const stem = (w: string) => w.replace(/(ing|es|s)$/, "");

/**
 * Best library match for what the author wrote, or null. Deliberately dumb —
 * exact name first, then "every meaningful word of the exercise appears in
 * the text". Good enough to see how the editor behaves when most lines miss.
 */
export function matchExercise(text: string, library: ApiExercise[]): ApiExercise | null {
  const t = text.trim().toLowerCase();
  const exact = library.find((e) => e.name.toLowerCase() === t);
  if (exact) return exact;
  const have = new Set(words(text).filter((w) => !STOP.has(w)).map(stem));
  const saidImplements = [...have].filter((w) => IMPLEMENTS.has(w));
  let best: ApiExercise | null = null;
  let bestScore = 0;
  for (const e of library) {
    const all = words(e.name).map(stem);
    if (saidImplements.some((w) => !all.includes(w))) continue;
    // The exercise's own implement may go unsaid: "Floor Press" is the dumbbell floor press.
    const need = all.filter((w) => !STOP.has(w) && !IMPLEMENTS.has(w));
    if (need.length === 0) continue;
    if (need.every((w) => have.has(w)) && need.length > bestScore) {
      best = e;
      bestScore = need.length;
    }
  }
  return best;
}

/** Same-group swaps, so the picker can say what "adapts to equipment" means. */
export function groupMates(ex: ApiExercise, library: ApiExercise[]) {
  if (!ex.movementGroup) return [];
  return library.filter((e) => e.movementGroup === ex.movementGroup && e.id !== ex.id);
}

// ---------------------------------------------------------------------------
// Parsing a prescription line
// ---------------------------------------------------------------------------

const SCHEME = /(\d+)\s*[x×]\s*(failure|\d+\s*s\b|\d+(?:\s*[-–]\s*\d+)?)/gi;

/** "Barbell Squat 5x5 @ 225 rest 90s" → one Rx per "&"-joined scheme. */
export function parseLine(line: string, library: ApiExercise[]): Rx[] {
  const load = line.match(/@\s*([\d.]+\s*(?:kg|lb|lbs)?)/i);
  const rest = line.match(/rest\s*(\d+)\s*s?/i);
  const firstScheme = line.search(/\d+\s*[x×]/i);
  const name = (firstScheme >= 0 ? line.slice(0, firstScheme) : line).trim();
  const ex = matchExercise(name, library);

  const schemes = [...line.matchAll(SCHEME)];
  const base = {
    source: line.trim(),
    exerciseId: ex?.id ?? null,
    group: null,
    restSeconds: rest ? Number(rest[1]) : null,
    droppedLoad: load ? load[1].trim() : null,
  };
  if (schemes.length === 0) {
    return [{ id: uid(), ...base, sets: null, reps: null, repsMax: null, toFailure: false }];
  }
  return schemes.map((m) => {
    const sets = Number(m[1]);
    const r = m[2].toLowerCase().replace(/\s/g, "");
    if (r === "failure") return { id: uid(), ...base, sets, reps: null, repsMax: null, toFailure: true };
    if (r.endsWith("s")) return { id: uid(), ...base, sets, reps: Number(r.slice(0, -1)), repsMax: null, toFailure: false };
    const [lo, hi] = r.split(/[-–]/).map(Number);
    return { id: uid(), ...base, sets, reps: lo, repsMax: hi ?? null, toFailure: false };
  });
}

const DAY_HEADING = /^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b\s*[—:-]?\s*(.*)$/i;
const ORDER_HEADING = /^day\s*(\d+)\s*[—:-]?\s*(.*)$/i;

/** A whole pasted routine. Weekday headings pin it; "Day 1" headings don't. */
export function parseRoutine(text: string, library: ApiExercise[]): Draft {
  const days: Day[] = [];
  let pinned = true;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const wd = line.match(DAY_HEADING);
    const od = line.match(ORDER_HEADING);
    if (wd && !/\d\s*[x×]/i.test(line)) {
      const idx = WEEKDAYS.findIndex((d) => d.toLowerCase() === wd[1].toLowerCase().slice(0, 3));
      days.push({ id: uid(), name: wd[2] || WEEKDAYS[idx], weekday: idx, items: [] });
      continue;
    }
    if (od) {
      pinned = false;
      days.push({ id: uid(), name: od[2] || `Day ${od[1]}`, weekday: null, items: [] });
      continue;
    }
    if (days.length === 0) days.push({ id: uid(), name: "Day 1", weekday: null, items: [] });
    days[days.length - 1].items.push(...parseLine(line, library));
  }
  if (!pinned) days.forEach((d) => (d.weekday = null));
  return { name: "", pinned, days, weeks: null };
}

// ---------------------------------------------------------------------------
// The editor's refusals — the rules ADR 0005 moved out of the columns
// ---------------------------------------------------------------------------

export type Problem = { rxId: string; text: string };

export function problemsOf(rx: Rx): string[] {
  const out: string[] = [];
  if (!rx.exerciseId && !rx.group) out.push("No movement in the library matches this. Pick one, or leave it out.");
  if (rx.sets === null) out.push("How many sets?");
  if (!rx.toFailure && rx.reps === null) out.push("How many reps — or to failure?");
  if (rx.repsMax !== null && rx.reps !== null && rx.repsMax <= rx.reps) out.push("The top of the range must be above the bottom.");
  return out;
}

export function draftProblems(d: Draft): Problem[] {
  return d.days.flatMap((day) =>
    day.items.flatMap((rx) => problemsOf(rx).map((text) => ({ rxId: rx.id, text }))),
  );
}

export function formatScheme(rx: Rx, unit: "reps" | "seconds" = "reps") {
  const sets = rx.sets ?? "?";
  if (rx.toFailure) return `${sets} × failure`;
  if (rx.reps === null) return `${sets} × ?`;
  const reps = rx.repsMax ? `${rx.reps}–${rx.repsMax}` : `${rx.reps}`;
  return `${sets} × ${reps}${unit === "seconds" ? "s" : ""}`;
}

export function formatRest(rx: Rx) {
  if (rx.restSeconds === null) return "rest —";
  if (rx.restSeconds === 0) return "straight through";
  return `rest ${rx.restSeconds}s`;
}

export function blankRx(): Rx {
  return { id: uid(), source: "", exerciseId: null, group: null, sets: 3, reps: 10, repsMax: null, toFailure: false, restSeconds: null, droppedLoad: null };
}

export const cloneItems = (items: Rx[]) => items.map((r) => ({ ...r, id: uid() }));

// ---------------------------------------------------------------------------
// Shared bits of UI
// ---------------------------------------------------------------------------

export const mono = { fontFamily: "var(--font-mono)" } as const;
export const display = { fontFamily: "var(--font-display)" } as const;

export function Caps({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold tracking-[0.14em] text-[var(--ink-faint)]" style={mono}>
      {children}
    </p>
  );
}

/** Rule 5 of the prototype skill: always show the state. */
export function StatePanel({ draft, library }: { draft: Draft; library: ApiExercise[] }) {
  const problems = draftProblems(draft);
  const name = (id: string | null) => library.find((e) => e.id === id)?.name ?? null;
  const body = {
    name: draft.name,
    scheduleMode: draft.pinned ? "fixed" : "flexible",
    weeks: draft.weeks ?? "open-ended",
    days: draft.days.map((d) => ({
      name: d.name,
      dayOfWeek: d.weekday,
      movements: d.items.map((r) => ({
        exercise: name(r.exerciseId),
        movementGroup: r.group,
        sets: r.sets,
        reps: r.reps,
        repsMax: r.repsMax,
        toFailure: r.toFailure,
        restSeconds: r.restSeconds,
      })),
    })),
  };
  const count = draft.days.reduce((n, d) => n + d.items.length, 0);
  return (
    <details className="mx-4 mt-6 mb-28 border border-[var(--border)] bg-[var(--panel-2)] p-3 text-xs">
      <summary className="cursor-pointer text-[var(--ink-soft)]" style={mono}>
        STATE · {draft.days.length} days · {count} prescriptions ·{" "}
        <span className={problems.length ? "text-[var(--danger)]" : "text-[var(--glow)]"}>
          {problems.length ? `${problems.length} refusals — cannot save` : "saveable"}
        </span>
      </summary>
      <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap text-[var(--ink-soft)]" style={mono}>
        {JSON.stringify(body, null, 2)}
      </pre>
    </details>
  );
}

/**
 * Search-first movement picker: type what the routine says, get library
 * rows, and see what each one would swap to. Used by variants A and C.
 */
export function SearchPicker({
  library,
  initial,
  onPick,
  onClose,
}: {
  library: ApiExercise[];
  initial: string;
  onPick: (p: { exerciseId: string | null; group: string | null }) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState(initial);
  const needle = q.trim().toLowerCase();
  const hits = needle
    ? library.filter((e) => words(e.name).some((w) => needle.split(/\s+/).some((n) => n.length > 2 && w.startsWith(n.slice(0, 4)))))
    : library;
  const best = matchExercise(q, library);
  return (
    <div className="mt-2 border border-[var(--glow-dim)] bg-[var(--bg)] p-3">
      <div className="flex items-center gap-2">
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="What does the routine call it?"
          className="flex-1 border border-[var(--border)] bg-[var(--panel)] px-2 py-1 text-sm text-[var(--ink)]"
        />
        <button onClick={onClose} className="text-xs text-[var(--ink-faint)]">close</button>
      </div>
      {!best && needle && (
        <p className="mt-2 text-xs text-[var(--danger)]">
          Nothing in the library is “{q}”. The app won't guess a stand-in — pick the nearest yourself, or leave it out.
        </p>
      )}
      <ul className="mt-2 max-h-64 overflow-auto">
        {[...(best ? [best] : []), ...hits.filter((h) => h.id !== best?.id)].slice(0, 12).map((e) => {
          const mates = groupMates(e, library);
          return (
            <li key={e.id} className="border-t border-[var(--border)] py-2">
              <button className="w-full text-left" onClick={() => onPick({ exerciseId: e.id, group: null })}>
                <span className="text-sm text-[var(--ink)]">{e.name}</span>
                {e.id === best?.id && <span className="ml-2 text-[10px] text-[var(--glow)]" style={mono}>BEST MATCH</span>}
                <span className="block text-[11px] text-[var(--ink-faint)]">
                  {e.movementGroup
                    ? `Swaps with ${mates.slice(0, 3).map((m) => m.name).join(", ") || "nothing yet"} when your kit says so`
                    : "Stands alone — no swaps"}
                  {e.equipment.length ? ` · needs ${e.equipment.join(", ")}` : ""}
                </span>
              </button>
              {e.movementGroup && (
                <button
                  className="mt-1 text-[11px] text-[var(--glow)] underline"
                  onClick={() => onPick({ exerciseId: null, group: e.movementGroup })}
                >
                  or: any {groupLabel(e.movementGroup).split(" — ")[0].toLowerCase()}, chosen by my equipment
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function movementName(rx: Rx, library: ApiExercise[]) {
  if (rx.exerciseId) return library.find((e) => e.id === rx.exerciseId)?.name ?? "?";
  if (rx.group) return `Any ${groupLabel(rx.group).split(" — ")[0].toLowerCase()}`;
  return rx.source.replace(/\s*\d.*$/, "") || "Choose a movement";
}

export function unitOf(rx: Rx, library: ApiExercise[]) {
  return library.find((e) => e.id === rx.exerciseId)?.unit ?? "reps";
}

/** Compact sets/reps/rest editor, shared so the variants differ in structure, not in number inputs. */
export function SchemeFields({ rx, onChange }: { rx: Rx; onChange: (r: Rx) => void }) {
  const num = (v: string) => (v === "" ? null : Number(v));
  const field = "w-14 border border-[var(--border)] bg-[var(--panel)] px-1 py-1 text-center text-sm text-[var(--ink)]";
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--ink-soft)]" style={mono}>
      <input className={field} value={rx.sets ?? ""} onChange={(e) => onChange({ ...rx, sets: num(e.target.value) })} aria-label="sets" />
      <span>×</span>
      {rx.toFailure ? (
        <span className="text-[var(--glow)]">failure</span>
      ) : (
        <>
          <input className={field} value={rx.reps ?? ""} onChange={(e) => onChange({ ...rx, reps: num(e.target.value) })} aria-label="reps" />
          <span>to</span>
          <input className={field} placeholder="—" value={rx.repsMax ?? ""} onChange={(e) => onChange({ ...rx, repsMax: num(e.target.value) })} aria-label="reps max" />
        </>
      )}
      <label className="flex items-center gap-1">
        <input type="checkbox" checked={rx.toFailure} onChange={(e) => onChange({ ...rx, toFailure: e.target.checked, reps: e.target.checked ? null : 10, repsMax: null })} />
        failure
      </label>
      <span>rest</span>
      <input className={field} placeholder="—" value={rx.restSeconds ?? ""} onChange={(e) => onChange({ ...rx, restSeconds: num(e.target.value) })} aria-label="rest seconds" />
      <span>s</span>
    </div>
  );
}
