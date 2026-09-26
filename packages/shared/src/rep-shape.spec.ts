import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  refineRepShape,
  repShapeFields,
  repShapeKind,
  repsLabel,
  type RepShape,
} from "./rep-shape.js";

/**
 * The three shapes a prescribed count comes in (DN-142), at the edge.
 *
 * The database's CHECK is the rule -- `plan-schema.db-spec.ts` pins that --
 * and this is its mirror: what a request body or a snapshot read back from
 * jsonb is held to before it ever reaches Postgres. The two must agree, so
 * every combination refused below is one the CHECK refuses too.
 */

const schema = z.object(repShapeFields).superRefine(refineRepShape);

const shape = (overrides: Partial<RepShape> = {}): RepShape => ({
  reps: 3,
  repsMax: null,
  toFailure: false,
  ...overrides,
});

describe("the three shapes, and no fourth", () => {
  it("accepts a fixed count", () => {
    expect(schema.safeParse(shape()).success).toBe(true);
  });

  it("accepts a range", () => {
    expect(schema.safeParse(shape({ repsMax: 5 })).success).toBe(true);
  });

  it("accepts a set prescribed to failure", () => {
    expect(
      schema.safeParse(shape({ reps: null, toFailure: true })).success,
    ).toBe(true);
  });

  it("refuses a range whose top is not above its bottom", () => {
    // 8-8 is a fixed prescription written the long way, and admitting both
    // spellings would mean two rows that say the same thing.
    expect(schema.safeParse(shape({ reps: 8, repsMax: 8 })).success).toBe(
      false,
    );
    expect(schema.safeParse(shape({ reps: 8, repsMax: 5 })).success).toBe(
      false,
    );
  });

  it("refuses a top with no bottom", () => {
    expect(schema.safeParse(shape({ reps: null, repsMax: 10 })).success).toBe(
      false,
    );
  });

  it("refuses a failure set that names a count anyway", () => {
    // The combination that would let two fields disagree about what the day
    // asked for -- and leave every reader to pick which one it believed.
    expect(
      schema.safeParse(shape({ reps: 3, toFailure: true })).success,
    ).toBe(false);
    expect(
      schema.safeParse(shape({ reps: null, repsMax: 10, toFailure: true }))
        .success,
    ).toBe(false);
  });

  it("refuses no count at all", () => {
    expect(schema.safeParse(shape({ reps: null })).success).toBe(false);
  });

  it("refuses zero, which is a set nobody was asked to do", () => {
    expect(schema.safeParse(shape({ reps: 0 })).success).toBe(false);
  });
});

describe("repShapeKind", () => {
  it("names each shape from the combination that makes it", () => {
    expect(repShapeKind(shape())).toBe("fixed");
    expect(repShapeKind(shape({ repsMax: 5 }))).toBe("range");
    expect(repShapeKind(shape({ reps: null, toFailure: true }))).toBe(
      "failure",
    );
  });
});

describe("repsLabel", () => {
  it("reads a fixed count as the number", () => {
    expect(repsLabel(shape(), "reps")).toBe("3");
  });

  it("reads a range as a range, inventing neither end", () => {
    expect(repsLabel(shape({ reps: 8, repsMax: 10 }), "reps")).toBe("8-10");
  });

  it("reads a failure set as the instruction it is", () => {
    expect(repsLabel(shape({ reps: null, toFailure: true }), "reps")).toBe(
      "to failure",
    );
  });

  it("counts a hold in seconds", () => {
    expect(repsLabel(shape({ reps: 60 }), "seconds")).toBe("60s");
    expect(repsLabel(shape({ reps: 45, repsMax: 60 }), "seconds")).toBe(
      "45-60s",
    );
  });

  it("says nothing about seconds on a failure hold, which has no clock", () => {
    expect(repsLabel(shape({ reps: null, toFailure: true }), "seconds")).toBe(
      "to failure",
    );
  });
});
