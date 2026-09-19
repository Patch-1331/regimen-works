import { describe, expect, it } from "vitest";
import { capStateAt, finishSecondsAt, wasCappedFinish } from "./cap.js";

// A 12-minute cap, the shortest in the seeded library.
const CAP = 12 * 60;

describe("capStateAt", () => {
  it("reads the elapsed time while the cap still has road left", () => {
    expect(capStateAt(305, CAP)).toEqual({
      elapsedSeconds: 305,
      clockSeconds: 305,
      secondsRemaining: 415,
      isCapped: false,
    });
  });

  it("stops the clock at the cap instead of counting past it", () => {
    // A phone locked for five minutes past the cap comes back to the cap, not
    // to 17:00 — the workout ended when the clock did.
    expect(capStateAt(CAP + 300, CAP)).toEqual({
      elapsedSeconds: CAP + 300,
      clockSeconds: CAP,
      secondsRemaining: 0,
      isCapped: true,
    });
  });

  it("caps on the cap second itself, not the one after", () => {
    expect(capStateAt(CAP - 1, CAP).isCapped).toBe(false);
    expect(capStateAt(CAP, CAP).isCapped).toBe(true);
  });

  it("floors a part-second and never runs backwards", () => {
    expect(capStateAt(9.8, CAP).clockSeconds).toBe(9);
    // A clock skewed the wrong way would otherwise read a negative time.
    expect(capStateAt(-4, CAP).clockSeconds).toBe(0);
  });
});

describe("finishSecondsAt", () => {
  it("records the tap's own time when it lands inside the cap", () => {
    expect(finishSecondsAt(487, CAP)).toBe(487);
  });

  it("records the cap for a tap that lands after it", () => {
    expect(finishSecondsAt(CAP + 90, CAP)).toBe(CAP);
  });
});

describe("wasCappedFinish", () => {
  const stopping = { capSeconds: CAP, autoStopAtCap: true };

  it("is true for a session the cap stopped", () => {
    expect(wasCappedFinish({ ...stopping, finishedAtSeconds: CAP })).toBe(true);
  });

  it("is false for a session that finished its work in time", () => {
    expect(wasCappedFinish({ ...stopping, finishedAtSeconds: CAP - 1 })).toBe(false);
  });

  it("is false for a session still running", () => {
    expect(wasCappedFinish({ ...stopping, finishedAtSeconds: null })).toBe(false);
  });

  it("is false for an untimed session, whenever it finished", () => {
    // A straight-sets day (DN-20) has no cap. Read as a zero this is the one
    // case that inverts: every finish is at or past second zero, so the log
    // screen would tell the athlete a clock they never saw had stopped them.
    expect(
      wasCappedFinish({
        capSeconds: null,
        autoStopAtCap: true,
        finishedAtSeconds: 2400,
      }),
    ).toBe(false);
  });

  it("is false with the auto-stop off, however long the session ran", () => {
    // Nothing stopped this clock: the athlete ran past the cap by choice, so
    // 22:00 is their real finish time and not a cap.
    expect(
      wasCappedFinish({
        capSeconds: CAP,
        autoStopAtCap: false,
        finishedAtSeconds: CAP + 120,
      }),
    ).toBe(false);
  });
});
