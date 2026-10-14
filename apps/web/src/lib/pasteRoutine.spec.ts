import { describe, expect, it } from "vitest";
import * as fixtures from "../test/fixtures";
import {
  pasteProblems,
  readBack,
  toPastedDraft,
  unresolved,
} from "./pasteRoutine";

/**
 * The paste box's read-back and hand-off (DN-152). What a line matches is
 * the shared matcher's business and tested there; this is what the athlete
 * does about each answer, and what reaches the week sheet.
 */

const SQUAT = fixtures.apiExercise({
  id: "squat",
  name: "Barbell squat",
  equipment: ["barbell"],
});
const PLANK = fixtures.apiExercise({
  id: "plank",
  name: "Plank",
  equipment: [],
  unit: "seconds",
});
const LIBRARY = [SQUAT, PLANK];

describe("readBack", () => {
  it("gives every line the matcher's answer, nothing picked or left out", () => {
    const { lines } = readBack("Monday\nBarbell Squat 5x5\nLow Cable Fly 4x8", LIBRARY);
    expect(lines.map((l) => [l.line.name, l.match.kind, l.leftOut])).toEqual([
      ["Barbell Squat", "match", false],
      ["Low Cable Fly", "none", false],
    ]);
  });

  it("leaves an archived exercise out of the matching", () => {
    const retired = { ...SQUAT, archivedAt: "2026-10-01T00:00:00.000Z" };
    const { lines } = readBack("Barbell Squat 5x5", [retired]);
    expect(lines[0].match.kind).toBe("none");
  });
});

describe("unresolved and pasteProblems", () => {
  it("holds a refused line until it is picked or left out", () => {
    const { routine, lines } = readBack("Low Cable Fly 4x8\nPlank 3x60s", LIBRARY);
    expect(unresolved(lines)).toHaveLength(1);
    expect(pasteProblems(routine, lines)).toEqual(["1 line to pick or leave out."]);

    const picked = lines.map((l, i) =>
      i === 0 ? { ...l, picked: { exerciseId: "squat", movementGroup: null } } : l,
    );
    expect(pasteProblems(routine, picked)).toEqual([]);

    const left = lines.map((l, i) => (i === 0 ? { ...l, leftOut: true } : l));
    expect(pasteProblems(routine, left)).toEqual([]);
  });

  it("refuses an empty paste, and one with everything left out", () => {
    const empty = readBack("  \n", LIBRARY);
    expect(pasteProblems(empty.routine, empty.lines)).toEqual(["Nothing to read yet."]);

    const { routine, lines } = readBack("Plank 3x60s", LIBRARY);
    expect(
      pasteProblems(
        routine,
        lines.map((l) => ({ ...l, leftOut: true })),
      ),
    ).toEqual(["Every line is left out."]);
  });

  it("refuses more days than a week holds", () => {
    const text = Array.from({ length: 8 }, (_, i) => `Day ${i + 1}\nPlank 3x60s`).join("\n");
    const { routine, lines } = readBack(text, LIBRARY);
    expect(pasteProblems(routine, lines)).toEqual([
      "A week has seven days; this has 8.",
    ]);
  });
});

describe("toPastedDraft", () => {
  it("puts weekday-headed days on their weekdays, one line per scheme", () => {
    const { routine, lines } = readBack(
      "Tuesday\nBarbell Squat 2x10-15 & 2xfailure @ 225 rest 90s\nThursday\nPlank 3x60s",
      LIBRARY,
    );
    const draft = toPastedDraft(routine, lines);
    expect(draft.scheduleMode).toBe("fixed");
    expect(Object.keys(draft.days)).toEqual(["2", "4"]);
    expect(draft.days[2]).toEqual([
      expect.objectContaining({
        exerciseId: "squat",
        sets: 2,
        reps: 10,
        repsMax: 15,
        toFailure: false,
        restSeconds: 90,
      }),
      expect.objectContaining({
        exerciseId: "squat",
        sets: 2,
        reps: null,
        toFailure: true,
        restSeconds: 90,
      }),
    ]);
    expect(draft.days[4]).toEqual([
      expect.objectContaining({ exerciseId: "plank", sets: 3, reps: 60 }),
    ]);
  });

  it("lays Day N days on the week in order, Monday first", () => {
    const { routine, lines } = readBack("Day 1\nPlank 3x60s\nDay 2\nBarbell Squat 5x5", LIBRARY);
    const draft = toPastedDraft(routine, lines);
    expect(draft.scheduleMode).toBe("flexible");
    expect(draft.days[1]?.[0].exerciseId).toBe("plank");
    expect(draft.days[2]?.[0].exerciseId).toBe("squat");
  });

  it("uses what was picked, and leaves out what was left out", () => {
    const { routine, lines } = readBack(
      "Monday\nLow Cable Fly 4x8\nDips 3x8\nPlank 3x60s",
      LIBRARY,
    );
    const draft = toPastedDraft(routine, [
      { ...lines[0], picked: { exerciseId: null, movementGroup: "push_horizontal" } },
      { ...lines[1], leftOut: true },
      lines[2],
    ]);
    expect(draft.days[1]?.map((l) => [l.exerciseId, l.movementGroup])).toEqual([
      [null, "push_horizontal"],
      ["plank", null],
    ]);
  });

  it("keeps a line that gave no scheme, for the sheet to ask about", () => {
    const { routine, lines } = readBack("Plank", LIBRARY);
    expect(toPastedDraft(routine, lines).days[1]).toEqual([
      expect.objectContaining({ exerciseId: "plank", sets: null, reps: null }),
    ]);
  });
});
