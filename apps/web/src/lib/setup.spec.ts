import { describe, expect, it } from "vitest";
import * as fixtures from "../test/fixtures";
import {
  dayCountWarning,
  formatStartDate,
  listDays,
  startDateChoices,
  weekdayOf,
  weeksChoice,
} from "./setup";

/**
 * What the wizard works out before the API sees it (DN-15).
 *
 * The API re-checks every one of these and is the authority. These exist so
 * the athlete is told on the screen that asked — a wizard that takes four
 * days and refuses the whole setup two screens later has asked a question it
 * was never going to accept the answer to.
 */

describe("dayCountWarning", () => {
  const program = fixtures.boundedProgram(); // 3–5 days a week

  it("says nothing about a count inside the bounds", () => {
    expect(dayCountWarning(program, [1, 3, 5])).toBeNull();
  });

  it("accepts the bounds themselves", () => {
    // Off by one here is a program refusing the cadence it advertises.
    expect(dayCountWarning(program, [1, 2, 3])).toBeNull();
    expect(dayCountWarning(program, [1, 2, 3, 4, 5])).toBeNull();
  });

  it("names the program and the number when there are too few days", () => {
    // The same sentence the API would send back, deliberately: the athlete
    // should not be able to tell which layer refused them.
    expect(dayCountWarning(program, [1, 3])).toBe(
      "Pull-Up Builder needs at least 3 days a week.",
    );
  });

  it("names the program and the number when there are too many", () => {
    expect(dayCountWarning(program, [1, 2, 3, 4, 5, 6])).toBe(
      "Pull-Up Builder runs at most 5 days a week.",
    );
  });

  it("asks for a day before it asks for the program's minimum", () => {
    // An empty week is not a cadence the app has anywhere to put, and "at
    // least one" is what the athlete has actually done wrong.
    expect(dayCountWarning(program, [])).toBe("Pick at least one day.");
  });

  it("says day rather than days where the bound is one", () => {
    expect(
      dayCountWarning(
        fixtures.setupProgram({ name: "Just WODs", maxDaysPerWeek: 1 }),
        [1, 3],
      ),
    ).toBe("Just WODs runs at most 1 day a week.");
    // Only the maximum can reach the singular: a minimum of one is
    // unreachable, because the empty week is caught a group earlier. Both
    // sentences go through the same helper so there is no second wording to
    // leave plural.
  });

  it("has no complaint about a fixed program, whose days are not the athlete's", () => {
    expect(dayCountWarning(fixtures.fixedProgram(), [])).toBeNull();
  });
});

describe("startDateChoices", () => {
  it("offers every date between the two the API sent, inclusive", () => {
    const dates = startDateChoices("2026-09-16", "2026-09-19");
    expect(dates).toEqual([
      "2026-09-16",
      "2026-09-17",
      "2026-09-18",
      "2026-09-19",
    ]);
  });

  it("offers exactly the three weeks the API allowed", () => {
    // Built by walking to the date the API sent rather than by counting
    // twenty-one here, so the grid can never offer a date the commit refuses.
    expect(startDateChoices("2026-09-16", "2026-10-06")).toHaveLength(21);
  });

  it("crosses a month end", () => {
    expect(startDateChoices("2026-09-29", "2026-10-02")).toEqual([
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
    ]);
  });
});

describe("weekdayOf", () => {
  it("reads a date's weekday in the app's numbering", () => {
    // 2026-09-14 is a Monday. This is what underlines a Monday in the grid,
    // and reading it as local time is how a Monday becomes a Sunday for
    // anyone west of UTC.
    expect(weekdayOf("2026-09-14")).toBe(1);
    expect(weekdayOf("2026-09-13")).toBe(0);
  });
});

describe("formatStartDate", () => {
  it("names the day, because that is what the athlete plans around", () => {
    expect(formatStartDate("2026-09-21")).toBe("Monday 21 September");
  });
});

describe("weeksChoice", () => {
  it("starts at the length the program was written as", () => {
    expect(weeksChoice(fixtures.boundedProgram())).toEqual({
      min: 4,
      max: 8,
      start: 6,
    });
  });

  it("has no length for an open-ended program", () => {
    // Just WODs never finishes, so a stepper here would be a completion date
    // for something that never completes.
    expect(weeksChoice(fixtures.setupProgram())).toBeNull();
  });

  it("falls back to the minimum where a program suggests no length", () => {
    expect(
      weeksChoice(fixtures.boundedProgram({ defaultWeeks: null })),
    ).toEqual({ min: 4, max: 8, start: 4 });
  });
});

describe("listDays", () => {
  it("names the days in the order the week runs", () => {
    // Given out of order, because the days arrive from the program's own
    // array and nothing upstream promises to sort them (DN-124).
    expect(listDays([5, 1, 2, 4])).toBe("Monday, Tuesday, Thursday and Friday");
  });

  it("joins the last one with 'and', because this is a sentence", () => {
    // Read inside a line of prose rather than shown as a list, so a trailing
    // comma would be a comma splice in the athlete's face.
    expect(listDays([1, 3])).toBe("Monday and Wednesday");
    expect(listDays([1])).toBe("Monday");
  });

  it("says nothing for no days at all", () => {
    // A flexible program's `fixedDays` is empty. Nothing here reads it, but
    // returning "undefined" if something ever did would be worse than "".
    expect(listDays([])).toBe("");
  });
});
