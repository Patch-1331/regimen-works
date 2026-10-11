import { describe, expect, it } from "vitest";
import {
  exerciseCategory,
  exerciseForce,
  exerciseLevel,
  exerciseMechanic,
  muscle,
} from "./enums.js";

/**
 * The dataset's vocabulary, as the library stores it (DN-165, ADR-0007).
 *
 * These lists are not ours to invent: the import maps free-exercise-db's words
 * onto them, and a value missing here is an exercise the import cannot store.
 * So the tests pin each list whole rather than spot-checking a member.
 */

describe("muscle", () => {
  it("holds the dataset's seventeen muscles, in this file's snake_case", () => {
    expect([...muscle.options].sort()).toEqual([
      "abdominals",
      "abductors",
      "adductors",
      "biceps",
      "calves",
      "chest",
      "forearms",
      "glutes",
      "hamstrings",
      "lats",
      "lower_back",
      "middle_back",
      "neck",
      "quadriceps",
      "shoulders",
      "traps",
      "triceps",
    ]);
  });

  it("refuses the dataset's spaced spelling, which the import maps", () => {
    expect(muscle.safeParse("middle back").success).toBe(false);
  });
});

describe("exerciseForce / exerciseMechanic", () => {
  it("hold the dataset's values", () => {
    expect(exerciseForce.options).toEqual(["push", "pull", "static"]);
    expect(exerciseMechanic.options).toEqual(["compound", "isolation"]);
  });
});

describe("exerciseLevel", () => {
  it("holds three levels, which describe exercises and nothing else", () => {
    expect(exerciseLevel.options).toEqual(["beginner", "intermediate", "expert"]);
  });
});

describe("exerciseCategory", () => {
  it("holds the dataset's categories, less strongman", () => {
    expect(exerciseCategory.options).toEqual([
      "strength",
      "stretching",
      "plyometrics",
      "cardio",
      "powerlifting",
      "olympic_weightlifting",
    ]);
  });

  it("refuses strongman, left out with its kit (ADR-0007 decision 9)", () => {
    expect(exerciseCategory.safeParse("strongman").success).toBe(false);
  });
});
