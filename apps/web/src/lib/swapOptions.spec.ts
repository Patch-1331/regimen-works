import { describe, expect, it } from "vitest";
import type { ApiExercise } from "./api";
import { buildSwapOptions } from "./swapOptions";

/**
 * The ladder the athlete is shown. It has to be the whole line in order —
 * marking where they are rather than filtering to what's "allowed" — because
 * the app no longer holds an opinion about their level, and seeing the line
 * is half of what makes the choice meaningful.
 */

function exercise(partial: Partial<ApiExercise> & { id: string }): ApiExercise {
  return {
    name: partial.id,
    pattern: "pull",
    equipment: [],
    scalable: true,
    unit: "reps",
    line: "pull",
    rung: 0,
    altExercise: null,
    ...partial,
  };
}

const negative = exercise({ id: "negative", name: "Negative chin-up", rung: 0 });
const chinUp = exercise({
  id: "chin-up",
  name: "Chin-up",
  rung: 1,
  altExercise: { id: "row", name: "Row under table" },
});
const pullUp = exercise({ id: "pull-up", name: "Pull-up", rung: 2 });
const row = exercise({ id: "row", name: "Row under table", line: null, rung: null });
const burpee = exercise({ id: "burpee", name: "Burpee", line: null, rung: null, pattern: "cardio" });

const library = [pullUp, negative, chinUp, row, burpee];

describe("buildSwapOptions", () => {
  it("lists the line's rungs in order, whatever order the library came in", () => {
    const options = buildSwapOptions(library, "pull", "negative");
    expect(options.map((o) => o.name)).toEqual([
      "Negative chin-up",
      "Chin-up",
      "Pull-up",
    ]);
  });

  it("marks the rung the athlete is on rather than filtering the rest away", () => {
    const options = buildSwapOptions(library, "pull", "chin-up");
    expect(options.filter((o) => o.isCurrent).map((o) => o.name)).toEqual([
      "Chin-up",
    ]);
    // Every rung stays on the list — plus chin-up's alternative, which is
    // what makes this four rather than three.
    expect(options.filter((o) => !o.isAlternative)).toHaveLength(3);
  });

  it("offers the current exercise's no-equipment alternative, last and labelled", () => {
    const options = buildSwapOptions(library, "pull", "chin-up");
    // Not appended here — `row` is off the ladder, so it only appears via the
    // current exercise's altExercise.
    expect(options.at(-1)).toMatchObject({
      exerciseId: "row",
      name: "Row under table",
      rung: null,
      isAlternative: true,
    });
  });

  it("omits the alternative when the current rung has none", () => {
    const options = buildSwapOptions(library, "pull", "pull-up");
    expect(options.some((o) => o.isAlternative)).toBe(false);
  });

  it("never repeats an alternative that is already a rung on the line", () => {
    const withRowAsRung = [
      exercise({ id: "row", name: "Row under table", rung: 0 }),
      exercise({
        id: "chin-up",
        name: "Chin-up",
        rung: 1,
        altExercise: { id: "row", name: "Row under table" },
      }),
    ];
    const options = buildSwapOptions(withRowAsRung, "pull", "chin-up");
    expect(options.map((o) => o.exerciseId)).toEqual(["row", "chin-up"]);
  });

  it("returns nothing for a movement that is not on a tracked line", () => {
    expect(buildSwapOptions(library, null, "burpee")).toEqual([]);
  });

  it("returns nothing when the line has no seeded rungs", () => {
    expect(buildSwapOptions(library, "hinge", "deadlift")).toEqual([]);
  });
});
