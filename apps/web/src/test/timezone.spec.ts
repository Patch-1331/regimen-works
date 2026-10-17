import { describe, expect, it } from "vitest";

// The suite runs in America/Chicago (vite.config.ts, DN-127) so that date code
// reading local time where it means UTC fails here rather than only for
// athletes west of UTC. If the zone quietly stops applying, every timezone
// test passes for the wrong reason — so check it is actually in effect.
describe("test timezone", () => {
  it("is west of UTC", () => {
    expect(new Date("2026-01-15T12:00:00Z").getTimezoneOffset()).toBe(360);
  });

  it("observes daylight saving", () => {
    expect(new Date("2026-07-15T12:00:00Z").getTimezoneOffset()).toBe(300);
  });
});
