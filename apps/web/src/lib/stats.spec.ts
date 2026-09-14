import { describe, expect, it } from "vitest";
import type { WorkoutLogListItem } from "@regimen-works/shared";
import {
  computeForTimeTrends,
  computePRs,
  computePatternBalance,
  computePatternVolumeTrend,
  computeStreaks,
  computeWeeklyTrainingDays,
  computeWodTypeDistribution,
  formatResult,
  isoWeekStart,
  trainingDaysThisWeek,
} from "./stats";

/** A History row with only the fields the stat under test reads spelled out. */
function log(fields: Partial<WorkoutLogListItem>): WorkoutLogListItem {
  return {
    id: "log-1",
    assignmentId: "assignment-1",
    date: "2026-09-14",
    wodName: "Fran",
    wodType: "for_time",
    dominantPattern: "pull",
    resultType: "time_seconds",
    resultValue: "300",
    rpe: null,
    notes: null,
    ...fields,
  };
}

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

describe("formatResult", () => {
  it("renders a time as m:ss with a padded seconds field", () => {
    expect(formatResult("time_seconds", "305")).toBe("5:05");
  });

  it("keeps minutes past an hour as minutes, because the clock never shows hours", () => {
    expect(formatResult("time_seconds", "3725")).toBe("62:05");
  });

  it("reads a non-numeric time as zero rather than NaN:NaN", () => {
    expect(formatResult("time_seconds", "")).toBe("0:00");
  });

  it("spaces out a rounds+reps result", () => {
    expect(formatResult("rounds_reps", "5+12")).toBe("5 + 12");
  });

  it("leaves a whole-round result alone", () => {
    expect(formatResult("rounds_reps", "6")).toBe("6");
  });
});

describe("computePRs", () => {
  it("has no records to show before anything is logged", () => {
    expect(computePRs([])).toEqual([]);
  });

  it("treats the faster time as the record, not the later one", () => {
    const prs = computePRs([
      log({ wodName: "Fran", date: "2026-09-01", resultValue: "300" }),
      log({ wodName: "Fran", date: "2026-09-08", resultValue: "420" }),
    ]);
    expect(prs).toEqual([
      { wodName: "Fran", resultType: "time_seconds", resultValue: "300", date: "2026-09-01" },
    ]);
  });

  it("treats more rounds as the record for an AMRAP", () => {
    const prs = computePRs([
      log({ wodName: "Cindy", wodType: "amrap", resultType: "rounds_reps", resultValue: "12+3" }),
      log({ wodName: "Cindy", wodType: "amrap", resultType: "rounds_reps", resultValue: "11+19" }),
    ]);
    expect(prs[0].resultValue).toBe("12+3");
  });

  it("breaks an equal-rounds tie on the partial reps", () => {
    const prs = computePRs([
      log({ wodName: "Cindy", resultType: "rounds_reps", resultValue: "12+3" }),
      log({ wodName: "Cindy", resultType: "rounds_reps", resultValue: "12+14" }),
    ]);
    expect(prs[0].resultValue).toBe("12+14");
  });

  it("keeps the first of two equal results, so a PR needs beating rather than matching", () => {
    const prs = computePRs([
      log({ wodName: "Fran", date: "2026-09-01", resultValue: "300" }),
      log({ wodName: "Fran", date: "2026-09-08", resultValue: "300" }),
    ]);
    expect(prs[0].date).toBe("2026-09-01");
  });

  it("keeps one record per WOD, listed by name", () => {
    const prs = computePRs([
      log({ wodName: "Murph" }),
      log({ wodName: "Angie" }),
      log({ wodName: "Fran" }),
    ]);
    expect(prs.map((p) => p.wodName)).toEqual(["Angie", "Fran", "Murph"]);
  });
});

describe("computeStreaks", () => {
  it("reports nothing for an athlete with no logged days", () => {
    expect(computeStreaks([], "2026-09-16")).toEqual({ current: 0, longest: 0 });
  });

  it("counts a single logged day as a streak of one", () => {
    expect(computeStreaks(["2026-09-16"], "2026-09-16")).toEqual({ current: 1, longest: 1 });
  });

  it("counts consecutive calendar days", () => {
    const dates = ["2026-09-14", "2026-09-15", "2026-09-16"];
    expect(computeStreaks(dates, "2026-09-16")).toEqual({ current: 3, longest: 3 });
  });

  it("breaks the run on a skipped day, since rest days are not logged", () => {
    const dates = ["2026-09-14", "2026-09-16"];
    expect(computeStreaks(dates, "2026-09-16")).toEqual({ current: 1, longest: 1 });
  });

  it("keeps the current streak alive on a rest day, and drops it the day after", () => {
    const dates = ["2026-09-14", "2026-09-15"];
    // Yesterday still counts; the clock has not run out on training today.
    expect(computeStreaks(dates, "2026-09-16").current).toBe(2);
    expect(computeStreaks(dates, "2026-09-17").current).toBe(0);
  });

  it("remembers a longer past run after the current one has broken", () => {
    const dates = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-16"];
    expect(computeStreaks(dates, "2026-09-16")).toEqual({ current: 1, longest: 3 });
  });

  it("counts two workouts on one day as one day", () => {
    const dates = ["2026-09-15", "2026-09-16", "2026-09-16"];
    expect(computeStreaks(dates, "2026-09-16")).toEqual({ current: 2, longest: 2 });
  });

  it("does not need the dates handed to it in order", () => {
    const dates = ["2026-09-16", "2026-09-14", "2026-09-15"];
    expect(computeStreaks(dates, "2026-09-16")).toEqual({ current: 3, longest: 3 });
  });

  it("counts across a month boundary", () => {
    const dates = ["2026-08-31", "2026-09-01"];
    expect(computeStreaks(dates, "2026-09-01")).toEqual({ current: 2, longest: 2 });
  });

  it("counts across a year boundary", () => {
    const dates = ["2025-12-31", "2026-01-01"];
    expect(computeStreaks(dates, "2026-01-01")).toEqual({ current: 2, longest: 2 });
  });
});

describe("computePatternBalance", () => {
  it("has nothing to balance before anything is logged", () => {
    expect(computePatternBalance([])).toEqual([]);
  });

  it("counts logs per pattern, heaviest first", () => {
    const logs = [
      log({ dominantPattern: "push" }),
      log({ dominantPattern: "pull" }),
      log({ dominantPattern: "pull" }),
      log({ dominantPattern: "squat" }),
      log({ dominantPattern: "pull" }),
    ];
    expect(computePatternBalance(logs)).toEqual([
      { pattern: "pull", count: 3 },
      { pattern: "push", count: 1 },
      { pattern: "squat", count: 1 },
    ]);
  });
});

describe("computeWodTypeDistribution", () => {
  it("has no distribution before anything is logged", () => {
    // Guards the count/total division against an empty history.
    expect(computeWodTypeDistribution([])).toEqual([]);
  });

  it("reports each type's share of the logged workouts", () => {
    const logs = [
      log({ wodType: "amrap" }),
      log({ wodType: "amrap" }),
      log({ wodType: "for_time" }),
      log({ wodType: "emom" }),
    ];
    expect(computeWodTypeDistribution(logs)).toEqual([
      { wodType: "amrap", count: 2, percent: 50 },
      { wodType: "for_time", count: 1, percent: 25 },
      { wodType: "emom", count: 1, percent: 25 },
    ]);
  });
});

describe("isoWeekStart", () => {
  it("leaves a Monday where it is", () => {
    expect(isoWeekStart("2026-09-14")).toBe("2026-09-14");
  });

  it("walks a midweek day back to its Monday", () => {
    expect(isoWeekStart("2026-09-16")).toBe("2026-09-14");
  });

  it("keeps Sunday in the week that began six days earlier, not the one starting tomorrow", () => {
    // The off-by-one that matters: ISO weeks end on Sunday, they do not start there.
    expect(isoWeekStart("2026-09-20")).toBe("2026-09-14");
  });

  it("crosses back into the previous month when the week does", () => {
    expect(isoWeekStart("2026-09-01")).toBe("2026-08-31");
  });

  it("crosses back into the previous year when the week does", () => {
    // 2026-01-01 is a Thursday; its ISO week started in 2025.
    expect(isoWeekStart("2026-01-01")).toBe("2025-12-29");
  });
});

describe("computePatternVolumeTrend", () => {
  it("has no weeks to show before anything is logged", () => {
    expect(computePatternVolumeTrend([])).toEqual([]);
  });

  it("buckets pattern counts by ISO week, oldest week first", () => {
    const logs = [
      log({ date: "2026-09-16", dominantPattern: "pull" }),
      log({ date: "2026-09-14", dominantPattern: "pull" }),
      log({ date: "2026-09-20", dominantPattern: "squat" }),
      log({ date: "2026-09-21", dominantPattern: "push" }),
    ];
    // 2026-09-20 is the Sunday of the first week, 2026-09-21 the Monday of the next.
    expect(computePatternVolumeTrend(logs)).toEqual([
      { weekStart: "2026-09-14", counts: { pull: 2, squat: 1 } },
      { weekStart: "2026-09-21", counts: { push: 1 } },
    ]);
  });
});

describe("computeForTimeTrends", () => {
  it("ignores WODs logged only once, which have no trend yet", () => {
    expect(computeForTimeTrends([log({ wodName: "Fran" })])).toEqual([]);
  });

  it("ignores rounds+reps results, which are not times", () => {
    const logs = [
      log({ wodName: "Cindy", resultType: "rounds_reps", resultValue: "12+3" }),
      log({ wodName: "Cindy", resultType: "rounds_reps", resultValue: "13+0" }),
    ];
    expect(computeForTimeTrends(logs)).toEqual([]);
  });

  it("puts each WOD's attempts in date order, WODs by name", () => {
    const logs = [
      log({ wodName: "Fran", date: "2026-09-08", resultValue: "420" }),
      log({ wodName: "Fran", date: "2026-09-01", resultValue: "480" }),
      log({ wodName: "Annie", date: "2026-09-02", resultValue: "600" }),
      log({ wodName: "Annie", date: "2026-09-09", resultValue: "560" }),
    ];
    expect(computeForTimeTrends(logs)).toEqual([
      {
        wodName: "Annie",
        points: [
          { date: "2026-09-02", seconds: 600 },
          { date: "2026-09-09", seconds: 560 },
        ],
      },
      {
        wodName: "Fran",
        points: [
          { date: "2026-09-01", seconds: 480 },
          { date: "2026-09-08", seconds: 420 },
        ],
      },
    ]);
  });
});

describe("computeWeeklyTrainingDays", () => {
  it("has no weeks to show before anything is logged", () => {
    expect(computeWeeklyTrainingDays([])).toEqual([]);
  });

  it("counts distinct days per ISO week, oldest week first", () => {
    const dates = ["2026-09-21", "2026-09-16", "2026-09-14", "2026-09-14", "2026-09-20"];
    // Two logs on the Monday are one day; the Sunday belongs to the earlier week.
    expect(computeWeeklyTrainingDays(dates)).toEqual([
      { weekStart: "2026-09-14", days: 3 },
      { weekStart: "2026-09-21", days: 1 },
    ]);
  });
});
