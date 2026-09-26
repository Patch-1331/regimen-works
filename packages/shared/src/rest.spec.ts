import { describe, expect, it } from "vitest";
import {
  restClockSeconds,
  restPaceRequired,
  resolveRestSeconds,
} from "./rest.js";

/**
 * Whose word the rest between sets is (ADR 0005, DN-143).
 *
 * Four cases, because there are two sources and each can be silent. Two of
 * them run no clock, and the regression that matters is the pair that looks
 * alike: a movement prescribed "straight through" and a movement whose source
 * said nothing are different facts, and must stay different all the way down.
 */
describe("resolveRestSeconds", () => {
  it("uses the athlete's pace over the movement's own", () => {
    expect(resolveRestSeconds(120, 60)).toBe(120);
  });

  it("uses the athlete's pace where the movement states none", () => {
    expect(resolveRestSeconds(90, null)).toBe(90);
  });

  it("falls back to the movement's own where the athlete set no pace", () => {
    expect(resolveRestSeconds(null, 60)).toBe(60);
  });

  it("resolves to nothing where neither source says anything", () => {
    expect(resolveRestSeconds(null, null)).toBeNull();
  });

  it("keeps a prescribed straight-through distinct from an unstated rest", () => {
    expect(resolveRestSeconds(null, 0)).toBe(0);
    expect(resolveRestSeconds(null, null)).toBeNull();
  });

  it("lets the athlete's pace be straight through, overriding a stated rest", () => {
    expect(resolveRestSeconds(0, 180)).toBe(0);
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
  it("asks nothing of a routine that states rest everywhere", () => {
    expect(
      restPaceRequired([{ restSeconds: 90 }, { restSeconds: 0 }]),
    ).toBe(false);
  });

  it("asks once where any movement leaves rest unstated", () => {
    expect(
      restPaceRequired([{ restSeconds: 90 }, { restSeconds: null }]),
    ).toBe(true);
  });

  it("asks nothing of a routine with no straight-sets movements", () => {
    expect(restPaceRequired([])).toBe(false);
  });
});
