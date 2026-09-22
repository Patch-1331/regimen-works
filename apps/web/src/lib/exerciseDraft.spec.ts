import { describe, expect, it } from "vitest";
import * as fixtures from "../test/fixtures";
import {
  EMPTY_DRAFT,
  type ExerciseDraft,
  alternativesFor,
  problemsWith,
  toDraft,
  toWriteBody,
} from "./exerciseDraft";

/**
 * The library form's rules, away from the form (DN-28).
 *
 * These are the same rules `ExercisesService.assertCoherent` enforces, said
 * before the request rather than after it. They are tested here rather than
 * only through the screen because each is a claim about a shape, and a claim
 * about a shape does not need a DOM to be wrong.
 */

const draft = (overrides: Partial<ExerciseDraft> = {}): ExerciseDraft => ({
  ...EMPTY_DRAFT,
  name: "Ring row",
  ...overrides,
});

describe("toWriteBody", () => {
  it("sends null rather than empty string for every field that has none", () => {
    expect(toWriteBody(draft())).toEqual({
      name: "Ring row",
      pattern: null,
      equipment: [],
      scalable: false,
      unit: "reps",
      instructions: null,
      movementGroup: null,
      rung: null,
      fallbackExerciseId: null,
      phase: null,
    });
  });

  it("keeps rung 0 and does not invent one from an empty box", () => {
    // The whole reason the draft holds `rung` as a string: `Number("")` is 0,
    // and rung 0 is the a real position in a group.
    expect(toWriteBody(draft({ movementGroup: "push_horizontal", rung: "0" })).rung).toBe(
      0,
    );
    expect(toWriteBody(draft({ rung: "" })).rung).toBeNull();
  });

  it("trims what was typed, so a name of spaces is not a name", () => {
    const body = toWriteBody(draft({ name: "  Ring row  ", instructions: " " }));
    expect(body.name).toBe("Ring row");
    expect(body.instructions).toBeNull();
  });
});

describe("toDraft", () => {
  it("round-trips a saved movement back through the form unchanged", () => {
    const exercise = fixtures.apiExercise({
      name: "Pull-up",
      pattern: "pull",
      equipment: ["bar"],
      unit: "reps",
      instructions: "Chin over the bar.",
      movementGroup: "pull_vertical",
      rung: 3,
      fallbackExerciseId: "exercise-9",
      phase: "warmup",
    });

    expect(toWriteBody(toDraft(exercise))).toMatchObject({
      name: "Pull-up",
      pattern: "pull",
      equipment: ["bar"],
      instructions: "Chin over the bar.",
      movementGroup: "pull_vertical",
      rung: 3,
      fallbackExerciseId: "exercise-9",
      phase: "warmup",
    });
  });
});

describe("alternativesFor", () => {
  const global = fixtures.apiExercise({ id: "g1", ownerId: null });
  const own = fixtures.apiExercise({ id: "o1", ownerId: "user_alice" });
  const retired = fixtures.apiExercise({
    id: "g2",
    ownerId: null,
    archivedAt: "2026-09-18T00:00:00.000Z",
  });
  const all = [global, own, retired];

  it("offers an athlete both tiers", () => {
    expect(alternativesFor(all, "own", null).map((e) => e.id)).toEqual([
      "g1",
      "o1",
    ]);
  });

  it("offers a global movement only other global ones", () => {
    // Global content pointing at one athlete's own would be a fallback nobody
    // else can reach — the API refuses it, so it is not offered.
    expect(alternativesFor(all, "global", null).map((e) => e.id)).toEqual([
      "g1",
    ]);
  });

  it("never offers a retired movement or the movement itself", () => {
    expect(alternativesFor(all, "own", "g1").map((e) => e.id)).toEqual(["o1"]);
  });
});

describe("problemsWith", () => {
  const barbellRow = fixtures.apiExercise({
    id: "fallback-bar",
    name: "Barbell row",
    equipment: ["bar"],
  });
  const ringRow = fixtures.apiExercise({ id: "fallback-ring", name: "Ring row" });
  const plank = fixtures.apiExercise({
    id: "fallback-plank",
    name: "Plank",
    unit: "seconds",
  });
  const alternatives = [barbellRow, ringRow, plank];

  it("passes a plain bodyweight movement", () => {
    expect(problemsWith(draft(), alternatives)).toEqual([]);
  });

  it("asks for a name", () => {
    expect(problemsWith(draft({ name: "   " }), alternatives)).toEqual([
      "A movement needs a name.",
    ]);
  });

  it("refuses half a group position, in either direction", () => {
    expect(
      problemsWith(draft({ movementGroup: "push_horizontal" }), alternatives).join(),
    ).toMatch(/both the movementGroup and the rung/);
    expect(problemsWith(draft({ rung: "2" }), alternatives).join()).toMatch(
      /both the movementGroup and the rung/,
    );
    expect(
      problemsWith(
        draft({ movementGroup: "push_horizontal", rung: "2" }),
        alternatives,
      ),
    ).toEqual([]);
  });

  it("makes a movement that needs equipment name a fallback", () => {
    expect(
      problemsWith(draft({ equipment: ["bar"] }), alternatives).join(),
    ).toMatch(/has to name an alternative/);
  });

  it("refuses a fallback that needs equipment of its own", () => {
    // One step, not a chain: the athlete without a bar is given the
    // alternative and that is the end of it.
    expect(
      problemsWith(
        draft({ equipment: ["bar"], fallbackExerciseId: "fallback-bar" }),
        alternatives,
      ).join(),
    ).toMatch(/needs equipment of its own/);
  });

  it("refuses a fallback counted in the other unit", () => {
    expect(
      problemsWith(
        draft({ equipment: ["bar"], fallbackExerciseId: "fallback-plank" }),
        alternatives,
      ).join(),
    ).toMatch(/counted in seconds/);
  });

  it("accepts the whole coherent thing", () => {
    expect(
      problemsWith(
        draft({ equipment: ["bar"], fallbackExerciseId: "fallback-ring" }),
        alternatives,
      ),
    ).toEqual([]);
  });

  it("names an alternative that is no longer offered", () => {
    // The list moved under the form: someone retired it in another tab.
    expect(
      problemsWith(draft({ fallbackExerciseId: "gone" }), alternatives).join(),
    ).toMatch(/no longer one this movement can point at/);
  });

  it("reports every problem at once rather than one at a time", () => {
    expect(
      problemsWith(
        draft({ name: "", equipment: ["bar"], movementGroup: "push_horizontal" }),
        alternatives,
      ),
    ).toHaveLength(3);
  });
});
