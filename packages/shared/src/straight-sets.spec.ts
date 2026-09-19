import { describe, expect, it } from "vitest";
import { restStateAt, straightSetsStateAt } from "./straight-sets.js";

/**
 * A prescribed day's position, derived from the one number that stores it
 * (DN-20).
 *
 * These are the resume rules. Everything the runner draws -- which movement
 * is lit, which set the athlete is on, whether the session is over -- comes
 * out of this function, so a session reloaded on a locked phone lands where it
 * left off rather than at the top.
 */

/** 5×3 chin-ups, then 3×8 ring rows, then 4×10 push-ups: 12 sets. */
const DAY = [{ sets: 5 }, { sets: 3 }, { sets: 4 }];

describe("straightSetsStateAt", () => {
  it("starts on the first set of the first movement", () => {
    const state = straightSetsStateAt(DAY, 0);

    expect(state.movementIndex).toBe(0);
    expect(state.setNumber).toBe(1);
    expect(state.setsInMovement).toBe(5);
    expect(state.totalSets).toBe(12);
    expect(state.isComplete).toBe(false);
  });

  it("counts through a movement's own sets", () => {
    expect(straightSetsStateAt(DAY, 2).setNumber).toBe(3);
    expect(straightSetsStateAt(DAY, 2).movementIndex).toBe(0);
  });

  it("rolls onto the next movement when one runs out", () => {
    // Five sets done is the whole first movement, so the athlete is on the
    // first set of the second -- not a sixth set of five.
    const state = straightSetsStateAt(DAY, 5);

    expect(state.movementIndex).toBe(1);
    expect(state.setNumber).toBe(1);
    expect(state.setsInMovement).toBe(3);
  });

  it("crosses two movements without losing count", () => {
    // 5 + 3 = 8 behind them, so the third movement's first set.
    expect(straightSetsStateAt(DAY, 8)).toMatchObject({
      movementIndex: 2,
      setNumber: 1,
      setsInMovement: 4,
    });
  });

  it("is complete on the last prescribed set and not before", () => {
    expect(straightSetsStateAt(DAY, 11).isComplete).toBe(false);
    expect(straightSetsStateAt(DAY, 12).isComplete).toBe(true);
  });

  it("holds the last set it finished rather than inventing one past the end", () => {
    // The screen reads "SET 4 OF 4" on a finished session, which is what the
    // athlete just did -- a fifth set of four would be a number they would
    // have to work out was a bug.
    const state = straightSetsStateAt(DAY, 12);

    expect(state.movementIndex).toBe(2);
    expect(state.setNumber).toBe(4);
    expect(state.setsInMovement).toBe(4);
  });

  it("clamps a count that outran its list", () => {
    // Only reachable through a stored count read against a snapshot, which is
    // exactly where throwing would cost the athlete their session.
    expect(straightSetsStateAt(DAY, 99)).toMatchObject({
      isComplete: true,
      setsCompleted: 12,
    });
    expect(straightSetsStateAt(DAY, -3)).toMatchObject({
      movementIndex: 0,
      setNumber: 1,
      setsCompleted: 0,
    });
  });

  it("calls a session with nothing prescribed complete rather than crashing", () => {
    expect(straightSetsStateAt([], 0)).toMatchObject({
      isComplete: true,
      totalSets: 0,
      setNumber: 0,
    });
  });
});

describe("restStateAt", () => {
  it("counts down from the second the rest began", () => {
    // Rest started 30s in, 90s long, now 40s in: a minute still to go.
    expect(restStateAt(40, 30, 90)).toEqual({
      secondsRemaining: 80,
      isOver: false,
    });
  });

  it("is over once the rest is spent, and stays over", () => {
    expect(restStateAt(120, 30, 90).isOver).toBe(true);
    // The athlete left the phone face down for ten minutes. The rest does not
    // go negative and the screen does not count up.
    expect(restStateAt(600, 30, 90)).toEqual({
      secondsRemaining: 0,
      isOver: true,
    });
  });

  it("is over immediately where the day prescribes no rest", () => {
    expect(restStateAt(30, 30, 0).isOver).toBe(true);
  });

  it("reads the same second however many ticks the tab managed to fire", () => {
    // The point of storing when the rest began rather than what is left of
    // it: a backgrounded tab that fired nothing still resumes here.
    expect(restStateAt(75.9, 30, 90).secondsRemaining).toBe(45);
  });
});
