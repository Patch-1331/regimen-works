import { afterEach, describe, expect, it, vi } from "vitest";
import { rememberDismissed, wasDismissed } from "./movementChangeDismissal";

/**
 * Declining a movement change is a browser-local convenience, so every path here
 * has to survive storage simply not being there — a private window, cleared
 * site data, or a browser set to block it. The page must still render, and
 * the harmless direction to fail in is re-asking.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("wasDismissed", () => {
  it("is false when nothing has been dismissed", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    expect(wasDismissed("assignment-1")).toBe(false);
  });

  it("is true after a dismissal, for that assignment only", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    rememberDismissed("assignment-1");
    expect(wasDismissed("assignment-1")).toBe(true);
    // Tomorrow's session is a different question and gets asked again.
    expect(wasDismissed("assignment-2")).toBe(false);
  });

  it("reports not-dismissed rather than throwing when storage is unavailable", () => {
    vi.stubGlobal("localStorage", throwingStorage());
    expect(() => wasDismissed("assignment-1")).not.toThrow();
    expect(wasDismissed("assignment-1")).toBe(false);
  });
});

describe("rememberDismissed", () => {
  it("does not throw when storage is unavailable", () => {
    vi.stubGlobal("localStorage", throwingStorage());
    expect(() => rememberDismissed("assignment-1")).not.toThrow();
  });
});

function memoryStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
}

/** What a browser blocking site data actually does: throw on access. */
function throwingStorage() {
  return {
    getItem: () => {
      throw new Error("access denied");
    },
    setItem: () => {
      throw new Error("access denied");
    },
  };
}
