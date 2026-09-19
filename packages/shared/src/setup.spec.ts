import { describe, expect, it } from "vitest";
import {
  SETUP_START_DATE_DAYS,
  commitSetupSchema,
  setupOptionsSchema,
  setupProgramSchema,
} from "./setup.js";

/**
 * The wizard's contract (DN-15).
 *
 * Weighted towards rejection for the same reason the rest of this package's
 * specs are: a payload that parses is proved every time the app runs, and the
 * malformed one is the case nobody exercises by hand. The rules that need the
 * chosen program or a clock to judge -- day counts against a program's bounds,
 * a start date against the offered window -- live in the API's `setup.logic`
 * and are tested there; these are the ones a shape can answer on its own.
 */

function program(overrides: Record<string, unknown> = {}) {
  return {
    id: "plan-1",
    name: "Pull-Up Builder",
    summary: "Six weeks to your first unassisted chin-up.",
    goal: "your first unassisted chin-up",
    scheduleMode: "flexible",
    minDaysPerWeek: 3,
    maxDaysPerWeek: 5,
    defaultDays: [1, 3, 5],
    minWeeks: 4,
    maxWeeks: 8,
    defaultWeeks: 6,
    fixedDays: [],
    ...overrides,
  };
}

function options(overrides: Record<string, unknown> = {}) {
  return {
    programs: [program()],
    trainingDays: [1, 3, 5],
    earliestStartDate: "2026-09-19",
    latestStartDate: "2026-10-09",
    ...overrides,
  };
}

function answers(overrides: Record<string, unknown> = {}) {
  return {
    planId: "plan-1",
    trainingDays: [1, 3, 5],
    weeks: 6,
    startDate: "2026-09-19",
    ...overrides,
  };
}

describe("SETUP_START_DATE_DAYS", () => {
  it("is three whole weeks, so every weekday is offered equally often", () => {
    expect(SETUP_START_DATE_DAYS % 7).toBe(0);
    expect(SETUP_START_DATE_DAYS).toBe(21);
  });
});

describe("setupProgramSchema", () => {
  it("accepts a flexible program with no fixed days", () => {
    expect(setupProgramSchema.safeParse(program()).success).toBe(true);
  });

  it("accepts a fixed program and the days it fixed", () => {
    expect(
      setupProgramSchema.safeParse(
        program({
          scheduleMode: "fixed",
          minDaysPerWeek: null,
          maxDaysPerWeek: null,
          defaultDays: [],
          fixedDays: [1, 2, 4, 5],
        }),
      ).success,
    ).toBe(true);
  });

  it("still enforces the plan's own schedule-mode rule", () => {
    // The intersection must not weaken `planSchema`: a fixed program stating
    // day bounds is the case the database's CHECK also refuses.
    expect(
      setupProgramSchema.safeParse(program({ scheduleMode: "fixed" })).success,
    ).toBe(false);
  });

  it("refuses a program that omits its fixed days entirely", () => {
    const { fixedDays: _omitted, ...withoutFixedDays } = program();
    expect(setupProgramSchema.safeParse(withoutFixedDays).success).toBe(false);
  });

  it("refuses a weekday outside 0-6", () => {
    expect(
      setupProgramSchema.safeParse(program({ fixedDays: [7] })).success,
    ).toBe(false);
  });

  it("refuses more fixed days than a week has", () => {
    expect(
      setupProgramSchema.safeParse(program({ fixedDays: [0, 1, 2, 3, 4, 5, 6, 0] }))
        .success,
    ).toBe(false);
  });
});

describe("setupOptionsSchema", () => {
  it("accepts a filled-in wizard payload", () => {
    expect(setupOptionsSchema.safeParse(options()).success).toBe(true);
  });

  it("refuses an empty program list", () => {
    // There is always Just WODs, so no programs at all means the API failed to
    // load rather than that the athlete has no choice -- and a wizard whose
    // first question has no answers cannot be finished.
    expect(setupOptionsSchema.safeParse(options({ programs: [] })).success).toBe(
      false,
    );
  });

  it("refuses stored training days that are empty", () => {
    expect(
      setupOptionsSchema.safeParse(options({ trainingDays: [] })).success,
    ).toBe(false);
  });

  it("refuses a start date carrying a time", () => {
    expect(
      setupOptionsSchema.safeParse(
        options({ earliestStartDate: "2026-09-19T00:00:00.000Z" }),
      ).success,
    ).toBe(false);
  });
});

describe("commitSetupSchema", () => {
  it("accepts the three answers", () => {
    expect(commitSetupSchema.safeParse(answers()).success).toBe(true);
  });

  it("accepts null days and null weeks, the fixed open-ended pair", () => {
    expect(
      commitSetupSchema.safeParse(answers({ trainingDays: null, weeks: null }))
        .success,
    ).toBe(true);
  });

  it("normalises the days the athlete tapped into ascending order", () => {
    const parsed = commitSetupSchema.parse(answers({ trainingDays: [5, 1, 3] }));
    expect(parsed.trainingDays).toEqual([1, 3, 5]);
  });

  it("refuses a day listed twice", () => {
    expect(
      commitSetupSchema.safeParse(answers({ trainingDays: [1, 1, 3] })).success,
    ).toBe(false);
  });

  it("refuses an empty day list, which null is the way to say", () => {
    expect(
      commitSetupSchema.safeParse(answers({ trainingDays: [] })).success,
    ).toBe(false);
  });

  it("refuses a program with no id", () => {
    expect(commitSetupSchema.safeParse(answers({ planId: "" })).success).toBe(
      false,
    );
  });

  it("refuses a length of zero weeks", () => {
    expect(commitSetupSchema.safeParse(answers({ weeks: 0 })).success).toBe(
      false,
    );
  });

  it("refuses a fractional number of weeks", () => {
    expect(commitSetupSchema.safeParse(answers({ weeks: 6.5 })).success).toBe(
      false,
    );
  });

  it("refuses a start date that is not a date", () => {
    expect(
      commitSetupSchema.safeParse(answers({ startDate: "next Monday" })).success,
    ).toBe(false);
  });
});
