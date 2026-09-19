import { describe, expect, it } from "vitest";
import { addIsoDays } from "./schedule.js";

/**
 * The date arithmetic both applications share (DN-15).
 *
 * `schedule.ts`'s schemas are exercised in `schemas.spec.ts` with the rest of
 * the contract; this is the one thing in the file that computes rather than
 * validates, and the cases that matter are the ones a naive implementation
 * gets wrong: month ends, year ends, leap days, and the daylight-saving
 * boundaries that are the whole reason the arithmetic is in UTC.
 */
describe("addIsoDays", () => {
  it("moves forward within a month", () => {
    expect(addIsoDays("2026-09-19", 3)).toBe("2026-09-22");
  });

  it("counts back when the offset is negative", () => {
    // The scheduler's pattern cooldown, which is what this direction is for.
    expect(addIsoDays("2026-09-19", -5)).toBe("2026-09-14");
  });

  it("returns the same day for an offset of zero", () => {
    expect(addIsoDays("2026-09-19", 0)).toBe("2026-09-19");
  });

  it("rolls over the end of a month", () => {
    expect(addIsoDays("2026-09-30", 1)).toBe("2026-10-01");
  });

  it("rolls over the end of a year", () => {
    expect(addIsoDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("knows February is 29 days long in a leap year", () => {
    expect(addIsoDays("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("knows it is 28 days long otherwise", () => {
    expect(addIsoDays("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("spans the wizard's three weeks in one call", () => {
    expect(addIsoDays("2026-09-19", 20)).toBe("2026-10-09");
  });

  it("crosses a spring daylight-saving boundary without losing a day", () => {
    // 2026-03-08 is when US clocks go forward. Local arithmetic here would
    // land on the same weekday at 23:00 the day before, which truncates to
    // the wrong date -- the reason this function works in UTC.
    expect(addIsoDays("2026-03-07", 1)).toBe("2026-03-08");
    expect(addIsoDays("2026-03-08", 1)).toBe("2026-03-09");
  });

  it("crosses an autumn boundary without repeating one", () => {
    expect(addIsoDays("2026-11-01", 1)).toBe("2026-11-02");
  });
});
