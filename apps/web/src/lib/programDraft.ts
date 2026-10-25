import {
  asUniform,
  loadStepLabel,
  uniformSets,
  type CreateProgram,
  type MovementGroup,
  type ProgramSet,
} from "@regimen-works/shared";
import type { ApiExercise } from "./api";
import { lineLabel } from "./progressions";
import { WEEKDAYS, weekdayName } from "./weekdays";

/**
 * The program editor's working copy (DN-145).
 *
 * Looser than `CreateProgram` on purpose: a line the athlete is halfway
 * through has no movement yet, or a blank rep count, and the editor has to be
 * able to hold that and say what is missing. `toCreateProgram` is the one
 * place it is tightened into what the API accepts, and `lineProblems` is what
 * the screen shows for every line that cannot be tightened yet.
 */

/** One set of a line written set by set (ADR 0011), loose like the line. */
export type DraftSet = {
  reps: number | null;
  repsMax: number | null;
  toFailure: boolean;
  /** Relative to the set before; ignored on the first set, which has none. */
  loadStepPercent: number | null;
  restSeconds: number | null;
};

/**
 * One line of a day. "Same for all sets" is the default and the common case:
 * a count beside one set's fields. `perSet` is the line written set by set --
 * by hand or from a preset -- and while it is there the flat fields are not
 * read. A convenience of the editor only: both save as a list of sets.
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
  /** The line set by set, or null for "same for all sets". */
  perSet: DraftSet[] | null;
};

export type ProgramDraft = {
  name: string;
  summary: string;
  /** "On these weekdays" (fixed) or "any N days a week, in this order" (flexible). */
  scheduleMode: CreateProgram["scheduleMode"];
  /**
   * Weekday → its lines. A weekday that is not here is a rest day; one that
   * is here with no lines is a training day not written yet (DN-193), which
   * the editor flags and the save refuses.
   */
  days: Partial<Record<number, DraftLine[]>>;
  /**
   * Weekday → the day's own name, e.g. "Chest and Triceps" (DN-155). Kept
   * apart from the lines: a name is wording, and a rest day's is not saved.
   */
  labels: Partial<Record<number, string>>;
};

let seq = 0;
export const lineId = () => `line-${++seq}`;

export const EMPTY_PROGRAM: ProgramDraft = {
  name: "",
  summary: "",
  scheduleMode: "flexible",
  days: {},
  labels: {},
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
    perSet: null,
  };
}

/** The weekdays that carry at least one line, 0 = Sunday, ascending. */
export function trainingDays(draft: ProgramDraft): number[] {
  return Object.entries(draft.days)
    .filter(([, lines]) => (lines?.length ?? 0) > 0)
    .map(([day]) => Number(day))
    .sort((a, b) => a - b);
}

/**
 * The weekdays picked to train on, written or not, in the order the week is
 * shown (Monday first): the wizard's day steps (DN-193).
 */
export function pickedDays(draft: ProgramDraft): number[] {
  return WEEKDAYS.map((d) => d.value).filter((day) => draft.days[day] !== undefined);
}

/**
 * Picks a weekday to train on, or drops it. A picked day starts with no lines;
 * a dropped one takes its lines with it, so `restore` is how a day dropped by
 * mistake comes back as it was.
 */
export function pickDay(
  draft: ProgramDraft,
  day: number,
  on: boolean,
  restore: DraftLine[] = [],
): ProgramDraft {
  const days = { ...draft.days };
  if (on) days[day] = days[day] ?? restore;
  else delete days[day];
  return { ...draft, days };
}

/** Moves a line one place up (-1) or down (+1) within its day. */
export function moveLine(
  draft: ProgramDraft,
  day: number,
  id: string,
  by: -1 | 1,
): ProgramDraft {
  const lines = [...(draft.days[day] ?? [])];
  const at = lines.findIndex((l) => l.id === id);
  const to = at + by;
  if (at < 0 || to < 0 || to >= lines.length) return draft;
  [lines[at], lines[to]] = [lines[to], lines[at]];
  return { ...draft, days: { ...draft.days, [day]: lines } };
}

/** What stops one picked day being saved: no lines yet, or a line's own. */
export function dayProblems(draft: ProgramDraft, day: number): string[] {
  const lines = draft.days[day] ?? [];
  if (lines.length === 0) return ["No movements yet."];
  return lines.flatMap(lineProblems);
}

/**
 * What stops this line being saved, in the words the screen shows. The same
 * rules the API holds the body to (ADR 0005) -- stated here so the athlete
 * sees them on the line rather than as a refusal after pressing save.
 */
export function lineProblems(line: DraftLine): string[] {
  const out: string[] = [];
  if (!line.exerciseId && !line.movementGroup) out.push("Choose a movement.");
  if (line.perSet === null) {
    if (line.sets === null || line.sets < 1) out.push("How many sets?");
    out.push(...countProblems(line, ""));
    return out;
  }
  if (line.perSet.length === 0) out.push("Add at least one set.");
  line.perSet.forEach((set, i) => {
    const at = `Set ${i + 1}: `;
    out.push(...countProblems(set, at));
    // The first set's step is never saved, so it is never a problem.
    if (i > 0 && set.loadStepPercent !== null && set.loadStepPercent <= -100) {
      out.push(`${at}a load can drop by less than 100%.`);
    }
  });
  return out;
}

/** One set's count, held to ADR 0005's three shapes. */
function countProblems(
  set: Pick<DraftSet, "reps" | "repsMax" | "toFailure">,
  at: string,
): string[] {
  const out: string[] = [];
  if (!set.toFailure && (set.reps === null || set.reps < 1)) {
    out.push(`${at}How many reps — or to failure?`);
  }
  if (
    !set.toFailure &&
    set.repsMax !== null &&
    set.reps !== null &&
    set.repsMax <= set.reps
  ) {
    out.push(`${at}The top of the range must be above the bottom.`);
  }
  return out;
}

/** Everything stopping a save: the name, an empty week, and every picked day. */
export function draftProblems(draft: ProgramDraft): string[] {
  const out: string[] = [];
  if (draft.name.trim() === "") out.push("Name the program.");
  const days = pickedDays(draft);
  if (days.length === 0) out.push("Pick at least one training day.");
  for (const day of days) {
    out.push(...dayProblems(draft, day).map((p) => `${weekdayName(day)}: ${p}`));
  }
  return out;
}

/**
 * The draft as the API body, once `draftProblems` is empty.
 *
 * A range whose top was left blank is a fixed count; a failure line carries
 * no count at all, whatever the reps box still held before it was ticked.
 */
export function toCreateProgram(draft: ProgramDraft): CreateProgram {
  const summary = draft.summary.trim();
  return {
    name: draft.name.trim(),
    summary: summary === "" ? null : summary,
    scheduleMode: draft.scheduleMode,
    days: trainingDays(draft).map((dayOfWeek) => ({
      dayOfWeek,
      ...dayLabel(draft, dayOfWeek),
      lines: (draft.days[dayOfWeek] ?? []).map((line) => ({
        movementGroup: line.exerciseId ? null : line.movementGroup,
        exerciseId: line.exerciseId,
        sets: lineSets(line),
      })),
    })),
  };
}

/** A line's sets for the body: one set copied N times, or each as written. */
function lineSets(line: DraftLine): ProgramSet[] {
  if (line.perSet === null) {
    return uniformSets(line.sets ?? 0, {
      reps: line.toFailure ? null : line.reps,
      repsMax: line.toFailure ? null : line.repsMax,
      toFailure: line.toFailure,
      restSeconds: line.restSeconds,
    });
  }
  return line.perSet.map((set, i) => ({
    reps: set.toFailure ? null : set.reps,
    repsMax: set.toFailure ? null : set.repsMax,
    toFailure: set.toFailure,
    restSeconds: set.restSeconds,
    // Nothing comes before the first set, so it has no step to state.
    loadStepPercent: i === 0 ? null : set.loadStepPercent,
  }));
}

/** A day's name for the body, left out where it has none. */
function dayLabel(draft: ProgramDraft, day: number): { label?: string } {
  const label = draft.labels[day]?.trim();
  return label ? { label } : {};
}

/**
 * A saved program back into a working copy, for editing it (DN-146). The
 * inverse of `toCreateProgram`: a summary the service wrote from the
 * schedule arrives as null and opens blank, showing as the placeholder.
 */
export function fromProgram(program: CreateProgram): ProgramDraft {
  return {
    name: program.name,
    summary: program.summary ?? "",
    scheduleMode: program.scheduleMode,
    days: Object.fromEntries(
      program.days.map((day) => [
        day.dayOfWeek,
        day.lines.map((line): DraftLine => {
          const movement = {
            id: lineId(),
            exerciseId: line.exerciseId,
            movementGroup: line.movementGroup,
          };
          // A line opens "same for all sets" wherever it can, and set by set
          // wherever that would lose something.
          const uniform = asUniform(line.sets);
          if (uniform === null) {
            const [first] = line.sets;
            return {
              ...movement,
              ...flatFields(line.sets.length, first),
              perSet: line.sets.map((s) => ({ ...s })),
            };
          }
          return {
            ...movement,
            ...flatFields(uniform.count, uniform.set),
            perSet: null,
          };
        }),
      ]),
    ),
    labels: Object.fromEntries(
      program.days.flatMap((day) => (day.label ? [[day.dayOfWeek, day.label]] : [])),
    ),
  };
}

/** "Same for all sets" fields: `count` of this one set. */
function flatFields(
  count: number,
  set: Omit<DraftSet, "loadStepPercent">,
): Pick<DraftLine, "sets" | "reps" | "repsMax" | "toFailure" | "restSeconds"> {
  return {
    sets: count,
    reps: set.reps,
    repsMax: set.repsMax,
    toFailure: set.toFailure,
    restSeconds: set.restSeconds,
  };
}

// ---------------------------------------------------------------------------
// Set by set (ADR 0011)
// ---------------------------------------------------------------------------

/**
 * The line written set by set: each of its sets as its own row, starting as
 * copies of the one set it had. Nothing changes until a row is edited.
 */
export function toPerSet(line: DraftLine): DraftLine {
  if (line.perSet !== null) return line;
  const set: DraftSet = {
    reps: line.toFailure ? null : line.reps,
    repsMax: line.toFailure ? null : line.repsMax,
    toFailure: line.toFailure,
    loadStepPercent: null,
    restSeconds: line.restSeconds,
  };
  return {
    ...line,
    perSet: Array.from({ length: Math.max(1, line.sets ?? 1) }, () => ({ ...set })),
  };
}

/**
 * Back to "same for all sets": as many sets as there were, each like the
 * first. What the other sets said differently -- and every load step -- is
 * dropped, which is what going back to one set's fields means.
 */
export function toSameForAll(line: DraftLine): DraftLine {
  if (line.perSet === null) return line;
  const [first] = line.perSet;
  return {
    ...line,
    ...(first ? flatFields(line.perSet.length, first) : { sets: null }),
    perSet: null,
  };
}

/** The presets a line can be filled from. Never stored: the sets are the line (ADR 0011). */
export const SET_PRESETS = [
  { id: "rpt", label: "RPT" },
  { id: "pyramid-up", label: "Ascending pyramid" },
  { id: "pyramid-down", label: "Descending pyramid" },
  { id: "top-backoff", label: "Top set + back-offs" },
  { id: "drop", label: "Drop set" },
  { id: "5-5-5plus", label: "5/5/5+" },
] as const;
export type SetPreset = (typeof SET_PRESETS)[number]["id"];

/**
 * Fills the line's sets from a preset, which the author then edits like any
 * other row. Every set rests what the line rested, except between a drop
 * set's drops, where no rest is the point (ADR 0011, decision 4).
 */
export function applyPreset(line: DraftLine, preset: SetPreset): DraftLine {
  const rest = line.perSet === null ? line.restSeconds : (line.perSet[0]?.restSeconds ?? null);
  const set = (
    reps: number | null,
    repsMax: number | null,
    loadStepPercent: number | null,
    restSeconds: number | null = rest,
  ): DraftSet => ({
    reps,
    repsMax,
    toFailure: reps === null,
    loadStepPercent,
    restSeconds,
  });
  const perSet: Record<SetPreset, DraftSet[]> = {
    // Heaviest first, then about 10% lighter for more reps each time.
    rpt: [set(6, 8, null), set(8, 10, -10), set(10, 12, -10)],
    // Load up, reps down.
    "pyramid-up": [set(12, null, null), set(10, null, 10), set(8, null, 10)],
    // Load down, reps up.
    "pyramid-down": [set(8, null, null), set(10, null, -10), set(12, null, -10)],
    // One heavy set, then back-offs at -15% and the same weight after it.
    "top-backoff": [set(5, null, null), set(5, null, -15), set(5, null, 0), set(5, null, 0)],
    // To failure, then drop and go again with no rest between drops.
    drop: [set(null, null, null, 0), set(null, null, -20, 0), set(null, null, -20)],
    // 5/3/1's rep pattern: the last set as many as you can. Its percentages
    // of a training max are out (DN-85), so the steps are left unstated.
    "5-5-5plus": [set(5, null, null), set(5, null, null), set(null, null, null)],
  };
  return { ...line, perSet: perSet[preset] };
}

/**
 * Whether the draft's week differs from `saved`'s -- the days, their lines,
 * or when they are trained. Name, summary and the days' names are wording,
 * not the week (ADR 0006, decision 6; DN-155), and never make a save a new
 * version.
 */
export function changesWeek(draft: ProgramDraft, saved: CreateProgram): boolean {
  const week = (r: CreateProgram) =>
    JSON.stringify({
      scheduleMode: r.scheduleMode,
      days: r.days.map(({ dayOfWeek, lines }) => ({ dayOfWeek, lines })),
    });
  return week(toCreateProgram(draft)) !== week(saved);
}

/**
 * Copies `from`'s lines onto each of `to`, replacing what they held. Not the
 * name: Monday's "Push" copied to Thursday is still Thursday.
 */
export function copyDay(
  draft: ProgramDraft,
  from: number,
  to: number[],
): ProgramDraft {
  const lines = draft.days[from] ?? [];
  const days = { ...draft.days };
  for (const target of to) {
    days[target] = lines.map((line) => ({ ...line, id: lineId() }));
  }
  return { ...draft, days };
}

/** Puts a copy of the line straight after it. */
export function duplicateLine(
  draft: ProgramDraft,
  day: number,
  id: string,
): ProgramDraft {
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

/** One set's count as the sheet reads it: "8", "8–10", "failure", "?". */
function formatCount(set: Pick<DraftSet, "reps" | "repsMax" | "toFailure">, unit: string) {
  if (set.toFailure) return "failure";
  if (set.reps === null) return "?";
  const reps = set.repsMax ? `${set.reps}–${set.repsMax}` : `${set.reps}`;
  return `${reps}${unit === "seconds" ? "s" : ""}`;
}

/**
 * The line's scheme on the sheet: "3 × 8–10", or set by set,
 * "6–8 / 8–10 −10% / 10–12 −10%".
 */
export function formatScheme(line: DraftLine, unit: string = "reps") {
  if (line.perSet !== null) {
    return line.perSet
      .map((set, i) => {
        const step = i === 0 ? null : loadStepLabel(set.loadStepPercent);
        return step ? `${formatCount(set, unit)} ${step}` : formatCount(set, unit);
      })
      .join(" / ");
  }
  const sets = line.sets ?? "?";
  if (line.toFailure) return `${sets} × failure`;
  return `${sets} × ${formatCount(line, unit)}`;
}

function formatOneRest(restSeconds: number | null) {
  if (restSeconds === null) return "rest —";
  if (restSeconds === 0) return "no rest";
  return `rest ${restSeconds}s`;
}

export function formatRest(line: DraftLine) {
  if (line.perSet === null) return formatOneRest(line.restSeconds);
  const rests = new Set(line.perSet.map((s) => s.restSeconds));
  if (rests.size > 1) return "rest varies";
  return formatOneRest(line.perSet[0]?.restSeconds ?? null);
}
