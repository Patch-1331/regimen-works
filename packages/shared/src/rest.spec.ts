import { describe, expect, it } from "vitest";
import {
  restClockSeconds,
  restPaceRequired,
  resolveRestSeconds,
} from "./rest.js";

/**
 * Whose word the rest between sets is (ADR 0005, DN-143, ADR 0011).
 *
 * Four cases in each position, because there are two sources and each can be silent. Two of
 * them run no clock, and the regression that matters is the pair that looks
 * alike: a movement prescribed "straight through" and a movement whose source
 * said nothing are different facts, and must stay different all the way down.
 */
describe("resolveRestSeconds", () => {
  for (const position of ["between_sets", "after_line"] as const) {
    describe(`${position}`, () => {
      it("uses the athlete's pace over the set's own", () => {
        expect(resolveRestSeconds(120, 60, position)).toBe(120);
      });

      it("uses the athlete's pace where the set states none", () => {
        expect(resolveRestSeconds(90, null, position)).toBe(90);
      });

      it("falls back to the set's own where the athlete set no pace", () => {
        expect(resolveRestSeconds(null, 60, position)).toBe(60);
      });

      it("resolves to nothing where neither source says anything", () => {
        expect(resolveRestSeconds(null, null, position)).toBeNull();
      });

      it("keeps a prescribed straight-through distinct from an unstated rest", () => {
        expect(resolveRestSeconds(null, 0, position)).toBe(0);
        expect(resolveRestSeconds(null, null, position)).toBeNull();
      });

      it("lets the athlete's pace be straight through, overriding a stated rest", () => {
        expect(resolveRestSeconds(0, 180, position)).toBe(0);
      });
    });
  }

  /**
   * ADR 0011, decision 4: no rest between drops is part of what a drop set is,
   * so the pace cannot put one there. Only an explicit 0, and only between
   * two sets of one line.
   */
  describe("an explicit 0 between sets of one line", () => {
    it("survives the athlete's pace", () => {
      expect(resolveRestSeconds(90, 0, "between_sets")).toBe(0);
      expect(resolveRestSeconds(0, 0, "between_sets")).toBe(0);
    });

    it("is still replaced after the line's last set, where the next movement starts", () => {
      expect(resolveRestSeconds(90, 0, "after_line")).toBe(90);
    });

    it("leaves every rest above 0 to the pace", () => {
      expect(resolveRestSeconds(90, 1, "between_sets")).toBe(90);
      expect(resolveRestSeconds(90, 180, "between_sets")).toBe(90);
    });

    it("does not make a null into a 0: an unstated rest still takes the pace, or runs no clock", () => {
      expect(resolveRestSeconds(90, null, "between_sets")).toBe(90);
      expect(resolveRestSeconds(null, null, "between_sets")).toBeNull();
    });
  });
});

describe("restClockSeconds", () => {
  it("runs a clock for a stated rest", () => {
    expect(restClockSeconds(90)).toBe(90);
  });

  it("runs none for straight through, or for no rest at all", () => {
    expect(restClockSeconds(0)).toBeNull();
    expect(restClockSeconds(null)).toBeNull();
  });
});

describe("restPaceRequired", () => {
  it("asks nothing of a program that states rest everywhere", () => {
    expect(
      restPaceRequired([{ restSeconds: 90 }, { restSeconds: 0 }]),
    ).toBe(false);
  });

  it("asks once where any movement leaves rest unstated", () => {
    expect(
      restPaceRequired([{ restSeconds: 90 }, { restSeconds: null }]),
    ).toBe(true);
  });

  it("asks nothing of a program with no straight-sets movements", () => {
    expect(restPaceRequired([])).toBe(false);
  });
});
