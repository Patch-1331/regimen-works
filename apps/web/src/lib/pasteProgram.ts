import {
  matchPastedMovement,
  parsePastedProgram,
  type PastedLine,
  type PastedMatch,
  type PastedProgram,
} from "@regimen-works/shared";
import type { ApiExercise } from "./api";
import { lineId, type DraftLine, type ProgramDraft } from "./programDraft";

/**
 * The paste box's read-back (DN-152): every pasted line with the matcher's
 * answer, and what the athlete did about it. Only once nothing is left
 * unanswered does it become a draft for the week sheet -- which then holds
 * it to the sheet's own rules, like any program typed there.
 */

export type MovementChoice = Pick<DraftLine, "exerciseId" | "movementGroup">;

export type ReadBackLine = {
  id: string;
  /** Index into the parsed program's days. */
  day: number;
  line: PastedLine;
  match: PastedMatch<ApiExercise>;
  /** What the athlete chose from the picker, over whatever the matcher said. */
  picked: MovementChoice | null;
  /** LEAVE IT OUT, which can be undone. */
  leftOut: boolean;
};

export function readBack(text: string, library: ApiExercise[]) {
  const program = parsePastedProgram(text);
  // A retired movement can't go on a new program; the picker doesn't offer
  // one either.
  const live = library.filter((e) => e.archivedAt === null);
  const lines: ReadBackLine[] = program.days.flatMap((d, day) =>
    d.lines.map((line) => ({
      id: lineId(),
      day,
      line,
      match: matchPastedMovement(line.name, live),
      picked: null,
      leftOut: false,
    })),
  );
  return { program, lines };
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
  program: PastedProgram,
  lines: ReadBackLine[],
): string[] {
  if (lines.length === 0) return ["Nothing to read yet."];
  if (program.days.length > 7) {
    return [`A week has seven days; this has ${program.days.length}.`];
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
 * The accepted lines as an unsaved week sheet. One sheet line per pasted
 * line: "1x10 & 2xfailure" is one line of three sets, in the order written
 * (ADR 0011) -- set by set where the schemes differ, "same for all sets" where
 * there is only one. A line that gave no scheme keeps blank counts, which the
 * sheet then asks for. Every set rests what the line said.
 */
export function toPastedDraft(
  program: PastedProgram,
  lines: ReadBackLine[],
): ProgramDraft {
  const days: ProgramDraft["days"] = {};
  const labels: ProgramDraft["labels"] = {};
  program.days.forEach((d, i) => {
    if (d.name) labels[d.dayOfWeek ?? IN_ORDER[i]] = d.name.slice(0, 40);
  });
  for (const l of lines) {
    const choice = choiceOf(l);
    if (l.leftOut || !choice) continue;
    const weekday = program.days[l.day].dayOfWeek ?? IN_ORDER[l.day];
    const restSeconds = l.line.restSeconds;
    const [only, ...more] = l.line.schemes;
    const out: DraftLine = {
      id: lineId(),
      ...choice,
      sets: only?.sets ?? null,
      reps: only?.reps ?? null,
      repsMax: only?.repsMax ?? null,
      toFailure: only?.toFailure ?? false,
      restSeconds,
      // Load steps are not read from a paste yet (DN-189), so every one is
      // the silence it was.
      perSet:
        more.length === 0
          ? null
          : l.line.schemes.flatMap((s) =>
              Array.from({ length: s.sets }, () => ({
                reps: s.reps,
                repsMax: s.repsMax,
                toFailure: s.toFailure,
                loadStepPercent: null,
                restSeconds,
              })),
            ),
    };
    days[weekday] = [...(days[weekday] ?? []), out];
  }
  return {
    name: "",
    summary: "",
    scheduleMode: program.scheduleMode,
    days,
    labels,
  };
}
