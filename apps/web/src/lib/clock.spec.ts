import { describe, expect, it } from "vitest";
import { elapsedSecondsSince, formatClock } from "./clock";

describe("formatClock", () => {
  it("pads the seconds so the clock does not jump width as it ticks", () => {
    expect(formatClock(65)).toBe("1:05");
  });

  it("starts at 0:00", () => {
    expect(formatClock(0)).toBe("0:00");
  });

  it("rolls the minute over at 60 seconds, not 59", () => {
    expect(formatClock(59)).toBe("0:59");
    expect(formatClock(60)).toBe("1:00");
  });

  it("keeps counting in minutes past an hour, because no workout screen shows hours", () => {
    // A 70-minute Murph reads 70:00, not 1:10:00.
    expect(formatClock(4200)).toBe("70:00");
  });
});

describe("elapsedSecondsSince", () => {
  const STARTED_AT = "2026-09-16T10:00:00.000Z";
  const START_MS = Date.parse(STARTED_AT);

  it("counts whole seconds from the session start", () => {
    expect(elapsedSecondsSince(STARTED_AT, START_MS + 65_000)).toBe(65);
  });

  it("reads zero at the instant the session starts", () => {
    expect(elapsedSecondsSince(STARTED_AT, START_MS)).toBe(0);
  });

  it("floors a part-second rather than rounding the clock ahead of itself", () => {
    expect(elapsedSecondsSince(STARTED_AT, START_MS + 65_900)).toBe(65);
  });

  it("reads zero rather than a negative clock when the device is behind the server", () => {
    // Client clock skew would otherwise show -3:00 on a freshly started session.
    expect(elapsedSecondsSince(STARTED_AT, START_MS - 180_000)).toBe(0);
  });
});
