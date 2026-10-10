import { describe, expect, it } from "vitest";
import {
  createRoutineSchema,
  defaultRoutineSummary,
  type CreateRoutine,
} from "./routine.js";

/**
 * The editor's rules, at the edge (DN-145, ADR 0005).
 *
 * The columns accept a half-written routine; this is what refuses one. A
 * regression here fails silently -- the row stores, the athlete gets a day
 * that means nothing -- so each rule has a test of its own.
 */

type Line = CreateRoutine["days"][number]["lines"][number];

const line = (overrides: Partial<Line> & Record<string, unknown> = {}) => ({
  movementGroup: "pull",
  exerciseId: null,
  sets: 3,
  reps: 8,
  repsMax: null,
  toFailure: false,
  restSeconds: 90,
  ...overrides,
});

const routine = (overrides: Record<string, unknown> = {}) => ({
  name: "Upper / Lower",
  summary: null,
  scheduleMode: "fixed",
  days: [
    { dayOfWeek: 1, lines: [line()] },
    { dayOfWeek: 4, lines: [line({ movementGroup: "squat" })] },
  ],
  ...overrides,
});

const withLine = (overrides: Record<string, unknown>) =>
  routine({ days: [{ dayOfWeek: 1, lines: [line(overrides)] }] });

const messages = (body: unknown) => {
  const result = createRoutineSchema.safeParse(body);
  return result.success ? [] : result.error.issues.map((i) => i.message);
};

describe("createRoutineSchema", () => {
  it("accepts a routine", () => {
    expect(createRoutineSchema.safeParse(routine()).success).toBe(true);
  });

  describe("every row names a group or an exercise", () => {
    it("accepts an exercise instead of a group", () => {
      expect(
        messages(withLine({ movementGroup: null, exerciseId: "ex_1" })),
      ).toEqual([]);
    });

    it("refuses a row naming neither", () => {
      expect(messages(withLine({ movementGroup: null }))).toEqual([
        "each line names a movement group or an exercise — one of them",
      ]);
    });

    it("refuses a row naming both", () => {
      expect(messages(withLine({ exerciseId: "ex_1" }))).toEqual([
        "each line names a movement group or an exercise — one of them",
      ]);
    });
  });

  describe("the rep shape is fixed, range or failure", () => {
    it("accepts a range", () => {
      expect(messages(withLine({ reps: 8, repsMax: 12 }))).toEqual([]);
    });

    it("accepts to failure", () => {
      expect(messages(withLine({ reps: null, toFailure: true }))).toEqual([]);
    });

    it("refuses a row with no count and no failure", () => {
      expect(messages(withLine({ reps: null }))).toHaveLength(1);
    });

    it("refuses a range whose top is not above its bottom", () => {
      expect(messages(withLine({ reps: 8, repsMax: 8 }))).toEqual([
        "the top of a range is above its bottom",
      ]);
    });
  });

  describe("rest may be unstated", () => {
    it("accepts null rest", () => {
      expect(messages(withLine({ restSeconds: null }))).toEqual([]);
    });

    it("accepts zero, which is a prescription rather than an omission", () => {
      expect(messages(withLine({ restSeconds: 0 }))).toEqual([]);
    });
  });

  describe("load is refused", () => {
    it("says the editor does not store it", () => {
      expect(messages(withLine({ load: "135 lb" }))).toEqual([
        "the editor does not store a load — prescribe sets and reps, and the athlete logs what they lift",
      ]);
    });

    it("refuses any other unknown key rather than dropping it", () => {
      expect(messages(withLine({ tempo: "3010" }))).toHaveLength(1);
      expect(messages(routine({ weeks: 8 }))).toHaveLength(1);
    });
  });

  describe("the week", () => {
    it("refuses a routine with no training days", () => {
      expect(messages(routine({ days: [] }))).toEqual([
        "a routine trains at least one day",
      ]);
    });

    it("refuses a day with no lines, because rest is the absence of a day", () => {
      expect(
        messages(routine({ days: [{ dayOfWeek: 1, lines: [] }] })),
      ).toEqual(["a training day needs at least one line"]);
    });

    it("refuses the same weekday twice", () => {
      expect(
        messages(
          routine({
            days: [
              { dayOfWeek: 1, lines: [line()] },
              { dayOfWeek: 1, lines: [line()] },
            ],
          }),
        ),
      ).toEqual(["each weekday appears once"]);
    });

    it("refuses a blank name", () => {
      expect(messages(routine({ name: "   " }))).toEqual(["name the routine"]);
    });

    it("reads a blank summary as no summary", () => {
      const parsed = createRoutineSchema.parse(routine({ summary: "  " }));
      expect(parsed.summary).toBeNull();
    });
  });
});

describe("defaultRoutineSummary", () => {
  it("counts the days of a flexible routine", () => {
    expect(defaultRoutineSummary("flexible", [1, 3, 5])).toBe(
      "Your routine, 3 days a week",
    );
    expect(defaultRoutineSummary("flexible", [6])).toBe(
      "Your routine, 1 day a week",
    );
  });

  it("names the weekdays of a fixed routine, Monday first", () => {
    expect(defaultRoutineSummary("fixed", [0, 5, 1])).toBe(
      "Your routine, Mon · Fri · Sun",
    );
  });
});
