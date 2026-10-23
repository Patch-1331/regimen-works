import { describe, expect, it } from "vitest";
import {
  asUniform,
  createProgramSchema,
  defaultProgramSummary,
  LEGACY_PROGRAM_EXPORT_FORMAT,
  PROGRAM_EXPORT_FORMAT,
  programExportEnvelopeSchema,
  type CreateProgram,
  uniformSets,
} from "./program.js";

/**
 * The editor's rules, at the edge (DN-145, ADR 0005).
 *
 * The columns accept a half-written program; this is what refuses one. A
 * regression here fails silently -- the row stores, the athlete gets a day
 * that means nothing -- so each rule has a test of its own.
 */

type Line = CreateProgram["days"][number]["lines"][number];
type Set = Line["sets"][number];

const set = (overrides: Partial<Set> & Record<string, unknown> = {}) => ({
  reps: 8,
  repsMax: null,
  toFailure: false,
  restSeconds: 90,
  ...overrides,
});

const line = (overrides: Partial<Line> & Record<string, unknown> = {}) => ({
  movementGroup: "pull",
  exerciseId: null,
  sets: [set(), set(), set()],
  ...overrides,
});

const program = (overrides: Record<string, unknown> = {}) => ({
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
  program({ days: [{ dayOfWeek: 1, lines: [line(overrides)] }] });

/** A line of one set, so a rule on the set is reported once. */
const withSet = (overrides: Record<string, unknown>) =>
  withLine({ sets: [set(overrides)] });

const messages = (body: unknown) => {
  const result = createProgramSchema.safeParse(body);
  return result.success ? [] : result.error.issues.map((i) => i.message);
};

describe("createProgramSchema", () => {
  it("accepts a program", () => {
    expect(createProgramSchema.safeParse(program()).success).toBe(true);
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
      expect(messages(withSet({ reps: 8, repsMax: 12 }))).toEqual([]);
    });

    it("accepts to failure", () => {
      expect(messages(withSet({ reps: null, toFailure: true }))).toEqual([]);
    });

    it("refuses a row with no count and no failure", () => {
      expect(messages(withSet({ reps: null }))).toHaveLength(1);
    });

    it("refuses a range whose top is not above its bottom", () => {
      expect(messages(withSet({ reps: 8, repsMax: 8 }))).toEqual([
        "the top of a range is above its bottom",
      ]);
    });
  });

  describe("a line is a list of sets (ADR 0011)", () => {
    it("refuses a line with no sets", () => {
      expect(messages(withLine({ sets: [] }))).toEqual([
        "a line has at least one set",
      ]);
    });

    it("holds each set to the rep shape on its own", () => {
      expect(
        messages(withLine({ sets: [set(), set({ reps: 8, repsMax: 8 })] })),
      ).toEqual(["the top of a range is above its bottom"]);
    });

    it("refuses an unknown key on a set rather than dropping it", () => {
      expect(messages(withSet({ tempo: "3010" }))).toHaveLength(1);
    });
  });

  // DN-190: an export file, or an editor page loaded before the deploy, still
  // writes a line as a count beside one shape.
  describe("a line written as a count", () => {
    const counted = {
      movementGroup: "pull",
      exerciseId: null,
      sets: 3,
      reps: 8,
      repsMax: 10,
      toFailure: false,
      restSeconds: 0,
    };

    it("reads as that many identical sets", () => {
      const result = createProgramSchema.parse(
        program({ days: [{ dayOfWeek: 1, lines: [counted] }] }),
      );
      expect(result.days[0].lines[0]).toEqual({
        movementGroup: "pull",
        exerciseId: null,
        sets: uniformSets(3, {
          reps: 8,
          repsMax: 10,
          toFailure: false,
          restSeconds: 0,
        }),
      });
    });

    it("keeps a null rest null", () => {
      const result = createProgramSchema.parse(
        program({
          days: [{ dayOfWeek: 1, lines: [{ ...counted, restSeconds: null }] }],
        }),
      );
      expect(
        result.days[0].lines[0].sets.map((s) => s.restSeconds),
      ).toEqual([null, null, null]);
    });

    it("still refuses no sets, and a malformed shape", () => {
      expect(
        messages(program({ days: [{ dayOfWeek: 1, lines: [{ ...counted, sets: 0 }] }] })),
      ).toEqual(["a line has at least one set"]);
      expect(
        messages(
          program({ days: [{ dayOfWeek: 1, lines: [{ ...counted, sets: 1, reps: null, repsMax: null }] }] }),
        ),
      ).toHaveLength(1);
    });
  });

  describe("rest may be unstated", () => {
    it("accepts null rest", () => {
      expect(messages(withSet({ restSeconds: null }))).toEqual([]);
    });

    it("accepts zero, which is a prescription rather than an omission", () => {
      expect(messages(withSet({ restSeconds: 0 }))).toEqual([]);
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
      expect(messages(program({ weeks: 8 }))).toHaveLength(1);
    });
  });

  describe("the week", () => {
    it("refuses a program with no training days", () => {
      expect(messages(program({ days: [] }))).toEqual([
        "a program trains at least one day",
      ]);
    });

    it("refuses a day with no lines, because rest is the absence of a day", () => {
      expect(
        messages(program({ days: [{ dayOfWeek: 1, lines: [] }] })),
      ).toEqual(["a training day needs at least one line"]);
    });

    it("refuses the same weekday twice", () => {
      expect(
        messages(
          program({
            days: [
              { dayOfWeek: 1, lines: [line()] },
              { dayOfWeek: 1, lines: [line()] },
            ],
          }),
        ),
      ).toEqual(["each weekday appears once"]);
    });

    it("refuses a blank name", () => {
      expect(messages(program({ name: "   " }))).toEqual(["name the program"]);
    });

    it("reads a blank summary as no summary", () => {
      const parsed = createProgramSchema.parse(program({ summary: "  " }));
      expect(parsed.summary).toBeNull();
    });
  });

  describe("a day may be named (DN-155)", () => {
    const named = (label: unknown) =>
      program({ days: [{ dayOfWeek: 1, label, lines: [line()] }] });

    it("keeps a name, trimmed", () => {
      const parsed = createProgramSchema.parse(named("  Chest and Triceps "));
      expect(parsed.days[0].label).toBe("Chest and Triceps");
    });

    it("reads a blank name as no name", () => {
      expect(createProgramSchema.parse(named("   ")).days[0].label).toBeNull();
    });

    it("still reads a day with no name at all, as older files have", () => {
      const parsed = createProgramSchema.parse(program());
      expect(parsed.days[0].label ?? null).toBeNull();
    });

    it("refuses a name over 40 characters", () => {
      expect(createProgramSchema.safeParse(named("x".repeat(41))).success).toBe(false);
      expect(createProgramSchema.safeParse(named("x".repeat(40))).success).toBe(true);
    });
  });
});

describe("defaultProgramSummary", () => {
  it("counts the days of a flexible program", () => {
    expect(defaultProgramSummary("flexible", [1, 3, 5])).toBe(
      "Your program, 3 days a week",
    );
    expect(defaultProgramSummary("flexible", [6])).toBe(
      "Your program, 1 day a week",
    );
  });

  it("names the weekdays of a fixed program, Monday first", () => {
    expect(defaultProgramSummary("fixed", [0, 5, 1])).toBe(
      "Your program, Mon · Fri · Sun",
    );
  });
});

/**
 * An export file says what it is (DN-150). DN-177 renamed what it says, and a
 * file written before that is still a file somebody kept: both strings load,
 * and both come out the same shape.
 */
describe("programExportEnvelopeSchema", () => {
  it("reads a file written today", () => {
    expect(
      programExportEnvelopeSchema.parse({
        format: "regimen-works/programs",
        version: 1,
        programs: [{ name: "Pull days" }],
      }),
    ).toEqual({
      format: PROGRAM_EXPORT_FORMAT,
      version: 1,
      programs: [{ name: "Pull days" }],
    });
  });

  it("reads a file written before DN-177 as the same file", () => {
    expect(LEGACY_PROGRAM_EXPORT_FORMAT).toBe("regimen-works/routines");
    expect(
      programExportEnvelopeSchema.parse({
        format: "regimen-works/routines",
        version: 1,
        routines: [{ name: "Pull days" }],
      }),
    ).toEqual({
      format: PROGRAM_EXPORT_FORMAT,
      version: 1,
      programs: [{ name: "Pull days" }],
    });
  });

  it("holds an old file to the same rules", () => {
    const result = programExportEnvelopeSchema.safeParse({
      format: "regimen-works/routines",
      version: 2,
      routines: [],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path[0])).toEqual([
      "version",
      "programs",
    ]);
  });

  it("refuses what is not an export at all", () => {
    for (const file of [null, "regimen-works/routines", [], { format: "something/else" }]) {
      expect(programExportEnvelopeSchema.safeParse(file).success).toBe(false);
    }
  });
});

describe("asUniform", () => {
  const fixed = { reps: 5, repsMax: null, toFailure: false, restSeconds: 90 };

  it("reads N identical sets back as N of one", () => {
    expect(asUniform(uniformSets(5, fixed))).toEqual({ count: 5, set: fixed });
  });

  it("tells null rest from 0", () => {
    expect(
      asUniform([fixed, { ...fixed, restSeconds: null }]),
    ).toBeNull();
    expect(asUniform([{ ...fixed, restSeconds: 0 }, { ...fixed, restSeconds: 0 }]))
      .toEqual({ count: 2, set: { ...fixed, restSeconds: 0 } });
  });

  it("is null where the sets differ, or there are none", () => {
    expect(asUniform([fixed, { ...fixed, reps: 6 }])).toBeNull();
    expect(asUniform([])).toBeNull();
  });
});
