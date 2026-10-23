import { describe, expect, it } from "vitest";
import { createProgramSchema, uniformSets } from "@regimen-works/shared";
import * as fixtures from "../test/fixtures";
import {
  EMPTY_PROGRAM,
  SET_PRESETS,
  applyPreset,
  blankLine,
  changesWeek,
  copyDay,
  draftProblems,
  duplicateLine,
  fromProgram,
  lineProblems,
  searchExercises,
  toCreateProgram,
  toPerSet,
  toSameForAll,
  trainingDays,
  type DraftLine,
  type ProgramDraft,
} from "./programDraft";

/**
 * The editor's working copy (DN-145). What matters is that a draft the
 * screen calls saveable is one the API accepts -- the two sides state the
 * same rules, so each is checked against the shared schema here.
 */

const line = (overrides: Partial<DraftLine> = {}): DraftLine => ({
  ...blankLine(),
  movementGroup: "pull",
  ...overrides,
});

const draft = (overrides: Partial<ProgramDraft> = {}): ProgramDraft => ({
  ...EMPTY_PROGRAM,
  name: "Mine",
  days: { 1: [line()], 4: [line({ movementGroup: "squat" })] },
  ...overrides,
});

describe("lineProblems", () => {
  it("wants a movement", () => {
    expect(lineProblems(line({ movementGroup: null }))).toEqual([
      "Choose a movement.",
    ]);
  });

  it("wants a count unless the line is to failure", () => {
    expect(lineProblems(line({ reps: null }))).toEqual([
      "How many reps — or to failure?",
    ]);
    expect(lineProblems(line({ reps: null, toFailure: true }))).toEqual([]);
  });

  it("wants a range to go up", () => {
    expect(lineProblems(line({ reps: 8, repsMax: 8 }))).toEqual([
      "The top of the range must be above the bottom.",
    ]);
  });

  it("does not want a rest", () => {
    expect(lineProblems(line({ restSeconds: null }))).toEqual([]);
  });
});

describe("draftProblems", () => {
  it("wants a name and a day", () => {
    expect(draftProblems({ ...EMPTY_PROGRAM })).toEqual([
      "Name the program.",
      "Add a movement to at least one day.",
    ]);
  });
});

describe("toCreateProgram", () => {
  it("gives the API a body it accepts, rest days left out", () => {
    const body = toCreateProgram(draft({ days: { 1: [line()], 3: [] } }));

    expect(createProgramSchema.safeParse(body).success).toBe(true);
    expect(body.days.map((d) => d.dayOfWeek)).toEqual([1]);
  });

  it("sends no count on a failure line, whatever the box held", () => {
    const body = toCreateProgram(
      draft({ days: { 1: [line({ toFailure: true, reps: 10 })] } }),
    );

    expect(body.days[0].lines[0].sets).toEqual(
      uniformSets(3, { reps: null, repsMax: null, toFailure: true, restSeconds: null }),
    );
    expect(createProgramSchema.safeParse(body).success).toBe(true);
  });

  it("writes a line's count as that many identical sets (DN-190)", () => {
    const body = toCreateProgram(
      draft({ days: { 1: [line({ sets: 4, reps: 6, repsMax: 10, restSeconds: 0 })] } }),
    );

    expect(body.days[0].lines[0].sets).toEqual(
      uniformSets(4, { reps: 6, repsMax: 10, toFailure: false, restSeconds: 0 }),
    );
  });

  it("sends a blank summary as none, for the API to write", () => {
    expect(toCreateProgram(draft({ summary: "  " })).summary).toBeNull();
  });
});

describe("editing a saved program (DN-146)", () => {
  const saved = toCreateProgram(
    draft({ summary: "Mine, twice", days: { 1: [line()], 4: [line({ toFailure: true })] } }),
  );

  it("loads a saved program into a draft that saves back the same", () => {
    expect(toCreateProgram(fromProgram(saved))).toEqual(saved);
  });

  it("loads no summary as a blank box", () => {
    expect(fromProgram({ ...saved, summary: null }).summary).toBe("");
  });

  it("opens a line whose sets differ set by set, and saves it back the same (ADR 0011)", () => {
    const [day] = saved.days;
    const [first] = day.lines;
    const set = first.sets[0];
    const stepped = { ...set, reps: (set.reps ?? 0) + 1, loadStepPercent: -10 };
    const varied = { ...first, sets: [...first.sets, stepped] };
    const withVaried = { ...saved, days: [{ ...day, lines: [varied] }] };
    const loaded = fromProgram(withVaried);

    expect(loaded.days[1]?.[0].perSet).toHaveLength(4);
    expect(loaded.days[1]?.[0].perSet?.[3].loadStepPercent).toBe(-10);
    expect(toCreateProgram(loaded)).toEqual(withVaried);
  });

  it("opens a uniform line as same for all sets", () => {
    expect(fromProgram(saved).days[1]?.[0].perSet).toBeNull();
  });

  it("calls a rename or a new summary no change to the week", () => {
    const renamed = { ...fromProgram(saved), name: "Yours", summary: "" };
    expect(changesWeek(renamed, saved)).toBe(false);
  });

  it("calls a new line, a new count, or a new mode a change to the week", () => {
    const loaded = fromProgram(saved);
    const monday = (loaded.days[1] ?? []).map((l) => ({ ...l, sets: 5 }));
    expect(changesWeek(copyDay(loaded, 1, [2]), saved)).toBe(true);
    expect(changesWeek({ ...loaded, days: { ...loaded.days, 1: monday } }, saved)).toBe(true);
    expect(changesWeek({ ...loaded, scheduleMode: "fixed" }, saved)).toBe(true);
  });
});

describe("per-set lines (ADR 0011)", () => {
  const rested = line({ sets: 3, reps: 8, restSeconds: 120 });
  const filled = (preset: (typeof SET_PRESETS)[number]["id"]) =>
    (applyPreset(rested, preset).perSet ?? []).map((s) => [
      s.reps,
      s.repsMax,
      s.toFailure,
      s.loadStepPercent,
      s.restSeconds,
    ]);

  it("fills RPT heaviest first, about 10% lighter and more reps each set", () => {
    expect(filled("rpt")).toEqual([
      [6, 8, false, null, 120],
      [8, 10, false, -10, 120],
      [10, 12, false, -10, 120],
    ]);
  });

  it("fills the pyramids load up, reps down and the other way round", () => {
    expect(filled("pyramid-up")).toEqual([
      [12, null, false, null, 120],
      [10, null, false, 10, 120],
      [8, null, false, 10, 120],
    ]);
    expect(filled("pyramid-down")).toEqual([
      [8, null, false, null, 120],
      [10, null, false, -10, 120],
      [12, null, false, -10, 120],
    ]);
  });

  it("fills a top set with back-offs at -15%, then the same weight", () => {
    expect(filled("top-backoff")).toEqual([
      [5, null, false, null, 120],
      [5, null, false, -15, 120],
      [5, null, false, 0, 120],
      [5, null, false, 0, 120],
    ]);
  });

  it("fills a drop set with no rest between drops, and the line's rest after", () => {
    expect(filled("drop")).toEqual([
      [null, null, true, null, 0],
      [null, null, true, -20, 0],
      [null, null, true, -20, 120],
    ]);
  });

  it("fills 5/5/5+ with the last set to failure and no load steps", () => {
    expect(filled("5-5-5plus")).toEqual([
      [5, null, false, null, 120],
      [5, null, false, null, 120],
      [null, null, true, null, 120],
    ]);
  });

  it("saves every preset as a body the API accepts, beside a uniform line", () => {
    for (const { id } of SET_PRESETS) {
      const uniform = line({ sets: 3, reps: 5 });
      const body = toCreateProgram(draft({ days: { 1: [applyPreset(rested, id), uniform] } }));
      expect(createProgramSchema.safeParse(body).success).toBe(true);
      expect(body.days[0].lines[1].sets).toHaveLength(3);
    }
  });

  it("never sends a load step on the first set", () => {
    const split = toPerSet(rested);
    const stepped = {
      ...split,
      perSet: split.perSet!.map((s, i) => (i === 0 ? { ...s, loadStepPercent: -10 } : s)),
    };
    const [sent] = toCreateProgram(draft({ days: { 1: [stepped] } })).days[0].lines[0].sets;

    expect(sent.loadStepPercent).toBeNull();
  });

  it("splits a uniform line into its sets and joins it back", () => {
    const split = toPerSet(rested);
    expect(split.perSet).toHaveLength(3);
    expect(split.perSet?.every((s) => s.reps === 8 && s.loadStepPercent === null)).toBe(true);

    expect(toSameForAll(split)).toMatchObject({ perSet: null, sets: 3, reps: 8, restSeconds: 120 });
  });

  it("names the set a problem is on, and refuses a drop of the whole load", () => {
    const rpt = applyPreset(rested, "rpt");
    const broken = {
      ...rpt,
      perSet: rpt.perSet!.map((s, i) =>
        i === 1 ? { ...s, reps: null } : i === 2 ? { ...s, loadStepPercent: -100 } : s,
      ),
    };
    const problems = lineProblems(broken);

    expect(problems.some((p) => p.startsWith("Set 2: "))).toBe(true);
    expect(problems.some((p) => p.startsWith("Set 3: ") && /100%/.test(p))).toBe(true);
    expect(lineProblems({ ...rpt, perSet: [] })).toContain("Add at least one set.");
  });
});

describe("a day's name (DN-155)", () => {
  it("sends a day's name trimmed, and none where it is blank or the day rests", () => {
    const body = toCreateProgram(
      draft({ labels: { 1: "  Push  ", 4: " ", 6: "Rest day name" } }),
    );

    expect(body.days).toEqual([
      expect.objectContaining({ dayOfWeek: 1, label: "Push" }),
      expect.not.objectContaining({ label: expect.anything() }),
    ]);
    expect(createProgramSchema.safeParse(body).success).toBe(true);
  });

  it("loads the names back, and saves them back the same", () => {
    const saved = toCreateProgram(draft({ labels: { 4: "Legs" } }));
    const loaded = fromProgram(saved);

    expect(loaded.labels).toEqual({ 4: "Legs" });
    expect(toCreateProgram(loaded)).toEqual(saved);
  });

  it("calls naming a day no change to the week", () => {
    const saved = toCreateProgram(draft({ labels: { 1: "Push" } }));
    const loaded = fromProgram(saved);

    expect(changesWeek({ ...loaded, labels: { 1: "Pull", 4: "Legs" } }, saved)).toBe(false);
    expect(changesWeek({ ...loaded, labels: {} }, saved)).toBe(false);
  });

  it("copies a day's lines, not its name", () => {
    const next = copyDay(draft({ labels: { 1: "Push" } }), 1, [2]);

    expect(next.labels).toEqual({ 1: "Push" });
  });
});

describe("repetition", () => {
  it("copies a day onto other weekdays as new lines", () => {
    const d = draft();
    const next = copyDay(d, 1, [2, 5]);

    expect(trainingDays(next)).toEqual([1, 2, 4, 5]);
    expect(next.days[2]![0].id).not.toBe(d.days[1]![0].id);
    expect(next.days[2]![0].movementGroup).toBe("pull");
  });

  it("duplicates a line straight after itself", () => {
    const first = line();
    const d = draft({ days: { 1: [first, line({ movementGroup: "hinge" })] } });
    const next = duplicateLine(d, 1, first.id);

    expect(next.days[1]!.map((l) => l.movementGroup)).toEqual([
      "pull",
      "pull",
      "hinge",
    ]);
  });
});

describe("searchExercises", () => {
  const library = [
    fixtures.apiExercise({ id: "a", name: "Ring row" }),
    fixtures.apiExercise({ id: "b", name: "Row" }),
    fixtures.apiExercise({ id: "c", name: "Barbell bent-over row" }),
    fixtures.apiExercise({ id: "d", name: "Push-up" }),
    fixtures.apiExercise({ id: "e", name: "Rowing sprint" }),
  ];

  it("puts an exact name first, then names starting with it, then the rest", () => {
    expect(searchExercises("row", library).map((e) => e.id)).toEqual([
      "b",
      "e",
      "c",
      "a",
    ]);
  });

  it("matches every word typed, in any order", () => {
    expect(searchExercises("row barb", library).map((e) => e.id)).toEqual([
      "c",
    ]);
  });
});
