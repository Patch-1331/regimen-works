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
    instructions: null,
    altExerciseId: null,
    phase: null,
    ownerId: null,
    archivedAt: null,
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
const highKnees = exercise({
  id: "high-knees",
  name: "High knees",
  line: null,
  rung: null,
  pattern: "cardio",
});
// The rope movement and what it falls to: off every line, and the pair the
// equipment work made swappable (DN-80).
const doubleUnders = exercise({
  id: "double-unders",
  name: "Double-unders",
  line: null,
  rung: null,
  pattern: "cardio",
  equipment: ["jump_rope"],
  altExercise: { id: "high-knees", name: "High knees" },
});

const library = [pullUp, negative, chinUp, row, burpee, doubleUnders, highKnees];

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

  it("returns nothing for an off-ladder movement with no alternative", () => {
    // A burpee needs nothing and stands in for nothing — this is the row the
    // control really would open onto nothing for.
    expect(buildSwapOptions(library, null, "burpee")).toEqual([]);
  });

  /**
   * Off-ladder movements used to be refused a control outright, which was
   * right while equipment meant the bar. Once a WOD can name a jump rope, the
   * row with no ladder is the row most likely to need a way out (DN-80).
   */
  it("offers an off-ladder movement its alternative, labelled and last", () => {
    const options = buildSwapOptions(library, null, "double-unders");
    expect(options).toEqual([
      {
        exerciseId: "double-unders",
        name: "Double-unders",
        rung: null,
        isCurrent: true,
        isAlternative: false,
        isPrescribed: false,
      },
      {
        exerciseId: "high-knees",
        name: "High knees",
        rung: null,
        isCurrent: false,
        isAlternative: true,
        isPrescribed: false,
      },
    ]);
  });

  it("marks where the athlete is, rather than offering the alternative alone", () => {
    // One unmarked row reads as an instruction. The pair reads as a choice —
    // the same reason the ladder lists every rung instead of the next one.
    const options = buildSwapOptions(library, null, "double-unders");
    expect(options.filter((o) => o.isCurrent).map((o) => o.name)).toEqual([
      "Double-unders",
    ]);
  });

  it("offers nothing further once the athlete swapped to the alternative themselves", () => {
    // High knees stand in for the rope and need nothing themselves, so there
    // is no third movement to go to. On a row the athlete swapped, getting
    // back is revert's job — which is why no prescribed id is passed here.
    expect(buildSwapOptions(library, null, "high-knees")).toEqual([]);
  });

  /**
   * The equipment layer moves a row silently, with no substitution behind it,
   * so revert does not apply (DN-110). Without this the one movement the
   * athlete has actually acquired the gear for is the one they cannot pick.
   */
  it("offers the prescribed movement back on a row an automatic layer moved", () => {
    const options = buildSwapOptions(
      library,
      null,
      "high-knees",
      "double-unders",
    );
    expect(options).toEqual([
      {
        exerciseId: "high-knees",
        name: "High knees",
        rung: null,
        isCurrent: true,
        isAlternative: false,
        isPrescribed: false,
      },
      {
        exerciseId: "double-unders",
        name: "Double-unders",
        rung: null,
        isCurrent: false,
        isAlternative: false,
        isPrescribed: true,
      },
    ]);
  });

  it("marks the prescribed rung on the ladder rather than listing it twice", () => {
    // The remembered choice moved this row, and the movement it moved from is
    // a rung the ladder already carries. Appending it would offer the same
    // exercise on two lines of the same list.
    const options = buildSwapOptions(library, "pull", "negative", "pull-up");
    expect(options.map((o) => o.exerciseId)).toEqual([
      "negative",
      "chin-up",
      "pull-up",
    ]);
    expect(options.filter((o) => o.isPrescribed).map((o) => o.name)).toEqual([
      "Pull-up",
    ]);
  });

  it("passes over a prescribed movement the library does not hold", () => {
    // Degrades to the list as it was rather than offering a swap the API
    // would reject — the discipline every resolution layer keeps.
    expect(
      buildSwapOptions(library, null, "double-unders", "retired-exercise"),
    ).toEqual(buildSwapOptions(library, null, "double-unders"));
  });

  it("still offers nothing when the prescribed movement is the one showing", () => {
    // A control that opens onto a single row reads as an instruction, not a
    // choice. Burpees have no alternative, so there is nothing to pair it
    // with even if something upstream named one.
    expect(buildSwapOptions(library, null, "burpee", "burpee")).toEqual([]);
  });

  it("returns nothing when the line has no seeded rungs", () => {
    expect(buildSwapOptions(library, "hinge", "deadlift")).toEqual([]);
  });
});
