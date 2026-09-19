import { describe, expect, it } from "vitest";
import { formatSetsResult, parseSetsResult } from "./log.js";

describe("formatSetsResult", () => {
  it("carries both halves", () => {
    expect(formatSetsResult({ completed: 6, total: 8 })).toBe("6/8");
  });

  it("keeps the denominator on a session that finished", () => {
    // "8" alone would be a number with nothing to measure it against, and the
    // prescription that would measure it lives on a slot an author can edit.
    expect(formatSetsResult({ completed: 8, total: 8 })).toBe("8/8");
  });

  it("round-trips", () => {
    expect(parseSetsResult(formatSetsResult({ completed: 3, total: 9 }))).toEqual({
      completed: 3,
      total: 9,
    });
  });
});

describe("parseSetsResult", () => {
  it("reads a result back", () => {
    expect(parseSetsResult("6/8")).toEqual({ completed: 6, total: 8 });
  });

  it("reads a session where nothing got done", () => {
    // Distinct from an unparseable row: zero of eight is a fact about a day,
    // and the athlete who started and stopped is owed the record of it.
    expect(parseSetsResult("0/8")).toEqual({ completed: 0, total: 8 });
  });

  it("refuses a result that is not this shape", () => {
    expect(parseSetsResult("5+12")).toBeNull();
    expect(parseSetsResult("240")).toBeNull();
    expect(parseSetsResult("")).toBeNull();
  });

  it("refuses a partial or padded match", () => {
    // Anchored, so a value with a result buried in it is not read as one.
    expect(parseSetsResult("6/8 sets")).toBeNull();
    expect(parseSetsResult(" 6/8")).toBeNull();
    expect(parseSetsResult("6/8/10")).toBeNull();
  });

  it("refuses a negative count rather than reading past the sign", () => {
    expect(parseSetsResult("-1/8")).toBeNull();
  });

  it("refuses more sets than were prescribed", () => {
    // Not a better session — a number that did not come from this app.
    expect(parseSetsResult("9/8")).toBeNull();
  });

  it("refuses a day that prescribed nothing", () => {
    expect(parseSetsResult("0/0")).toBeNull();
  });
});
