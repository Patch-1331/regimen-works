import { describe, expect, it } from "vitest";
import * as fixtures from "../test/fixtures";
import type { ApiWod } from "./api";
import {
  EMPTY_WOD_DRAFT,
  type WodDraft,
  intervalFallback,
  isIntervalType,
  movementChoicesFor,
  parseRepScheme,
  problemsWith,
  schemeTotal,
  toWodDraft,
  toWodWriteBody,
} from "./wodDraft";

/**
 * The WOD editor's rules, away from the editor (DN-29).
 *
 * The same rules `WodsService` enforces, said before the request rather than
 * after it, plus the one the database enforces underneath both: a movement is
 * a flat count or a ladder, and `reps` is never a number the author and
 * Postgres have to agree about.
 */

const draft = (overrides: Partial<WodDraft> = {}): WodDraft => ({
  ...EMPTY_WOD_DRAFT,
  name: "Fran",
  movements: [{ exerciseId: "e1", mode: "flat", reps: "21", repScheme: "" }],
  ...overrides,
});

const PUSHUP = fixtures.apiExercise({ id: "e1", name: "Push-up" });
const SQUAT = fixtures.apiExercise({ id: "e2", name: "Air squat" });
const choices = [PUSHUP, SQUAT];

describe("parseRepScheme", () => {
  it("reads the three ways people write a ladder", () => {
    expect(parseRepScheme("21-15-9")).toEqual([21, 15, 9]);
    expect(parseRepScheme("21 15 9")).toEqual([21, 15, 9]);
    expect(parseRepScheme("21, 15, 9")).toEqual([21, 15, 9]);
  });

  it("reads a single rung as a ladder of one", () => {
    expect(parseRepScheme("50")).toEqual([50]);
  });

  it("refuses 3x10 rather than reading it as a ladder", () => {
    // Three rounds of ten is not the ladder [3, 10], and a misread here is a
    // workout of thirteen reps the author would never think to check.
    expect(parseRepScheme("3x10")).toBeNull();
  });

  it("refuses zero, negatives, and anything not a number", () => {
    expect(parseRepScheme("21-0-9")).toBeNull();
    expect(parseRepScheme("21--9")).toEqual([21, 9]);
    expect(parseRepScheme("twenty one")).toBeNull();
    expect(parseRepScheme("")).toBeNull();
    expect(parseRepScheme("   ")).toBeNull();
  });

  it("totals a ladder the way the service does", () => {
    expect(schemeTotal([21, 15, 9])).toBe(45);
  });
});

describe("isIntervalType", () => {
  it("knows the formats that run a timer", () => {
    expect(isIntervalType("emom")).toBe(true);
    expect(isIntervalType("tabata")).toBe(true);
    expect(isIntervalType("amrap")).toBe(false);
    expect(isIntervalType("for_time")).toBe(false);
  });
});

describe("toWodWriteBody", () => {
  it("sends a flat movement as reps with no scheme", () => {
    expect(toWodWriteBody(draft()).movements).toEqual([
      { exerciseId: "e1", reps: 21, repScheme: [] },
    ]);
  });

  it("sends a ladder as a scheme with no reps, leaving the total to the API", () => {
    // The CHECK constraint `reps = sum(repScheme)` is never something the two
    // layers can disagree about, because only one of them writes the total.
    const body = toWodWriteBody(
      draft({
        movements: [
          { exerciseId: "e1", mode: "ladder", reps: "", repScheme: "21-15-9" },
        ],
      }),
    );
    expect(body.movements).toEqual([
      { exerciseId: "e1", reps: null, repScheme: [21, 15, 9] },
    ]);
  });

  it("drops interval structure when the format does not run one", () => {
    // The author may have typed them as an EMOM, switched to For Time, and
    // never looked back. The service refuses values it would never read.
    const body = toWodWriteBody(
      draft({
        type: "for_time",
        workSeconds: "60",
        restSeconds: "0",
        intervalCount: "12",
      }),
    );
    expect(body).toMatchObject({
      workSeconds: null,
      restSeconds: null,
      intervalCount: null,
    });
  });

  it("keeps interval structure on a format that runs one", () => {
    const body = toWodWriteBody(
      draft({ type: "tabata", workSeconds: "20", restSeconds: "10", intervalCount: "8" }),
    );
    expect(body).toMatchObject({
      workSeconds: 20,
      restSeconds: 10,
      intervalCount: 8,
    });
  });

  it("sends an empty interval field as null rather than zero", () => {
    // `resolveIntervalConfig` fills the format's classic structure in for
    // nulls. A zero would be a decision that stops following it.
    expect(toWodWriteBody(draft({ type: "emom" }))).toMatchObject({
      workSeconds: null,
      intervalCount: null,
    });
  });

  it("keeps rest seconds of zero, which is what an EMOM is", () => {
    expect(
      toWodWriteBody(draft({ type: "emom", restSeconds: "0" })).restSeconds,
    ).toBe(0);
  });

  it("trims, and sends an empty description as null", () => {
    const body = toWodWriteBody(draft({ name: "  Fran  ", description: " " }));
    expect(body.name).toBe("Fran");
    expect(body.description).toBeNull();
  });
});

describe("toWodDraft", () => {
  const wod = (overrides: Partial<ApiWod> = {}): ApiWod => ({
    ...fixtures.wod(),
    ownerId: null,
    archivedAt: null,
    ...overrides,
  });

  it("round-trips a flat workout unchanged", () => {
    const original = wod({
      name: "Cindy",
      type: "amrap",
      timeCapMinutes: 20,
      rounds: null,
      isNamed: true,
      dominantPattern: "pull",
      description: "As many rounds as possible.",
      movements: [fixtures.movement({ reps: 5, repScheme: [] })],
    });

    expect(toWodWriteBody(toWodDraft(original))).toMatchObject({
      name: "Cindy",
      type: "amrap",
      timeCapMinutes: 20,
      isNamed: true,
      dominantPattern: "pull",
      description: "As many rounds as possible.",
      movements: [{ reps: 5, repScheme: [] }],
    });
  });

  it("round-trips a ladder back to the same scheme", () => {
    const original = wod({
      movements: [fixtures.movement({ reps: 45, repScheme: [21, 15, 9] })],
    });

    const back = toWodDraft(original);
    expect(back.movements[0]).toMatchObject({
      mode: "ladder",
      repScheme: "21-15-9",
      // The total is derived, so it is not offered as a number to edit.
      reps: "",
    });
    expect(toWodWriteBody(back).movements[0]).toMatchObject({
      reps: null,
      repScheme: [21, 15, 9],
    });
  });
});

describe("movementChoicesFor", () => {
  const global = fixtures.apiExercise({ id: "g1", ownerId: null });
  const own = fixtures.apiExercise({ id: "o1", ownerId: "user_alice" });
  const retired = fixtures.apiExercise({
    id: "g2",
    ownerId: null,
    archivedAt: "2026-09-18T00:00:00.000Z",
  });
  const all = [global, own, retired];

  it("lets an athlete's own workout use either tier", () => {
    expect(movementChoicesFor(all, "own").map((e) => e.id)).toEqual([
      "g1",
      "o1",
    ]);
  });

  it("lets a shared workout use only shared movements", () => {
    // A global WOD is the scheduler's pool for everyone; naming one athlete's
    // own movement would break every athlete's scheduler the day they retired
    // it.
    expect(movementChoicesFor(all, "global").map((e) => e.id)).toEqual(["g1"]);
  });

  it("never offers a retired movement", () => {
    expect(movementChoicesFor(all, "own").map((e) => e.id)).not.toContain("g2");
  });
});

describe("intervalFallback", () => {
  it("shows what an empty EMOM will actually run", () => {
    expect(intervalFallback(draft({ type: "emom", timeCapMinutes: "12" })))
      .toEqual({ workSeconds: 60, restSeconds: 0, intervalCount: 12 });
  });

  it("shows Tabata's classic structure", () => {
    expect(intervalFallback(draft({ type: "tabata" }))).toEqual({
      workSeconds: 20,
      restSeconds: 10,
      intervalCount: 8,
    });
  });

  it("has nothing to show on a format with no intervals", () => {
    expect(intervalFallback(draft({ type: "amrap" }))).toBeNull();
  });
});

describe("problemsWith", () => {
  it("passes a complete workout", () => {
    expect(problemsWith(draft(), choices)).toEqual([]);
  });

  it("asks for a name", () => {
    expect(problemsWith(draft({ name: "  " }), choices)).toContain(
      "A workout needs a name.",
    );
  });

  it("asks for a time cap that is a whole number of minutes", () => {
    expect(problemsWith(draft({ timeCapMinutes: "" }), choices).join()).toMatch(
      /time cap/i,
    );
    expect(
      problemsWith(draft({ timeCapMinutes: "12.5" }), choices).join(),
    ).toMatch(/time cap/i);
    expect(problemsWith(draft({ timeCapMinutes: "0" }), choices).join()).toMatch(
      /time cap/i,
    );
  });

  it("lets rounds be empty but not nonsense", () => {
    expect(problemsWith(draft({ rounds: "" }), choices)).toEqual([]);
    expect(problemsWith(draft({ rounds: "five" }), choices).join()).toMatch(
      /rounds/i,
    );
  });

  it("refuses a workout with no movements at all", () => {
    expect(problemsWith(draft({ movements: [] }), choices).join()).toMatch(
      /at least one movement/i,
    );
  });

  it("names the movement that has none chosen", () => {
    expect(
      problemsWith(
        draft({
          movements: [
            { exerciseId: "e1", mode: "flat", reps: "21", repScheme: "" },
            { exerciseId: "", mode: "flat", reps: "15", repScheme: "" },
          ],
        }),
        choices,
      ),
    ).toContain("Movement 2 has no movement chosen.");
  });

  it("refuses a movement the pool does not offer", () => {
    expect(
      problemsWith(
        draft({
          movements: [
            { exerciseId: "gone", mode: "flat", reps: "21", repScheme: "" },
          ],
        }),
        choices,
      ).join(),
    ).toMatch(/cannot point at/i);
  });

  it("asks a flat movement for a rep count", () => {
    expect(
      problemsWith(
        draft({
          movements: [
            { exerciseId: "e1", mode: "flat", reps: "0", repScheme: "" },
          ],
        }),
        choices,
      ).join(),
    ).toMatch(/rep count of at least one/i);
  });

  it("asks a ladder for numbers it can read", () => {
    expect(
      problemsWith(
        draft({
          movements: [
            { exerciseId: "e1", mode: "ladder", reps: "", repScheme: "3x10" },
          ],
        }),
        choices,
      ).join(),
    ).toMatch(/ladder has to be whole numbers/i);
  });

  it("refuses ladders of different lengths in one workout", () => {
    const problems = problemsWith(
      draft({
        movements: [
          { exerciseId: "e1", mode: "ladder", reps: "", repScheme: "21-15-9" },
          { exerciseId: "e2", mode: "ladder", reps: "", repScheme: "10-10" },
        ],
      }),
      choices,
    );
    expect(problems.join()).toMatch(/same number of rounds/i);
    expect(problems.join()).toMatch(/2 and 3/);
  });

  it("allows a ladder alongside a flat movement", () => {
    // Only the ladders have to agree; "21-15-9 thrusters, 10 burpees each
    // round" is a workout someone writes on purpose.
    expect(
      problemsWith(
        draft({
          movements: [
            { exerciseId: "e1", mode: "ladder", reps: "", repScheme: "21-15-9" },
            { exerciseId: "e2", mode: "flat", reps: "10", repScheme: "" },
          ],
        }),
        choices,
      ),
    ).toEqual([]);
  });

  it("says nothing about interval fields on a format with no intervals", () => {
    // They are dropped on the way out rather than refused, so a leftover
    // value is not something the author has to clear before saving.
    expect(
      problemsWith(draft({ type: "for_time", workSeconds: "nonsense" }), choices),
    ).toEqual([]);
  });

  it("checks interval fields on a format that runs one", () => {
    expect(
      problemsWith(draft({ type: "emom", workSeconds: "0" }), choices).join(),
    ).toMatch(/work seconds/i);
    expect(
      problemsWith(draft({ type: "emom", intervalCount: "-1" }), choices).join(),
    ).toMatch(/interval count/i);
  });

  it("accepts rest seconds of zero, which is what an EMOM is", () => {
    expect(problemsWith(draft({ type: "emom", restSeconds: "0" }), choices)).toEqual(
      [],
    );
    expect(
      problemsWith(draft({ type: "emom", restSeconds: "-5" }), choices).join(),
    ).toMatch(/rest seconds/i);
  });

  it("reports every problem at once rather than one at a time", () => {
    expect(
      problemsWith(
        draft({ name: "", timeCapMinutes: "", movements: [] }),
        choices,
      ),
    ).toHaveLength(3);
  });
});
