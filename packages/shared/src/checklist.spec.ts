import { describe, expect, it } from "vitest";
import {
  createChecklistEntrySchema,
  reorderChecklistEntriesSchema,
} from "./checklist.js";

describe("createChecklistEntrySchema", () => {
  it("takes an exercise, a list and the day it is for", () => {
    expect(
      createChecklistEntrySchema.parse({
        exerciseId: "ex-1",
        kind: "warmup",
        pattern: "squat",
      }),
    ).toEqual({ exerciseId: "ex-1", kind: "warmup", pattern: "squat" });
  });

  it("takes a null pattern as filler for any day", () => {
    expect(
      createChecklistEntrySchema.safeParse({
        exerciseId: "ex-1",
        kind: "cooldown",
        pattern: null,
      }).success,
    ).toBe(true);
  });

  it("refuses a list that is not a checklist", () => {
    expect(
      createChecklistEntrySchema.safeParse({
        exerciseId: "ex-1",
        kind: "workout",
        pattern: null,
      }).success,
    ).toBe(false);
  });

  it("refuses a pattern the scheduler has no day for", () => {
    expect(
      createChecklistEntrySchema.safeParse({
        exerciseId: "ex-1",
        kind: "warmup",
        pattern: "mobility",
      }).success,
    ).toBe(false);
  });

  it("drops an owner from the body rather than writing it", () => {
    // The tier is the route's, never the request's (DN-26).
    const parsed = createChecklistEntrySchema.parse({
      exerciseId: "ex-1",
      kind: "warmup",
      pattern: null,
      ownerId: "someone-else",
    });
    expect(parsed).not.toHaveProperty("ownerId");
  });
});

describe("reorderChecklistEntriesSchema", () => {
  it("takes a list and its entries in their new order", () => {
    expect(
      reorderChecklistEntriesSchema.safeParse({
        kind: "warmup",
        entryIds: ["b", "a"],
      }).success,
    ).toBe(true);
  });

  it("refuses an entry named twice", () => {
    expect(
      reorderChecklistEntriesSchema.safeParse({
        kind: "warmup",
        entryIds: ["a", "a"],
      }).success,
    ).toBe(false);
  });
});
