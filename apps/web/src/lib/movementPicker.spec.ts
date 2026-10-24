import { afterEach, describe, expect, it } from "vitest";
import * as fixtures from "../test/fixtures";
import {
  didYouMean,
  exactMatch,
  findMovements,
  highlight,
  kitAlternatives,
  kitPhrase,
  missingKit,
  recentSearches,
  rememberSearch,
  splitByKit,
  usedMost,
} from "./movementPicker";

/**
 * The picker's reckoning (DN-194): what a search finds, which of it the
 * athlete's kit can do, and what to do instead of what it can't.
 */

const library = fixtures.pickerLibrary();
const kit = fixtures.PICKER_KIT;
const byId = (id: string) => library.find((e) => e.id === id)!;
const names = (list: { name: string }[]) => list.map((e) => e.name);

describe("finding movements", () => {
  it("finds by name, and by a muscle the query names", () => {
    expect(names(findMovements("goblet", library, null))).toEqual(["Goblet Squat"]);
    expect(names(findMovements("quads", library, null))).toEqual(["Goblet Squat", "Leg Press"]);
    expect(names(findMovements("legs", library, null))).toEqual(["Goblet Squat", "Leg Press"]);
  });

  it("narrows to a muscle group, or lists the group when nothing is typed", () => {
    expect(names(findMovements("press", library, "shoulders"))).toEqual([
      "Dumbbell Shoulder Press",
      "Push Press",
    ]);
    expect(names(findMovements("", library, "back"))).toEqual(["One-arm Dumbbell Row", "Pull-up"]);
    expect(findMovements("", library, null)).toEqual([]);
  });

  it("puts what the kit can do first, keeping search order within each", () => {
    const { withKit, needsKit } = splitByKit(findMovements("bench press", library, null), kit);
    expect(names(withKit)).toContain("Dumbbell Bench Press");
    expect(names(needsKit)).toEqual(["Barbell Bench Press"]);
  });

  it("gates nothing while the kit is still loading", () => {
    expect(missingKit(byId("bb-bench"), null)).toEqual([]);
    expect(missingKit(byId("bb-bench"), kit)).toEqual(["barbell"]);
  });

  it("knows an exact match regardless of case", () => {
    expect(exactMatch("  barbell bench press ", library)?.id).toBe("bb-bench");
    expect(exactMatch("bench", library)).toBeNull();
  });
});

describe("what to do instead", () => {
  it("offers kit-ready movements on the same muscles, the closest first", () => {
    const instead = kitAlternatives(byId("bb-bench"), library, kit);
    expect(instead[0]).toMatchObject({ exercise: { id: "db-bench" }, shared: 3, of: 3 });
    expect(names(instead.map((a) => a.exercise))).toEqual([
      "Dumbbell Bench Press",
      "Band Chest Press",
      "Dumbbell Floor Press",
    ]);
  });

  it("never offers one the kit can't do", () => {
    const instead = kitAlternatives(byId("push-press"), library, kit);
    expect(names(instead.map((a) => a.exercise))).toEqual(["Dumbbell Shoulder Press", "Pike Push-up"]);
  });

  it("falls back to the movement group for a movement with no muscles on record", () => {
    const own = fixtures.apiExercise({ id: "own", name: "Sandbag squat", movementGroup: "squat" });
    expect(names(kitAlternatives(own, library, kit).map((a) => a.exercise))).toEqual([
      "Goblet Squat",
    ]);
  });
});

describe("words", () => {
  it("names the kit as a phrase", () => {
    expect(kitPhrase(["barbell"])).toBe("barbell");
    expect(kitPhrase(["barbell", "bench"])).toBe("barbell and bench");
  });

  it("suggests near names for a typo, the kit-ready ones first", () => {
    expect(names(didYouMean("dumbell row", library, kit))[0]).toBe("One-arm Dumbbell Row");
    expect(didYouMean("landmine", library, kit)).toEqual([]);
  });

  it("bolds word starts the query typed", () => {
    expect(highlight("Push Press", "pre")).toEqual([
      { text: "Push ", hit: false },
      { text: "Pre", hit: true },
      { text: "ss", hit: false },
    ]);
  });

  it("ranks the movements used most by days trained", () => {
    const session = (date: string) => ({ date, assignmentId: date, sets: [8] });
    const volume = [
      fixtures.movementVolume({ exerciseId: "goblet", sessions: [session("a")] }),
      fixtures.movementVolume({ exerciseId: "pull-up", sessions: [session("a"), session("b")] }),
      fixtures.movementVolume({ exerciseId: "gone", sessions: [session("a"), session("b"), session("c")] }),
    ];
    expect(names(usedMost(volume, library))).toEqual(["Pull-up", "Goblet Squat"]);
  });
});

describe("recent searches", () => {
  afterEach(() => localStorage.clear());

  it("keeps the last five, newest first, without repeats", () => {
    for (const q of ["a1", "b2", "c3", "d4", "e5", "f6", "C3", " "]) rememberSearch(q);
    expect(recentSearches()).toEqual(["C3", "f6", "e5", "d4", "b2"]);
  });
});
