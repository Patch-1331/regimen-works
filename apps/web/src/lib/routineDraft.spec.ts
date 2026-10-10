import { describe, expect, it } from "vitest";
import { createRoutineSchema } from "@regimen-works/shared";
import * as fixtures from "../test/fixtures";
import {
  EMPTY_ROUTINE,
  blankLine,
  copyDay,
  draftProblems,
  duplicateLine,
  lineProblems,
  searchExercises,
  toCreateRoutine,
  trainingDays,
  type DraftLine,
  type RoutineDraft,
} from "./routineDraft";

/**
 * The editor's working copy (DN-145). What matters is that a draft the
 * screen calls saveable is one the API accepts -- the two sides state the
 * same rules, so each is checked against the shared schema here.
 */

const line = (overrides: Partial<DraftLine> = {}): DraftLine => ({
  ...blankLine(),
  movementGroup: "pull",
  ...overrides,
});

const draft = (overrides: Partial<RoutineDraft> = {}): RoutineDraft => ({
  ...EMPTY_ROUTINE,
  name: "Mine",
  days: { 1: [line()], 4: [line({ movementGroup: "squat" })] },
  ...overrides,
});

describe("lineProblems", () => {
  it("wants a movement", () => {
    expect(lineProblems(line({ movementGroup: null }))).toEqual([
      "Choose a movement.",
    ]);
  });

  it("wants a count unless the line is to failure", () => {
    expect(lineProblems(line({ reps: null }))).toEqual([
      "How many reps — or to failure?",
    ]);
    expect(lineProblems(line({ reps: null, toFailure: true }))).toEqual([]);
  });

  it("wants a range to go up", () => {
    expect(lineProblems(line({ reps: 8, repsMax: 8 }))).toEqual([
      "The top of the range must be above the bottom.",
    ]);
  });

  it("does not want a rest", () => {
    expect(lineProblems(line({ restSeconds: null }))).toEqual([]);
  });
});

describe("draftProblems", () => {
  it("wants a name and a day", () => {
    expect(draftProblems({ ...EMPTY_ROUTINE })).toEqual([
      "Name the routine.",
      "Add a movement to at least one day.",
    ]);
  });
});

describe("toCreateRoutine", () => {
  it("gives the API a body it accepts, rest days left out", () => {
    const body = toCreateRoutine(draft({ days: { 1: [line()], 3: [] } }));

    expect(createRoutineSchema.safeParse(body).success).toBe(true);
    expect(body.days.map((d) => d.dayOfWeek)).toEqual([1]);
  });

  it("sends no count on a failure line, whatever the box held", () => {
    const body = toCreateRoutine(
      draft({ days: { 1: [line({ toFailure: true, reps: 10 })] } }),
    );

    expect(body.days[0].lines[0]).toMatchObject({ reps: null, toFailure: true });
    expect(createRoutineSchema.safeParse(body).success).toBe(true);
  });

  it("sends a blank summary as none, for the API to write", () => {
    expect(toCreateRoutine(draft({ summary: "  " })).summary).toBeNull();
  });
});

describe("repetition", () => {
  it("copies a day onto other weekdays as new lines", () => {
    const d = draft();
    const next = copyDay(d, 1, [2, 5]);

    expect(trainingDays(next)).toEqual([1, 2, 4, 5]);
    expect(next.days[2]![0].id).not.toBe(d.days[1]![0].id);
    expect(next.days[2]![0].movementGroup).toBe("pull");
  });

  it("duplicates a line straight after itself", () => {
    const first = line();
    const d = draft({ days: { 1: [first, line({ movementGroup: "hinge" })] } });
    const next = duplicateLine(d, 1, first.id);

    expect(next.days[1]!.map((l) => l.movementGroup)).toEqual([
      "pull",
      "pull",
      "hinge",
    ]);
  });
});

describe("searchExercises", () => {
  const library = [
    fixtures.apiExercise({ id: "a", name: "Ring row" }),
    fixtures.apiExercise({ id: "b", name: "Row" }),
    fixtures.apiExercise({ id: "c", name: "Barbell bent-over row" }),
    fixtures.apiExercise({ id: "d", name: "Push-up" }),
    fixtures.apiExercise({ id: "e", name: "Rowing sprint" }),
  ];

  it("puts an exact name first, then names starting with it, then the rest", () => {
    expect(searchExercises("row", library).map((e) => e.id)).toEqual([
      "b",
      "e",
      "c",
      "a",
    ]);
  });

  it("matches every word typed, in any order", () => {
    expect(searchExercises("row barb", library).map((e) => e.id)).toEqual([
      "c",
    ]);
  });
});
