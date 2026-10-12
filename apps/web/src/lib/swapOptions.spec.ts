import { describe, expect, it } from "vitest";
import type { SwapOptionsResponse } from "@regimen-works/shared";
import * as fixtures from "../test/fixtures";
import { buildSwapRows, canSwap, offersAChoice } from "./swapOptions";

/**
 * The rows the athlete is shown. What is on offer is the API's (DN-170); what
 * these pin is the part only the plate knows — where the athlete is, and what
 * the workout named — and that it is marked rather than filtered.
 */

const option = (exerciseId: string, name: string, isFallback = false) =>
  fixtures.swapOption({ exerciseId, name, isFallback });

const sections: SwapOptionsResponse = {
  main: [option("negative", "Negative chin-up"), option("row", "Row under table", true)],
  harder: [option("pull-up", "Pull-up")],
  needsEquipment: [option("ring-row", "Ring row")],
};

const chinUp = { id: "chin-up", name: "Chin-up" };

describe("buildSwapRows", () => {
  it("keeps the API's sections and their order", () => {
    const rows = buildSwapRows(sections, chinUp, null);
    expect(rows.harder.map((r) => r.name)).toEqual(["Pull-up"]);
    expect(rows.needsEquipment.map((r) => r.name)).toEqual(["Ring row"]);
  });

  it("puts the movement the athlete is on at the head of the list, marked", () => {
    // The API never offers a movement for itself, so it is not in any
    // section. Seeing where you are is half of what makes the choice.
    const rows = buildSwapRows(sections, chinUp, null);
    expect(rows.main.map((r) => r.name)).toEqual([
      "Chin-up",
      "Negative chin-up",
      "Row under table",
    ]);
    expect(rows.main.filter((r) => r.isCurrent).map((r) => r.name)).toEqual(["Chin-up"]);
  });

  it("marks the current movement in place where a section holds it", () => {
    // After a swap the athlete holds a row the API offers for the anchor.
    const rows = buildSwapRows(sections, { id: "pull-up", name: "Pull-up" }, null);
    expect(rows.harder).toEqual([expect.objectContaining({ name: "Pull-up", isCurrent: true })]);
    expect(rows.main.map((r) => r.name)).not.toContain("Pull-up");
  });

  it("labels the written alternative", () => {
    const rows = buildSwapRows(sections, chinUp, null);
    expect(rows.main.filter((r) => r.isAlternative).map((r) => r.name)).toEqual([
      "Row under table",
    ]);
  });

  it("offers the prescribed movement back after the current one (DN-110)", () => {
    const rows = buildSwapRows(sections, { id: "row", name: "Row under table" }, chinUp);
    expect(rows.main.map((r) => r.name)).toEqual([
      "Chin-up",
      "Negative chin-up",
      "Row under table",
    ]);
    expect(rows.main[0]).toMatchObject({ isPrescribed: true, isCurrent: false });
  });

  it("marks the prescribed movement where a section already lists it, once", () => {
    const rows = buildSwapRows(sections, chinUp, { id: "pull-up", name: "Pull-up" });
    const all = [...rows.main, ...rows.harder, ...rows.needsEquipment];
    expect(all.filter((r) => r.exerciseId === "pull-up")).toEqual([
      expect.objectContaining({ isPrescribed: true }),
    ]);
  });
});

describe("offersAChoice", () => {
  it("reads a lone marked row as nothing to choose", () => {
    const empty = { main: [], harder: [], needsEquipment: [] };
    expect(offersAChoice(buildSwapRows(empty, chinUp, null))).toBe(false);
  });

  it("counts a row in any section", () => {
    const kitOnly = { main: [], harder: [], needsEquipment: [option("ring-row", "Ring row")] };
    expect(offersAChoice(buildSwapRows(kitOnly, chinUp, null))).toBe(true);
  });
});

describe("canSwap", () => {
  const bare = { primaryMuscles: [], movementGroup: null, fallbackExerciseId: null };
  const asPrescribed = { isSwapped: false, prescribedId: null };

  it("withholds the control from a movement with nothing to match on", () => {
    expect(canSwap(bare, asPrescribed)).toBe(false);
  });

  it.each([
    ["muscles", { ...bare, primaryMuscles: ["lats"] }],
    ["a group", { ...bare, movementGroup: "pull" }],
    ["a written alternative", { ...bare, fallbackExerciseId: "row" }],
  ])("offers it on a movement with %s", (_, exercise) => {
    expect(canSwap(exercise, asPrescribed)).toBe(true);
  });

  it("keeps it on a row something moved, so there is a way back", () => {
    expect(canSwap(bare, { isSwapped: true, prescribedId: null })).toBe(true);
    expect(canSwap(bare, { isSwapped: false, prescribedId: "chin-up" })).toBe(true);
  });
});
