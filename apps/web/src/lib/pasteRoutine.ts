import {
  matchPastedMovement,
  parsePastedRoutine,
  type PastedLine,
  type PastedMatch,
  type PastedRoutine,
} from "@regimen-works/shared";
import type { ApiExercise } from "./api";
import { lineId, type DraftLine, type RoutineDraft } from "./routineDraft";

/**
 * The paste box's read-back (DN-152): every pasted line with the matcher's
 * answer, and what the athlete did about it. Only once nothing is left
 * unanswered does it become a draft for the week sheet -- which then holds
 * it to the sheet's own rules, like any routine typed there.
 */

export type MovementChoice = Pick<DraftLine, "exerciseId" | "movementGroup">;

export type ReadBackLine = {
  id: string;
  /** Index into the parsed routine's days. */
  day: number;
  line: PastedLine;
  match: PastedMatch<ApiExercise>;
  /** What the athlete chose from the picker, over whatever the matcher said. */
  picked: MovementChoice | null;
  /** LEAVE IT OUT, which can be undone. */
  leftOut: boolean;
};

export function readBack(text: string, library: ApiExercise[]) {
  const routine = parsePastedRoutine(text);
  // A retired movement can't go on a new routine; the picker doesn't offer
  // one either.
  const live = library.filter((e) => e.archivedAt === null);
  const lines: ReadBackLine[] = routine.days.flatMap((d, day) =>
    d.lines.map((line) => ({
      id: lineId(),
      day,
      line,
      match: matchPastedMovement(line.name, live),
      picked: null,
      leftOut: false,
    })),
  );
  return { routine, lines };
}

/** The movement a line will carry onto the sheet, or null while it has none. */
export function choiceOf(l: ReadBackLine): MovementChoice | null {
  if (l.picked) return l.picked;
  if (l.match.kind === "match") {
    return { exerciseId: l.match.exercise.id, movementGroup: null };
  }
  return null;
}

/** Refused lines the athlete has neither picked for nor left out. */
export function unresolved(lines: ReadBackLine[]): ReadBackLine[] {
  return lines.filter((l) => !l.leftOut && choiceOf(l) === null);
}

/** What stops the hand-off to the sheet, in the words the screen shows. */
export function pasteProblems(
  routine: PastedRoutine,
  lines: ReadBackLine[],
): string[] {
  if (lines.length === 0) return ["Nothing to read yet."];
  if (routine.days.length > 7) {
    return [`A week has seven days; this has ${routine.days.length}.`];
  }
  const open = unresolved(lines).length;
  if (open > 0) {
    return [`${open} ${open === 1 ? "line" : "lines"} to pick or leave out.`];
  }
  if (lines.every((l) => l.leftOut)) return ["Every line is left out."];
  return [];
}

/** Where a day without a weekday lands: in order, Monday first. */
const IN_ORDER = [1, 2, 3, 4, 5, 6, 0];

/**
 * The accepted lines as an unsaved week sheet. One sheet line per scheme,
 * since a sheet line has one: "2x10-15 & 2x5-8" is two lines of the same
 * movement. A line that gave no scheme keeps blank counts, which the sheet
 * then asks for.
 */
export function toPastedDraft(
  routine: PastedRoutine,
  lines: ReadBackLine[],
): RoutineDraft {
  const days: RoutineDraft["days"] = {};
  const labels: RoutineDraft["labels"] = {};
  routine.days.forEach((d, i) => {
    if (d.name) labels[d.dayOfWeek ?? IN_ORDER[i]] = d.name.slice(0, 40);
  });
  for (const l of lines) {
    const choice = choiceOf(l);
    if (l.leftOut || !choice) continue;
    const weekday = routine.days[l.day].dayOfWeek ?? IN_ORDER[l.day];
    const base = { ...choice, restSeconds: l.line.restSeconds };
    const out: DraftLine[] =
      l.line.schemes.length === 0
        ? [
            {
              id: lineId(),
              ...base,
              sets: null,
              reps: null,
              repsMax: null,
              toFailure: false,
            },
          ]
        : l.line.schemes.map((s) => ({
            id: lineId(),
            ...base,
            sets: s.sets,
            reps: s.reps,
            repsMax: s.repsMax,
            toFailure: s.toFailure,
          }));
    days[weekday] = [...(days[weekday] ?? []), ...out];
  }
  return {
    name: "",
    summary: "",
    scheduleMode: routine.scheduleMode,
    days,
    labels,
  };
}
