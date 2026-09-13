import { describe, expect, it } from "vitest";
import { trainingDaysThisWeek } from "./stats";

/**
 * What the completion card says about the week (DN-8). It counts; it does not
 * compare the count to anything, which is what keeps it a record rather than a
 * score against the schedule cap.
 *
 * Weeks are ISO — Monday to Sunday. 2026-09-14 is a Monday.
 */

const MONDAY = "2026-09-14";
const WEDNESDAY = "2026-09-16";
const SUNDAY = "2026-09-20";
const PREVIOUS_SUNDAY = "2026-09-13";

describe("trainingDaysThisWeek", () => {
  it("counts today even though the session being celebrated is not saved yet", () => {
    expect(trainingDaysThisWeek([], WEDNESDAY)).toBe(1);
  });

  it("does not double-count a day already logged", () => {
    // Two workouts in one day is one day trained.
    expect(trainingDaysThisWeek([WEDNESDAY, WEDNESDAY], WEDNESDAY)).toBe(1);
  });

  it("counts distinct earlier days in the same week", () => {
    expect(trainingDaysThisWeek([MONDAY, "2026-09-15"], WEDNESDAY)).toBe(3);
  });

  it("ignores the previous week, including the Sunday before", () => {
    expect(trainingDaysThisWeek([PREVIOUS_SUNDAY, "2026-09-10"], MONDAY)).toBe(1);
  });

  it("keeps Sunday in the week that started on Monday", () => {
    expect(trainingDaysThisWeek([MONDAY], SUNDAY)).toBe(2);
  });

  it("ignores dates after today, which are not days trained yet", () => {
    expect(trainingDaysThisWeek([SUNDAY], WEDNESDAY)).toBe(1);
  });
});
