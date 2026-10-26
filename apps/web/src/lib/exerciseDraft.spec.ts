import { describe, expect, it } from "vitest";
import * as fixtures from "../test/fixtures";
import {
  EMPTY_DRAFT,
  type ExerciseDraft,
  alternativesFor,
  problemsWith,
  suggestionRequest,
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
  primaryMuscles: ["middle_back"],
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
      instructions: [],
      movementGroup: null,
      fallbackExerciseId: null,
      primaryMuscles: ["middle_back"],
      secondaryMuscles: [],
      force: null,
      mechanic: null,
      level: null,
      category: null,
    });
  });

  it("sends the muscles in the order they were picked, prime mover first (DN-205)", () => {
    const body = toWriteBody(
      draft({ primaryMuscles: ["lats", "middle_back"], level: "beginner", category: "strength" }),
    );
    expect(body.primaryMuscles).toEqual(["lats", "middle_back"]);
    expect(body.level).toBe("beginner");
    expect(body.category).toBe("strength");
  });

  it("writes a group with no position in it (DN-183)", () => {
    const body = toWriteBody(draft({ movementGroup: "push_horizontal" }));
    expect(body.movementGroup).toBe("push_horizontal");
    expect(body).not.toHaveProperty("sortOrder");
  });

  it("trims what was typed, so a name of spaces is not a name", () => {
    const body = toWriteBody(draft({ name: "  Ring row  ", instructions: " " }));
    expect(body.name).toBe("Ring row");
    expect(body.instructions).toEqual([]);
  });

  it("sends each line as a step, without the blank ones between", () => {
    const body = toWriteBody(
      draft({ instructions: "  Hang from the bar.\n\n  Pull your chin over it.  \n" }),
    );
    expect(body.instructions).toEqual(["Hang from the bar.", "Pull your chin over it."]);
  });
});

describe("toDraft", () => {
  it("round-trips a saved movement back through the form unchanged", () => {
    const exercise = fixtures.apiExercise({
      name: "Pull-up",
      pattern: "pull",
      equipment: ["bar"],
      unit: "reps",
      instructions: ["Hang from the bar.", "Chin over the bar."],
      movementGroup: "pull_vertical",
      fallbackExerciseId: "exercise-9",
      primaryMuscles: ["lats"],
      secondaryMuscles: ["biceps"],
      force: "pull",
      mechanic: "compound",
      level: "intermediate",
      category: "strength",
    });

    expect(toWriteBody(toDraft(exercise))).toMatchObject({
      name: "Pull-up",
      pattern: "pull",
      equipment: ["bar"],
      instructions: ["Hang from the bar.", "Chin over the bar."],
      movementGroup: "pull_vertical",
      fallbackExerciseId: "exercise-9",
      primaryMuscles: ["lats"],
      secondaryMuscles: ["biceps"],
      force: "pull",
      mechanic: "compound",
      level: "intermediate",
      category: "strength",
    });
  });
});

describe("suggestionRequest (DN-205)", () => {
  it("asks nothing until there is a prime mover to match on", () => {
    expect(suggestionRequest(draft({ primaryMuscles: [] }), null)).toBeNull();
  });

  it("asks with what the match reads, and who is asking", () => {
    expect(
      suggestionRequest(draft({ equipment: ["dumbbell"], level: "beginner" }), "e-1"),
    ).toEqual({
      selfId: "e-1",
      unit: "reps",
      equipment: ["dumbbell"],
      movementGroup: null,
      primaryMuscles: ["middle_back"],
      secondaryMuscles: [],
      force: null,
      mechanic: null,
      level: "beginner",
      category: null,
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
  const loaded = fixtures.apiExercise({
    id: "g3",
    ownerId: null,
    equipment: ["dumbbell"],
  });
  const all = [global, own, retired, loaded];

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

  it("offers only bodyweight movements, which is all a save accepts (DN-205)", () => {
    expect(alternativesFor(all, "own", null).map((e) => e.id)).not.toContain("g3");
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

  it("takes a group on its own, with no position to go with it", () => {
    expect(
      problemsWith(draft({ movementGroup: "push_horizontal" }), alternatives),
    ).toEqual([]);
  });

  it("asks for the muscle it works (DN-205)", () => {
    expect(problemsWith(draft({ primaryMuscles: [] }), alternatives)).toEqual([
      "Choose the muscle it works — at least one primary muscle.",
    ]);
  });

  it("lets a movement that needs equipment go without an alternative (DN-205)", () => {
    expect(
      problemsWith(
        draft({ equipment: ["bar"], category: "strength", level: "beginner" }),
        alternatives,
      ),
    ).toEqual([]);
  });

  it("asks for what the muscle match needs when there is no alternative", () => {
    expect(
      problemsWith(draft({ equipment: ["bar"], category: "strength" }), alternatives),
    ).toEqual([
      "With no alternative chosen, give it a level so one can be found for an athlete without the equipment.",
    ]);
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
        draft({ name: "", equipment: ["bar"] }),
        alternatives,
      ),
    ).toHaveLength(2);
  });
});
