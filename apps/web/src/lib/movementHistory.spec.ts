import { describe, expect, it } from "vitest";
import type { MovementHistory } from "@regimen-works/shared";
import { buildLineRuns, describeLineHistory } from "./movementHistory";

/**
 * What the Stats panel says has been happening (DN-96).
 *
 * The panel above this says what the athlete has chosen. This says what they
 * have trained — and says it as a report, never as a verdict: no target, no
 * streak, nothing about whether it was enough. The ladder this replaced made
 * all three of those claims, which is why it went.
 */

function movement(
  overrides: Partial<Omit<MovementHistory, "days">> & {
    days?: string[];
  } = {},
): MovementHistory {
  const dates = overrides.days ?? ["2026-09-14"];
  return {
    exerciseId: "chin-up",
    name: "Chin-up",
    movementGroup: "pull",
    unit: "reps",
    sessions: dates.length,
    total: dates.length * 30,
    firstTrained: dates.at(-1)!,
    lastTrained: dates[0],
    ...overrides,
    days: dates.map((date) => ({
      date,
      name: "Cindy",
      reps: 30,
      repsMax: null,
      toFailure: false,
      isSwapped: false,
      prescribedName: null,
      prescribedReason: null,
    })),
  };
}

describe("buildLineRuns", () => {
  it("says nothing about a movementGroup that has never been trained", () => {
    expect(buildLineRuns([], "pull")).toEqual([]);
  });

  it("gathers a run of days on one movement", () => {
    const runs = buildLineRuns(
      [movement({ days: ["2026-09-14", "2026-09-10", "2026-09-05"] })],
      "pull",
    );

    expect(runs).toEqual([
      {
        exerciseId: "chin-up",
        name: "Chin-up",
        sessions: 3,
        from: "2026-09-05",
        to: "2026-09-14",
      },
    ]);
  });

  it("breaks a run where the movement changed, newest run first", () => {
    // The narrative this exists for: chin-ups lately, negatives before that.
    const runs = buildLineRuns(
      [
        movement({ days: ["2026-09-14", "2026-09-10"] }),
        movement({
          exerciseId: "negative",
          name: "Negative chin-up",
          days: ["2026-08-20", "2026-08-15"],
        }),
      ],
      "pull",
    );

    expect(runs.map((r) => [r.name, r.sessions])).toEqual([
      ["Chin-up", 2],
      ["Negative chin-up", 2],
    ]);
  });

  it("keeps a return to an earlier movement as its own run", () => {
    // They went back to negatives for a fortnight and then forward again. Two
    // runs of chin-ups is what happened; merging them would say otherwise.
    const runs = buildLineRuns(
      [
        movement({ days: ["2026-09-14", "2026-08-01"] }),
        movement({
          exerciseId: "negative",
          name: "Negative chin-up",
          days: ["2026-08-20"],
        }),
      ],
      "pull",
    );

    expect(runs.map((r) => r.name)).toEqual([
      "Chin-up",
      "Negative chin-up",
      "Chin-up",
    ]);
  });

  it("leaves other lines out of it", () => {
    const runs = buildLineRuns(
      [
        movement(),
        movement({ exerciseId: "air-squat", name: "Air squat", movementGroup: "squat" }),
      ],
      "pull",
    );

    expect(runs.map((r) => r.name)).toEqual(["Chin-up"]);
  });

  it("ignores movements that sit off every movementGroup", () => {
    // Burpees and the loaded movements carry no line, so no card claims them.
    const runs = buildLineRuns(
      [movement({ exerciseId: "burpee", name: "Burpee", movementGroup: null })],
      "pull",
    );

    expect(runs).toEqual([]);
  });
});

describe("describeLineHistory", () => {
  it("says nothing at all about a movementGroup never trained", () => {
    // Not "0 sessions": a count of nothing reads as a mark against someone for
    // a movement group they may simply not have met yet.
    expect(describeLineHistory([])).toBeNull();
  });

  it("names the movement and how long it has been the one", () => {
    const summary = describeLineHistory(
      buildLineRuns([movement({ days: ["2026-09-14", "2026-09-05"] })], "pull"),
    );

    expect(summary).toContain("Chin-up");
    expect(summary).toContain("2×");
    expect(summary).toContain("since");
  });

  it("names a single session as the day it happened", () => {
    // "1× since 14 Sep" would imply a stretch that is one day long.
    const summary = describeLineHistory(buildLineRuns([movement()], "pull"));

    expect(summary).toMatch(/^Chin-up on /);
    expect(summary).not.toContain("since");
  });

  it("adds what came before it, and only the one before", () => {
    const summary = describeLineHistory(
      buildLineRuns(
        [
          movement({ days: ["2026-09-14"] }),
          movement({
            exerciseId: "negative",
            name: "Negative chin-up",
            days: ["2026-08-20"],
          }),
          movement({
            exerciseId: "ring-row",
            name: "Ring row",
            days: ["2026-07-01"],
          }),
        ],
        "pull",
      ),
    );

    expect(summary).toContain("Negative chin-up before that");
    expect(summary).not.toContain("Ring row");
  });
});
