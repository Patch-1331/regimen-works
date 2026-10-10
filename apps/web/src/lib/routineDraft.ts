import type { CreateRoutine, MovementGroup } from "@regimen-works/shared";
import type { ApiExercise } from "./api";
import { lineLabel } from "./progressions";

/**
 * The routine editor's working copy (DN-145).
 *
 * Looser than `CreateRoutine` on purpose: a line the athlete is halfway
 * through has no movement yet, or a blank rep count, and the editor has to be
 * able to hold that and say what is missing. `toCreateRoutine` is the one
 * place it is tightened into what the API accepts, and `lineProblems` is what
 * the screen shows for every line that cannot be tightened yet.
 */

export type DraftLine = {
  id: string;
  exerciseId: string | null;
  movementGroup: MovementGroup | null;
  sets: number | null;
  reps: number | null;
  repsMax: number | null;
  toFailure: boolean;
  restSeconds: number | null;
};

export type RoutineDraft = {
  name: string;
  summary: string;
  /** "On these weekdays" (fixed) or "any N days a week, in this order" (flexible). */
  scheduleMode: CreateRoutine["scheduleMode"];
  /** Weekday → its lines. A weekday with no lines is a rest day. */
  days: Partial<Record<number, DraftLine[]>>;
};

let seq = 0;
export const lineId = () => `line-${++seq}`;

export const EMPTY_ROUTINE: RoutineDraft = {
  name: "",
  summary: "",
  scheduleMode: "flexible",
  days: {},
};

export function blankLine(): DraftLine {
  return {
    id: lineId(),
    exerciseId: null,
    movementGroup: null,
    sets: 3,
    reps: 10,
    repsMax: null,
    toFailure: false,
    restSeconds: null,
  };
}

/** The weekdays that carry at least one line, 0 = Sunday, ascending. */
export function trainingDays(draft: RoutineDraft): number[] {
  return Object.entries(draft.days)
    .filter(([, lines]) => (lines?.length ?? 0) > 0)
    .map(([day]) => Number(day))
    .sort((a, b) => a - b);
}

/**
 * What stops this line being saved, in the words the screen shows. The same
 * rules the API holds the body to (ADR 0005) -- stated here so the athlete
 * sees them on the line rather than as a refusal after pressing save.
 */
export function lineProblems(line: DraftLine): string[] {
  const out: string[] = [];
  if (!line.exerciseId && !line.movementGroup) out.push("Choose a movement.");
  if (line.sets === null || line.sets < 1) out.push("How many sets?");
  if (!line.toFailure && (line.reps === null || line.reps < 1)) {
    out.push("How many reps — or to failure?");
  }
  if (
    !line.toFailure &&
    line.repsMax !== null &&
    line.reps !== null &&
    line.repsMax <= line.reps
  ) {
    out.push("The top of the range must be above the bottom.");
  }
  return out;
}

/** Everything stopping a save: the name, an empty week, and every line. */
export function draftProblems(draft: RoutineDraft): string[] {
  const out: string[] = [];
  if (draft.name.trim() === "") out.push("Name the routine.");
  if (trainingDays(draft).length === 0) out.push("Add a movement to at least one day.");
  for (const lines of Object.values(draft.days)) {
    for (const line of lines ?? []) out.push(...lineProblems(line));
  }
  return out;
}

/**
 * The draft as the API body, once `draftProblems` is empty.
 *
 * A range whose top was left blank is a fixed count; a failure line carries
 * no count at all, whatever the reps box still held before it was ticked.
 */
export function toCreateRoutine(draft: RoutineDraft): CreateRoutine {
  const summary = draft.summary.trim();
  return {
    name: draft.name.trim(),
    summary: summary === "" ? null : summary,
    scheduleMode: draft.scheduleMode,
    days: trainingDays(draft).map((dayOfWeek) => ({
      dayOfWeek,
      lines: (draft.days[dayOfWeek] ?? []).map((line) => ({
        movementGroup: line.exerciseId ? null : line.movementGroup,
        exerciseId: line.exerciseId,
        sets: line.sets ?? 0,
        reps: line.toFailure ? null : line.reps,
        repsMax: line.toFailure ? null : line.repsMax,
        toFailure: line.toFailure,
        restSeconds: line.restSeconds,
      })),
    })),
  };
}

/** Copies `from`'s lines onto each of `to`, replacing what they held. */
export function copyDay(
  draft: RoutineDraft,
  from: number,
  to: number[],
): RoutineDraft {
  const lines = draft.days[from] ?? [];
  const days = { ...draft.days };
  for (const target of to) {
    days[target] = lines.map((line) => ({ ...line, id: lineId() }));
  }
  return { ...draft, days };
}

/** Puts a copy of the line straight after it. */
export function duplicateLine(
  draft: RoutineDraft,
  day: number,
  id: string,
): RoutineDraft {
  const lines = [...(draft.days[day] ?? [])];
  const at = lines.findIndex((l) => l.id === id);
  if (at < 0) return draft;
  lines.splice(at + 1, 0, { ...lines[at], id: lineId() });
  return { ...draft, days: { ...draft.days, [day]: lines } };
}

// ---------------------------------------------------------------------------
// Picking a movement: search first, a group beneath
// ---------------------------------------------------------------------------

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

/**
 * Library rows matching what the athlete typed, best first: an exact name,
 * then names starting with it, then names containing every word typed.
 */
export function searchExercises(
  query: string,
  library: ApiExercise[],
): ApiExercise[] {
  const q = query.trim().toLowerCase();
  if (q === "") return library;
  const typed = words(q);
  const rank = (e: ApiExercise) => {
    const name = e.name.toLowerCase();
    if (name === q) return 0;
    if (name.startsWith(q)) return 1;
    const have = words(name);
    if (typed.every((t) => have.some((w) => w.startsWith(t)))) return 2;
    return null;
  };
  return library
    .map((e) => ({ e, r: rank(e) }))
    .filter((x): x is { e: ApiExercise; r: number } => x.r !== null)
    .sort((a, b) => a.r - b.r || a.e.name.localeCompare(b.e.name))
    .map((x) => x.e);
}

/** Other members of the exercise's group -- what "swaps with…" names. */
export function groupMates(ex: ApiExercise, library: ApiExercise[]) {
  if (!ex.movementGroup) return [];
  return library.filter(
    (e) => e.movementGroup === ex.movementGroup && e.id !== ex.id,
  );
}

/** How a line's movement reads on the sheet. */
export function lineMovementName(line: DraftLine, library: ApiExercise[]) {
  if (line.exerciseId) {
    return library.find((e) => e.id === line.exerciseId)?.name ?? "Unknown movement";
  }
  if (line.movementGroup) return `Any ${lineLabel(line.movementGroup).toLowerCase()}`;
  return "Choose a movement";
}

export function formatScheme(line: DraftLine, unit: string = "reps") {
  const sets = line.sets ?? "?";
  if (line.toFailure) return `${sets} × failure`;
  if (line.reps === null) return `${sets} × ?`;
  const reps = line.repsMax ? `${line.reps}–${line.repsMax}` : `${line.reps}`;
  return `${sets} × ${reps}${unit === "seconds" ? "s" : ""}`;
}

export function formatRest(line: DraftLine) {
  if (line.restSeconds === null) return "rest —";
  if (line.restSeconds === 0) return "no rest";
  return `rest ${line.restSeconds}s`;
}
