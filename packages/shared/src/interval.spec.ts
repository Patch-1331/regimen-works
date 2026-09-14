import { describe, expect, it } from "vitest";
import { resolveIntervalConfig, totalIntervalSeconds } from "./interval.js";
import type { WodType } from "./enums.js";

/**
 * The fallbacks are the point of `resolveIntervalConfig`: the interval
 * columns were added after the WOD library was seeded, so an EMOM row that
 * only says "emom, 12 minutes" still has to produce a runnable structure.
 * A wrong fallback does not throw — it runs the athlete through the wrong
 * number of intervals.
 */

function intervalWod(overrides: Partial<Parameters<typeof resolveIntervalConfig>[0]> = {}) {
  return {
    type: "emom" as WodType,
    timeCapMinutes: 12,
    rounds: null,
    workSeconds: null,
    restSeconds: null,
    intervalCount: null,
    ...overrides,
  };
}

/**
 * `resolveIntervalConfig` narrowed to the two interval formats, where it never
 * returns null — so a test about the fallbacks can read a field off it.
 */
function resolved(overrides: Parameters<typeof intervalWod>[0] = {}) {
  const config = resolveIntervalConfig(intervalWod(overrides));
  if (!config) throw new Error("expected an interval config for an interval format");
  return config;
}

describe("resolveIntervalConfig", () => {
  it("has no interval structure for an AMRAP", () => {
    expect(resolveIntervalConfig(intervalWod({ type: "amrap" }))).toBeNull();
  });

  it("has no interval structure for a For Time WOD", () => {
    expect(resolveIntervalConfig(intervalWod({ type: "for_time" }))).toBeNull();
  });

  it("uses the WOD's own structure when it has one", () => {
    const config = resolveIntervalConfig(
      intervalWod({ type: "emom", workSeconds: 45, restSeconds: 15, intervalCount: 10 }),
    );
    expect(config).toEqual({ workSeconds: 45, restSeconds: 15, intervalCount: 10 });
  });

  describe("EMOM fallbacks", () => {
    it("runs a minute on the minute when nothing is set", () => {
      // "every minute on the minute" is the definition, not a default anyone chose.
      expect(resolveIntervalConfig(intervalWod({ type: "emom" }))).toEqual({
        workSeconds: 60,
        restSeconds: 0,
        intervalCount: 12,
      });
    });

    it("counts intervals off the time cap when neither count nor rounds is set", () => {
      // A 12-minute EMOM is twelve intervals.
      expect(resolved({ timeCapMinutes: 20 }).intervalCount).toBe(20);
    });

    it("prefers the WOD's rounds to the time cap", () => {
      expect(resolved({ rounds: 8 }).intervalCount).toBe(8);
    });

    it("prefers an explicit interval count to both", () => {
      expect(
        resolved({ rounds: 8, intervalCount: 15 }).intervalCount,
      ).toBe(15);
    });

    it("keeps a zero rest rather than reading it as unset", () => {
      // 0 is EMOM's real answer, and `??` must not fall through it.
      const config = resolveIntervalConfig(intervalWod({ workSeconds: 40, restSeconds: 0 }));
      expect(config).toEqual({ workSeconds: 40, restSeconds: 0, intervalCount: 12 });
    });
  });

  describe("Tabata fallbacks", () => {
    it("runs the classic 20/10 × 8 when nothing is set", () => {
      expect(resolveIntervalConfig(intervalWod({ type: "tabata" }))).toEqual({
        workSeconds: 20,
        restSeconds: 10,
        intervalCount: 8,
      });
    });

    it("falls back to eight intervals rather than the time cap", () => {
      // Unlike EMOM, a Tabata's cap says nothing about how many rounds it is.
      expect(
        resolved({ type: "tabata", timeCapMinutes: 20 }).intervalCount,
      ).toBe(8);
    });

    it("prefers the WOD's rounds to the classic count", () => {
      expect(
        resolved({ type: "tabata", rounds: 6 }).intervalCount,
      ).toBe(6);
    });
  });
});

describe("totalIntervalSeconds", () => {
  it("counts the rest as part of the sequence", () => {
    expect(totalIntervalSeconds({ workSeconds: 20, restSeconds: 10, intervalCount: 8 })).toBe(240);
  });

  it("is the work alone when there is no rest", () => {
    expect(totalIntervalSeconds({ workSeconds: 60, restSeconds: 0, intervalCount: 12 })).toBe(720);
  });
});
