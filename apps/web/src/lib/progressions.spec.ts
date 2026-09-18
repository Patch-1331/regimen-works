import { describe, expect, it } from "vitest";
import { progressionLine, type SkillLevel } from "@regimen-works/shared";
import type { ApiExercise } from "./api";
import { buildMovementChoices, lineLabel } from "./progressions";

/**
 * What the Stats panel says about the athlete (DN-91). It replaced a ladder
 * marked done / current / locked, so what these lock in is mostly what it no
 * longer claims: every movement on the line is offered, one is marked as
 * chosen, and nothing is closed off or graduated past.
 */

function exercise(
  partial: Partial<ApiExercise> & { id: string },
): ApiExercise {
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

function skill(line: string, rung: number): SkillLevel {
  return {
    id: `sl-${line}`,
    line: line as SkillLevel["line"],
    rung,
    updatedAt: "2026-09-13T10:00:00.000Z",
  };
}

const negative = exercise({ id: "negative", name: "Negative chin-up", rung: 0 });
const chinUp = exercise({ id: "chin-up", name: "Chin-up", rung: 1 });
const pullUp = exercise({ id: "pull-up", name: "Pull-up", rung: 2 });
const airSquat = exercise({
  id: "air-squat",
  name: "Air squat",
  line: "squat",
  pattern: "squat",
  rung: 0,
});
const cardio = exercise({
  id: "row",
  name: "Row",
  pattern: "monostructural",
  line: null,
  rung: null,
});

const pullExercises = [chinUp, pullUp, negative, cardio];

describe("buildMovementChoices", () => {
  it("names the movement the athlete chose", () => {
    const [choice] = buildMovementChoices(pullExercises, [skill("pull", 1)]);
    expect(choice.chosenName).toBe("Chin-up");
  });

  it("offers the whole line in order, not just what is 'allowed'", () => {
    const [choice] = buildMovementChoices(pullExercises, [skill("pull", 1)]);
    expect(choice.options.map((o) => o.name)).toEqual([
      "Negative chin-up",
      "Chin-up",
      "Pull-up",
    ]);
    expect(choice.options.filter((o) => o.isChosen)).toHaveLength(1);
  });

  it("marks nothing as cleared or closed off — only chosen or not", () => {
    const [choice] = buildMovementChoices(pullExercises, [skill("pull", 1)]);
    // A movement below the choice and one above it are indistinguishable:
    // the panel has no third state now, which is the point of DN-91.
    const below = choice.options.find((o) => o.rung === 0)!;
    const above = choice.options.find((o) => o.rung === 2)!;
    expect(below.isChosen).toBe(false);
    expect(above.isChosen).toBe(false);
  });

  it("skips exercises off a tracked line", () => {
    const [choice] = buildMovementChoices(pullExercises, [skill("pull", 1)]);
    expect(choice.options.map((o) => o.id)).not.toContain("row");
  });

  // DN-86: nobody is provisioned onto a movement, so this is what a new
  // athlete's panel is built from.
  it("returns nothing when the athlete has chosen nothing", () => {
    expect(buildMovementChoices(pullExercises, [])).toEqual([]);
  });

  it("says nothing rather than the wrong thing when the rung has no exercise", () => {
    const [choice] = buildMovementChoices(pullExercises, [skill("pull", 9)]);
    expect(choice.chosenName).toBeNull();
    expect(choice.options).toHaveLength(3);
  });

  it("orders groups by the label the athlete reads, not the enum value", () => {
    const choices = buildMovementChoices(
      [...pullExercises, airSquat],
      [skill("squat", 0), skill("pull", 1)],
    );
    expect(choices.map((c) => lineLabel(c.line))).toEqual(["Pull", "Squat"]);
  });
});

/**
 * The gap DN-115 found while adding two lines: `exercise-seed.spec.ts` catches
 * a line the enum does not know, and nothing caught a line the *labels* do not
 * know. `lineLabel` falls through to the raw slug, so the omission ships as
 * "cardio_rope" printed at an athlete in the Stats panel rather than as a
 * failure anywhere.
 */
describe("lineLabel", () => {
  it("has a label for every line the app can store", () => {
    const unlabelled = progressionLine.options.filter(
      (line) => lineLabel(line) === line,
    );
    expect(unlabelled).toEqual([]);
  });

  it("falls through to the slug for a line it does not know", () => {
    // The fallback is deliberate — a line added to the enum and not here
    // should still render something — and the test above is what keeps it
    // from being how the app actually behaves.
    expect(lineLabel("not_a_line")).toBe("not_a_line");
  });
});
