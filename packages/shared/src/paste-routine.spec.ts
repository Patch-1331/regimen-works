import { describe, expect, it } from "vitest";
import {
  matchPastedMovement,
  parsePastedLine,
  parsePastedRoutine,
} from "./paste-routine.js";

/**
 * Reading a routine pasted from elsewhere (DN-152).
 *
 * The parser is tested on its own text; the matcher on a small library built
 * for each rule. The worked example against the real library -- the issue's
 * acceptance table -- lives with the library, in the API's
 * `src/seed/paste-routine.spec.ts`.
 */

describe("parsePastedLine", () => {
  it("reads a fixed count", () => {
    expect(parsePastedLine("Barbell Deadlift 5x5")).toEqual({
      source: "Barbell Deadlift 5x5",
      name: "Barbell Deadlift",
      schemes: [{ sets: 5, reps: 5, repsMax: null, toFailure: false, seconds: false }],
      restSeconds: null,
      droppedLoad: null,
    });
  });

  it("reads a range, with either dash", () => {
    expect(parsePastedLine("Leg Press 3x15-20").schemes).toEqual([
      { sets: 3, reps: 15, repsMax: 20, toFailure: false, seconds: false },
    ]);
    expect(parsePastedLine("Leg Press 3 × 15–20").schemes).toEqual([
      { sets: 3, reps: 15, repsMax: 20, toFailure: false, seconds: false },
    ]);
  });

  it("reads sets to failure", () => {
    expect(parsePastedLine("Dips 2xfailure").schemes).toEqual([
      { sets: 2, reps: null, repsMax: null, toFailure: true, seconds: false },
    ]);
  });

  it("reads a hold in seconds, and the rest after it", () => {
    const line = parsePastedLine("Plank 3x60s rest 45s");
    expect(line.name).toBe("Plank");
    expect(line.schemes).toEqual([
      { sets: 3, reps: 60, repsMax: null, toFailure: false, seconds: true },
    ]);
    expect(line.restSeconds).toBe(45);
  });

  it("reads two schemes joined by &", () => {
    expect(parsePastedLine("Neutral Grip Pull Up 1x10 & 2xfailure").schemes).toEqual([
      { sets: 1, reps: 10, repsMax: null, toFailure: false, seconds: false },
      { sets: 2, reps: null, repsMax: null, toFailure: true, seconds: false },
    ]);
  });

  it("drops a load and says what it dropped", () => {
    const line = parsePastedLine("Barbell Squat 5x5 @ 225");
    expect(line.name).toBe("Barbell Squat");
    expect(line.droppedLoad).toBe("225");
    expect(parsePastedLine("Barbell Squat 5x5 @100kg").droppedLoad).toBe("100kg");
  });

  it("keeps a line with no scheme, for the sheet to ask about", () => {
    expect(parsePastedLine("Plank")).toMatchObject({ name: "Plank", schemes: [] });
  });

  it("reads a long run of digits quickly, as no scheme", () => {
    const started = performance.now();
    expect(parsePastedLine("0".repeat(50_000)).schemes).toEqual([]);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("ignores a list marker in front of the movement", () => {
    expect(parsePastedLine("- Plank 3x60s").name).toBe("Plank");
    expect(parsePastedLine("2. Plank 3x60s").name).toBe("Plank");
  });
});

describe("parsePastedRoutine", () => {
  it("pins weekday headings to their weekdays", () => {
    const routine = parsePastedRoutine(
      "Monday — Chest\nDips 3x8\n\nThu: Back\nBarbell Row 5x5\n",
    );
    expect(routine.scheduleMode).toBe("fixed");
    expect(routine.days.map((d) => [d.heading, d.dayOfWeek])).toEqual([
      ["Monday — Chest", 1],
      ["Thu: Back", 4],
    ]);
    expect(routine.days[1].lines.map((l) => l.name)).toEqual(["Barbell Row"]);
  });

  it("reads Day N headings as any days, in order", () => {
    const routine = parsePastedRoutine("Day 1\nDips 3x8\nDay 2 - Legs\nLeg Press 3x10");
    expect(routine.scheduleMode).toBe("flexible");
    expect(routine.days.map((d) => d.heading)).toEqual(["Day 1", "Day 2 - Legs"]);
    expect(routine.days.map((d) => d.dayOfWeek)).toEqual([null, null]);
  });

  it("treats a mix of weekdays and Day N as an order, not a schedule", () => {
    const routine = parsePastedRoutine("Monday\nDips 3x8\nDay 2\nLeg Press 3x10");
    expect(routine.scheduleMode).toBe("flexible");
    expect(routine.days.map((d) => d.dayOfWeek)).toEqual([null, null]);
  });

  it("puts lines before any heading on a day of their own", () => {
    const routine = parsePastedRoutine("Dips 3x8\nLeg Press 3x10");
    expect(routine.scheduleMode).toBe("flexible");
    expect(routine.days).toHaveLength(1);
    expect(routine.days[0].lines).toHaveLength(2);
  });

  it("does not take a movement that starts with a weekday's letters for a heading", () => {
    const routine = parsePastedRoutine("Monday\nSunflower stretch 2x30s");
    expect(routine.days).toHaveLength(1);
    expect(routine.days[0].lines[0].name).toBe("Sunflower stretch");
  });
});

describe("matchPastedMovement", () => {
  const ex = (name: string, equipment: string[] = []) => ({ name, equipment });

  it("matches a name exactly, whatever its case", () => {
    const squat = ex("Barbell squat", ["barbell"]);
    expect(matchPastedMovement("BARBELL SQUAT", [squat])).toEqual({
      kind: "match",
      exercise: squat,
      guessed: false,
    });
  });

  it("matches a plural or singular, and calls that a guess", () => {
    const lunges = ex("Dumbbell lunges", ["dumbbell"]);
    expect(matchPastedMovement("Dumbbell Lunge", [lunges])).toEqual({
      kind: "match",
      exercise: lunges,
      guessed: true,
    });
  });

  it("matches a plural made with -es", () => {
    const press = ex("Barbell press", ["barbell"]);
    expect(matchPastedMovement("Barbell Presses", [press])).toMatchObject({
      exercise: press,
      guessed: true,
    });
  });

  it("lets the text drop the grip or posture the library names", () => {
    const shrug = ex("Dumbbell shrug", ["dumbbell"]);
    expect(matchPastedMovement("Seated Dumbbell Shrug", [shrug])).toMatchObject({
      exercise: shrug,
    });
    const pullups = ex("Pullups", ["bar"]);
    expect(matchPastedMovement("Neutral Grip Pull Up", [pullups])).toMatchObject({
      exercise: pullups,
    });
  });

  it("prefers the default grip over a named one", () => {
    const medium = ex("Barbell bench press - medium grip", ["barbell"]);
    const close = ex("Close-grip barbell bench press", ["barbell"]);
    expect(matchPastedMovement("Barbell Bench Press", [close, medium])).toMatchObject({
      exercise: medium,
    });
    expect(matchPastedMovement("Barbell Bench Press", [medium, close])).toMatchObject({
      exercise: medium,
    });
  });

  it("refuses two grips that disagree", () => {
    expect(
      matchPastedMovement("Underhand Grip Lat Pulldown", [
        ex("Wide-grip lat pulldown", ["gym_machines"]),
      ]),
    ).toEqual({ kind: "none" });
  });

  it("refuses an implement the exercise does not use", () => {
    expect(
      matchPastedMovement("Barbell Row", [ex("Dumbbell row", ["dumbbell"])]),
    ).toEqual({ kind: "none" });
    expect(
      matchPastedMovement("Dumbbell Curl", [ex("Curl", ["barbell"])]),
    ).toEqual({ kind: "none" });
  });

  it("lets the exercise's own implement go unsaid", () => {
    const floor = ex("Floor press", ["barbell"]);
    expect(matchPastedMovement("Floor Press", [floor])).toMatchObject({
      exercise: floor,
    });
    const raise = ex("Side lateral raise", ["dumbbell"]);
    expect(matchPastedMovement("Dumbbell Lateral Raise", [raise])).toMatchObject({
      exercise: raise,
    });
  });

  it("refuses a name that adds an implement the text never said", () => {
    expect(
      matchPastedMovement("Push Press", [ex("Double kettlebell push press", ["kettlebell"])]),
    ).toEqual({ kind: "none" });
  });

  it("refuses a name that adds a load or a different movement", () => {
    expect(
      matchPastedMovement("Pull Ups", [ex("Weighted pull ups", ["bar", "dumbbell"])]),
    ).toEqual({ kind: "none" });
    expect(
      matchPastedMovement("Dumbbell Palms-Up Curl", [
        ex("Palms-up dumbbell wrist curl", ["dumbbell"]),
      ]),
    ).toEqual({ kind: "none" });
  });

  it("refuses when several fit equally well, and names them", () => {
    const chest = ex("Dips - chest version", ["dip_bars"]);
    const triceps = ex("Dips - triceps version", ["dip_bars"]);
    const a = ex("Wide-grip barbell curl", ["barbell"]);
    const b = ex("Close-grip barbell curl", ["barbell"]);
    expect(matchPastedMovement("Barbell Curl", [a, b])).toEqual({
      kind: "ambiguous",
      candidates: [a, b],
    });
    expect(matchPastedMovement("Dips", [chest, triceps])).toEqual({ kind: "none" });
  });

  it("refuses an empty name", () => {
    expect(matchPastedMovement("  ", [ex("Plank")])).toEqual({ kind: "none" });
  });
});
