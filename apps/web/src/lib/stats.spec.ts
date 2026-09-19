import { describe, expect, it } from "vitest";
import type { MovementVolume, WorkoutLogListItem } from "@regimen-works/shared";
import {
  compareToLastSession,
  computeForTimeTrends,
  computeMovementVolumeTrends,
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

type WodBlock = NonNullable<WorkoutLogListItem["wod"]>;

/**
 * A WOD row with only the fields the stat under test reads spelled out.
 *
 * `wodType` and `dominantPattern` stay flat here and are folded into the
 * nested `wod` block, so a test that cares about one of them says so in one
 * word rather than in a nested literal (DN-126).
 */
function log({
  wodType = "for_time",
  dominantPattern = "pull",
  ...fields
}: Partial<Omit<WorkoutLogListItem, "wod">> & {
  wodType?: WodBlock["type"];
  dominantPattern?: WodBlock["dominantPattern"];
}): WorkoutLogListItem {
  return {
    id: "log-1",
    assignmentId: "assignment-1",
    date: "2026-09-14",
    name: "Fran",
    wod: { type: wodType, dominantPattern },
    resultType: "time_seconds",
    resultValue: "300",
    rpe: null,
    notes: null,
    ...fields,
  };
}

/** A finished prescribed day: a name, no WOD, and a result counted in sets. */
function strengthLog(fields: Partial<WorkoutLogListItem> = {}): WorkoutLogListItem {
  return {
    ...log({}),
    name: "Strength",
    wod: null,
    resultType: "sets_completed",
    resultValue: "5/5",
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

  it("leaves a sets result as it stands, slash and all", () => {
    // The slash is what tells "six of eight sets" apart from "six rounds" at a
    // glance, so spacing it out the way a rounds result is spaced would take
    // the one thing distinguishing them (DN-126).
    expect(formatResult("sets_completed", "6/8")).toBe("6/8");
  });
});

describe("computePRs", () => {
  it("leaves prescribed days out, having no score to be best at", () => {
    // Every finished strength day reads "5/5", so a table of them would be a
    // list of ties presented as records (DN-126).
    expect(computePRs([strengthLog(), strengthLog({ id: "log-2" })])).toEqual([]);
  });

  it("has no records to show before anything is logged", () => {
    expect(computePRs([])).toEqual([]);
  });

  it("treats the faster time as the record, not the later one", () => {
    const prs = computePRs([
      log({ name: "Fran", date: "2026-09-01", resultValue: "300" }),
      log({ name: "Fran", date: "2026-09-08", resultValue: "420" }),
    ]);
    expect(prs).toEqual([
      { wodName: "Fran", resultType: "time_seconds", resultValue: "300", date: "2026-09-01" },
    ]);
  });

  it("treats more rounds as the record for an AMRAP", () => {
    const prs = computePRs([
      log({ name: "Cindy", wodType: "amrap", resultType: "rounds_reps", resultValue: "12+3" }),
      log({ name: "Cindy", wodType: "amrap", resultType: "rounds_reps", resultValue: "11+19" }),
    ]);
    expect(prs[0].resultValue).toBe("12+3");
  });

  it("breaks an equal-rounds tie on the partial reps", () => {
    const prs = computePRs([
      log({ name: "Cindy", resultType: "rounds_reps", resultValue: "12+3" }),
      log({ name: "Cindy", resultType: "rounds_reps", resultValue: "12+14" }),
    ]);
    expect(prs[0].resultValue).toBe("12+14");
  });

  it("keeps the first of two equal results, so a PR needs beating rather than matching", () => {
    const prs = computePRs([
      log({ name: "Fran", date: "2026-09-01", resultValue: "300" }),
      log({ name: "Fran", date: "2026-09-08", resultValue: "300" }),
    ]);
    expect(prs[0].date).toBe("2026-09-01");
  });

  it("keeps one record per WOD, listed by name", () => {
    const prs = computePRs([
      log({ name: "Murph" }),
      log({ name: "Angie" }),
      log({ name: "Fran" }),
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

  it("leaves a prescribed day out, having no pattern to count it under", () => {
    // A strength day has no dominant pattern -- it is several movements with
    // no single shape. Counting it as one would be the chart inventing a fact
    // about the session (DN-126).
    expect(computePatternBalance([log({ dominantPattern: "pull" }), strengthLog()])).toEqual([
      { pattern: "pull", count: 1 },
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

  it("takes its shares over the WODs, not over every day trained", () => {
    // A strength day belongs in neither numerator nor denominator: it has no
    // WOD type, and leaving it in the denominator makes the shares sum to
    // less than 100% and says the athlete trained less than they did.
    const shares = computeWodTypeDistribution([
      log({ wodType: "amrap" }),
      log({ wodType: "for_time" }),
      strengthLog(),
    ]);

    expect(shares.reduce((sum, s) => sum + s.percent, 0)).toBe(100);
    expect(shares).toEqual([
      { wodType: "amrap", count: 1, percent: 50 },
      { wodType: "for_time", count: 1, percent: 50 },
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
    expect(computeForTimeTrends([log({ name: "Fran" })])).toEqual([]);
  });

  it("ignores rounds+reps results, which are not times", () => {
    const logs = [
      log({ name: "Cindy", resultType: "rounds_reps", resultValue: "12+3" }),
      log({ name: "Cindy", resultType: "rounds_reps", resultValue: "13+0" }),
    ];
    expect(computeForTimeTrends(logs)).toEqual([]);
  });

  it("puts each WOD's attempts in date order, WODs by name", () => {
    const logs = [
      log({ name: "Fran", date: "2026-09-08", resultValue: "420" }),
      log({ name: "Fran", date: "2026-09-01", resultValue: "480" }),
      log({ name: "Annie", date: "2026-09-02", resultValue: "600" }),
      log({ name: "Annie", date: "2026-09-09", resultValue: "560" }),
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

/** One movement's recorded sessions, newest first the way the API answers. */
function volume(
  sessions: Array<{ date: string; assignmentId?: string; sets: number[] }>,
  overrides: Partial<MovementVolume> = {},
): MovementVolume {
  return {
    exerciseId: "chin-up",
    name: "Chin-up",
    unit: "reps",
    sessions: sessions.map((s) => ({
      date: s.date,
      assignmentId: s.assignmentId ?? s.date,
      sets: s.sets,
    })),
    ...overrides,
  };
}

describe("computeMovementVolumeTrends", () => {
  it("totals each session and runs them oldest to newest", () => {
    // The API answers newest-first, a chart reads left to right.
    const [trend] = computeMovementVolumeTrends([
      volume([
        { date: "2026-09-14", sets: [3, 3, 3] },
        { date: "2026-09-07", sets: [3, 3, 2] },
      ]),
    ]);

    expect(trend.points).toEqual([
      { date: "2026-09-07", sets: [3, 3, 2], total: 8 },
      { date: "2026-09-14", sets: [3, 3, 3], total: 9 },
    ]);
  });

  it("carries the unit, so a hold is not read as reps", () => {
    const [trend] = computeMovementVolumeTrends([
      volume(
        [
          { date: "2026-09-14", sets: [40, 40] },
          { date: "2026-09-07", sets: [30, 30] },
        ],
        { exerciseId: "hollow-hold", name: "Hollow hold", unit: "seconds" },
      ),
    ]);

    expect(trend.unit).toBe("seconds");
  });

  it("leaves out a movement trained only once", () => {
    // One bar is a number, not a trend, and the day's log already says it.
    expect(computeMovementVolumeTrends([volume([{ date: "2026-09-14", sets: [3, 3] }])])).toEqual([]);
  });

  it("orders the cards by movement name", () => {
    const trends = computeMovementVolumeTrends([
      volume(
        [
          { date: "2026-09-14", sets: [8] },
          { date: "2026-09-07", sets: [8] },
        ],
        { exerciseId: "push-up", name: "Push-up" },
      ),
      volume([
        { date: "2026-09-14", sets: [3] },
        { date: "2026-09-07", sets: [3] },
      ]),
    ]);

    expect(trends.map((t) => t.name)).toEqual(["Chin-up", "Push-up"]);
  });

  it("answers nothing when no movement has been recorded", () => {
    expect(computeMovementVolumeTrends([])).toEqual([]);
  });
});

describe("compareToLastSession", () => {
  it("puts this session beside the one before it", () => {
    const [comparison] = compareToLastSession(
      [
        volume([
          { date: "2026-09-14", assignmentId: "today", sets: [3, 3, 3] },
          { date: "2026-09-07", assignmentId: "before", sets: [3, 3, 2] },
        ]),
      ],
      "today",
    );

    expect(comparison).toEqual({
      exerciseId: "chin-up",
      name: "Chin-up",
      sets: [3, 3, 3],
      previous: [3, 3, 2],
      direction: "up",
    });
  });

  it("reads a smaller total as down", () => {
    const [comparison] = compareToLastSession(
      [
        volume([
          { date: "2026-09-14", assignmentId: "today", sets: [3, 2, 2] },
          { date: "2026-09-07", assignmentId: "before", sets: [3, 3, 3] },
        ]),
      ],
      "today",
    );

    expect(comparison.direction).toBe("down");
  });

  it("reads an equal total as the same, whatever shape it was", () => {
    // 3, 3, 2 and 2, 3, 3 are different sessions with one total, and the
    // direction is about the total -- the sets themselves are quoted beside
    // it so the difference is still there to read.
    const [comparison] = compareToLastSession(
      [
        volume([
          { date: "2026-09-14", assignmentId: "today", sets: [3, 3, 2] },
          { date: "2026-09-07", assignmentId: "before", sets: [2, 3, 3] },
        ]),
      ],
      "today",
    );

    expect(comparison).toMatchObject({ direction: "same", previous: [2, 3, 3] });
  });

  it("has no direction the first time a movement is trained", () => {
    const [comparison] = compareToLastSession(
      [volume([{ date: "2026-09-14", assignmentId: "today", sets: [3, 3] }])],
      "today",
    );

    expect(comparison).toMatchObject({ previous: null, direction: null });
  });

  it("compares every movement the session held", () => {
    const comparisons = compareToLastSession(
      [
        volume([
          { date: "2026-09-14", assignmentId: "today", sets: [3, 3] },
          { date: "2026-09-07", assignmentId: "before", sets: [3, 2] },
        ]),
        volume(
          [
            { date: "2026-09-14", assignmentId: "today", sets: [8, 8] },
            { date: "2026-09-07", assignmentId: "before", sets: [8, 8] },
          ],
          { exerciseId: "push-up", name: "Push-up" },
        ),
      ],
      "today",
    );

    expect(comparisons.map((c) => [c.name, c.direction])).toEqual([
      ["Chin-up", "up"],
      ["Push-up", "same"],
    ]);
  });

  it("leaves out a movement this session did not train", () => {
    // Matched by assignment, not by date: the card is about the session the
    // athlete is standing in, not about everything that happened that day.
    const comparisons = compareToLastSession(
      [volume([{ date: "2026-09-14", assignmentId: "before", sets: [3, 3] }])],
      "today",
    );

    expect(comparisons).toEqual([]);
  });
});
