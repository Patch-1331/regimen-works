import { describe, expect, it } from "vitest";
import { movementGroup, type SkillLevel } from "@regimen-works/shared";
import type { ApiExercise } from "./api";
import { buildMovementChoices, lineLabel } from "./progressions";

/**
 * What the Stats panel says about the athlete (DN-91). It replaced a ladder
 * marked done / current / locked, so what these lock in is mostly what it no
 * longer claims: every movement on the group is offered, one is marked as
 * chosen, and nothing is closed off or graduated past.
 */

function exercise(partial: Partial<ApiExercise> & { id: string }): ApiExercise {
  return {
    name: partial.id,
    pattern: "pull",
    equipment: [],
    scalable: true,
    unit: "reps",
    movementGroup: "pull",
    sortOrder: 0,
    instructions: null,
    fallbackExerciseId: null,
    phase: null,
    ownerId: null,
    archivedAt: null,
    fallbackExercise: null,
    ...partial,
  };
}

function skill(
  movementGroup: string,
  chosen: { id: string; name: string },
): SkillLevel {
  return {
    id: `sl-${movementGroup}`,
    movementGroup: movementGroup as SkillLevel["movementGroup"],
    exerciseId: chosen.id,
    exerciseName: chosen.name,
    updatedAt: "2026-09-13T10:00:00.000Z",
  };
}

const negative = exercise({
  id: "negative",
  name: "Negative chin-up",
  sortOrder: 0,
});
const chinUp = exercise({ id: "chin-up", name: "Chin-up", sortOrder: 1 });
const pullUp = exercise({ id: "pull-up", name: "Pull-up", sortOrder: 2 });
const airSquat = exercise({
  id: "air-squat",
  name: "Air squat",
  movementGroup: "squat",
  pattern: "squat",
  sortOrder: 0,
});
const cardio = exercise({
  id: "row",
  name: "Row",
  pattern: "monostructural",
  movementGroup: null,
  sortOrder: null,
});

const pullExercises = [chinUp, pullUp, negative, cardio];

describe("buildMovementChoices", () => {
  it("names the movement the athlete chose", () => {
    const [choice] = buildMovementChoices(pullExercises, [
      skill("pull", chinUp),
    ]);
    expect(choice.chosenName).toBe("Chin-up");
  });

  it("offers the whole movementGroup in order, not just what is 'allowed'", () => {
    const [choice] = buildMovementChoices(pullExercises, [
      skill("pull", chinUp),
    ]);
    expect(choice.options.map((o) => o.name)).toEqual([
      "Negative chin-up",
      "Chin-up",
      "Pull-up",
    ]);
    expect(choice.options.filter((o) => o.isChosen)).toHaveLength(1);
  });

  it("marks nothing as cleared or closed off — only chosen or not", () => {
    const [choice] = buildMovementChoices(pullExercises, [
      skill("pull", chinUp),
    ]);
    // A movement below the choice and one above it are indistinguishable:
    // the panel has no third state now, which is the point of DN-91.
    const below = choice.options.find((o) => o.sortOrder === 0)!;
    const above = choice.options.find((o) => o.sortOrder === 2)!;
    expect(below.isChosen).toBe(false);
    expect(above.isChosen).toBe(false);
  });

  it("skips exercises off a tracked movementGroup", () => {
    const [choice] = buildMovementChoices(pullExercises, [
      skill("pull", chinUp),
    ]);
    expect(choice.options.map((o) => o.id)).not.toContain("row");
  });

  // DN-86: nobody is provisioned onto a movement, so this is what a new
  // athlete's panel is built from.
  it("returns nothing when the athlete has chosen nothing", () => {
    expect(buildMovementChoices(pullExercises, [])).toEqual([]);
  });

  it("says nothing rather than the wrong thing when the choice is not in the library", () => {
    // An archived movement, or one that was deleted: `libraryVisibleTo` has
    // filtered it out, so the panel has a choice it cannot draw a tick for.
    const [choice] = buildMovementChoices(pullExercises, [
      skill("pull", { id: "retired", name: "Retired" }),
    ]);
    expect(choice.chosenName).toBeNull();
    expect(choice.options).toHaveLength(3);
  });

  it("orders groups by the label the athlete reads, not the enum value", () => {
    const choices = buildMovementChoices(
      [...pullExercises, airSquat],
      [skill("squat", airSquat), skill("pull", chinUp)],
    );
    expect(choices.map((c) => lineLabel(c.movementGroup))).toEqual([
      "Pull",
      "Squat",
    ]);
  });
});

/**
 * The gap DN-115 found while adding two lines: `exercise-seed.spec.ts` catches
 * a group the enum does not know, and nothing caught a group the *labels* do not
 * know. `lineLabel` falls through to the raw slug, so the omission ships as
 * "cardio_rope" printed at an athlete in the Stats panel rather than as a
 * failure anywhere.
 */
describe("lineLabel", () => {
  it("has a label for every movementGroup the app can store", () => {
    const unlabelled = movementGroup.options.filter(
      (movementGroup) => lineLabel(movementGroup) === movementGroup,
    );
    expect(unlabelled).toEqual([]);
  });

  it("falls through to the slug for a movementGroup it does not know", () => {
    // The fallback is deliberate — a group added to the enum and not here
    // should still render something — and the test above is what keeps it
    // from being how the app actually behaves.
    expect(lineLabel("not_a_line")).toBe("not_a_line");
  });
});
