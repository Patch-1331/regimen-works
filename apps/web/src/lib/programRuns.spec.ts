import { describe, expect, it } from "vitest";
import * as fixtures from "../test/fixtures";
import { currentRunLine, pastRunLine } from "./programRuns";

describe("currentRunLine", () => {
  it("says the week and the length", () => {
    expect(currentRunLine(fixtures.programRun())).toBe("Week 3 of 6");
  });

  it("says only the week of an open-ended run", () => {
    expect(
      currentRunLine(fixtures.programRun({ totalWeeks: null, week: 12 })),
    ).toBe("Week 12");
  });

  it("says when a run not yet begun starts", () => {
    expect(
      currentRunLine(
        fixtures.programRun({ week: null, startDate: "2026-11-02" }),
      ),
    ).toMatch(/^Starts .*2/);
  });
});

describe("pastRunLine", () => {
  it("counts the weeks of a finished run", () => {
    expect(
      pastRunLine(fixtures.programRun({ status: "completed", week: 6 })),
    ).toBe("finished, 6 weeks");
    expect(
      pastRunLine(
        fixtures.programRun({ status: "completed", totalWeeks: 1, week: 1 }),
      ),
    ).toBe("finished, 1 week");
  });

  it("says where an ended run stopped, out of how many", () => {
    expect(
      pastRunLine(fixtures.programRun({ status: "ended", week: 2 })),
    ).toBe("ended at week 2 of 6");
    expect(
      pastRunLine(
        fixtures.programRun({ status: "ended", totalWeeks: null, week: 9 }),
      ),
    ).toBe("ended at week 9");
  });
});
