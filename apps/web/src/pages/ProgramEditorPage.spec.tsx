import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  CreateProgram,
  ProgramExport,
  EditableProgram,
  GlobalProgramSummary,
  ProgramSummary,
} from "@regimen-works/shared";
import { uniformSets } from "@regimen-works/shared";
import { renderRoute } from "../test/renderRoute";
import { saveJson } from "../lib/download";
import { server, http, HttpResponse } from "../test/server";
import * as fixtures from "../test/fixtures";

vi.mock("../lib/download", () => ({ saveJson: vi.fn() }));

vi.mock("@clerk/clerk-react", async () => {
  const { clerkTestDouble } = await import("../test/clerk");
  return clerkTestDouble();
});

/**
 * Writing a program (DN-145), one page per step (DN-193): the wizard, "Your
 * programs", and the way in from the setup wizard.
 */

const CHIN_UP = fixtures.apiExercise({
  id: "chin",
  name: "Chin-up",
  movementGroup: "pull",
});
const RING_ROW = fixtures.apiExercise({
  id: "ring",
  name: "Ring row",
  movementGroup: "pull",
});

const SAVED: ProgramSummary = {
  id: "program-1",
  name: "Pull days",
  summary: "Your program, 1 day a week",
  scheduleMode: "flexible",
  days: [1],
  archived: false,
};

function api(
  options: {
    onboarded?: boolean;
    admin?: boolean;
    programs?: ProgramSummary[];
    library?: ProgramSummary[];
  } = {},
) {
  const sent: CreateProgram[] = [];
  let saved = false;
  server.use(
    http.get("/api/me", () =>
      HttpResponse.json({
        id: "user_alice",
        isAdmin: options.admin === true,
        onboardedAt: options.onboarded === false ? null : "2026-09-01T00:00:00.000Z",
      }),
    ),
    http.get("/api/exercises", () => HttpResponse.json([CHIN_UP, RING_ROW])),
    http.get("/api/programs/library", () => HttpResponse.json(options.library ?? [])),
    http.get("/api/programs", () =>
      HttpResponse.json(options.programs ?? (saved ? [SAVED] : [])),
    ),
    http.post("/api/programs", async ({ request }) => {
      sent.push((await request.json()) as CreateProgram);
      saved = true;
      return HttpResponse.json(SAVED, { status: 201 });
    }),
    http.get("/api/setup", () =>
      HttpResponse.json(
        fixtures.setupOptions({
          programs: [
            fixtures.setupProgram(),
            ...(saved
              ? [
                  fixtures.setupProgram({
                    id: SAVED.id,
                    name: SAVED.name,
                    summary: SAVED.summary,
                    minDaysPerWeek: 1,
                    maxDaysPerWeek: 1,
                    defaultDays: [1],
                    minWeeks: 1,
                    maxWeeks: 52,
                    defaultWeeks: 8,
                    allowsNoEnd: true,
                    hasStraightSets: true,
                  }),
                ]
              : []),
          ],
        }),
      ),
    ),
  );
  return sent;
}

const steps = () => screen.getByRole("navigation", { name: "Steps" });
/** Goes to a step from the step bar: "Basics", "Mon", "Day 2", "Review". */
async function goTo(step: string) {
  await userEvent.click(within(steps()).getByRole("button", { name: new RegExp(`^${step}`) }));
}
/** Basics: ticks or unticks a training day. */
async function toggleDay(short: string) {
  const days = await screen.findByRole("group", { name: "TRAINING DAYS" });
  await userEvent.click(within(days).getByRole("button", { name: short }));
}
/** On a day's page: opens the picker, searches, and picks -- landing on the movement's page. */
async function addMovement(query: string, pick: RegExp) {
  await userEvent.click(
    await screen.findByRole("button", { name: /^\+ Add (first )?movement$/ }),
  );
  await userEvent.type(screen.getByLabelText("Search movements"), query);
  await userEvent.click(await screen.findByRole("button", { name: pick }));
}
const done = () => userEvent.click(screen.getByRole("button", { name: /^Done · back to/ }));

/** From Basics: Monday ticked and opened, a line added as "any pull" beneath the chin-up. */
async function writeMondayPull() {
  await toggleDay("Mon");
  await userEvent.click(screen.getByRole("button", { name: /^Next: / }));
  await addMovement("chin", /or: any pull/);
}

describe("the wizard (DN-193)", () => {
  it("builds its steps from the days picked in Basics", async () => {
    api();
    renderRoute("/programs/new");

    for (const day of ["Mon", "Wed", "Fri"]) await toggleDay(day);
    await userEvent.click(screen.getByRole("button", { name: /On these weekdays/ }));

    const names = () =>
      within(steps())
        .getAllByRole("button")
        // The label alone, without a ✓ or ! beside it.
        .map((b) => b.textContent!.replace(/ [✓!].*$/, ""));
    expect(names()).toEqual(["Basics", "Mon", "Wed", "Fri", "Review"]);
    expect(screen.getByText("STEP 1 OF 5")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Next: Monday →" }));
    expect(screen.getByRole("heading", { name: "Monday" })).toBeInTheDocument();
    expect(screen.getByText("DAY 1 OF 3")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Next: Wednesday →" }));
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Monday" })).toBeInTheDocument();

    // In order, whenever you can: the days are first, second and third.
    await goTo("Basics");
    await userEvent.click(screen.getByRole("button", { name: /Any 3 days a week/ }));
    expect(names()).toEqual(["Basics", "Day 1", "Day 2", "Day 3", "Review"]);
  });

  it("refuses to save until the program is named and has a day", async () => {
    api();
    renderRoute("/programs/new");

    await screen.findByLabelText("Program name");
    await goTo("Review");
    const save = screen.getByRole("button", { name: "Save program" });
    expect(save).toBeDisabled();
    expect(screen.getByText(/2 things to fix before saving — starting with a name/)).toBeInTheDocument();
  });

  it("flags a day left empty, in the step bar and on Review, and goes back to it", async () => {
    api();
    renderRoute("/programs/new");

    await userEvent.type(await screen.findByLabelText("Program name"), "Pull days");
    await toggleDay("Wed");
    await writeMondayPull();
    await done();
    await userEvent.click(screen.getByRole("button", { name: /^Next: Day 2/ }));
    expect(screen.getByText("Nothing on Day 2 yet.")).toBeInTheDocument();
    // Not wrong until it has been left: only the day being shown so far.
    expect(within(steps()).queryByText(/needs fixing/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Next: Review →" }));

    const week = screen.getByRole("list", { name: "The week" });
    const wednesday = within(week).getByRole("button", { name: /^Day 2/ });
    expect(wednesday).toHaveTextContent("No movements yet");
    expect(wednesday).toHaveTextContent("FIX");
    expect(within(steps()).getByRole("button", { name: /^Day 2/ })).toHaveTextContent(
      /needs fixing/,
    );
    expect(within(week).getAllByText("Rest")).toHaveLength(5);
    expect(screen.getByText(/1 thing to fix before saving/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save program" })).toBeDisabled();

    await userEvent.click(wednesday);
    expect(screen.getByRole("heading", { name: "Day 2" })).toBeInTheDocument();
  });

  it("saves a program and lists it", async () => {
    const sent = api();
    renderRoute("/programs/new");

    await userEvent.type(await screen.findByLabelText("Program name"), "Pull days");
    await writeMondayPull();
    await done();
    await goTo("Review");
    await userEvent.click(screen.getByRole("button", { name: "Save program" }));

    // Review's own heading says "Pull days" too: wait for the list first.
    await screen.findByRole("link", { name: "+ New program" });
    expect(await screen.findByText("Pull days")).toBeInTheDocument();
    expect(sent).toEqual([
      {
        name: "Pull days",
        summary: null,
        scheduleMode: "flexible",
        days: [
          {
            dayOfWeek: 1,
            lines: [
              {
                movementGroup: "pull",
                exerciseId: null,
                sets: uniformSets(3, {
                  reps: 10,
                  repsMax: null,
                  toFailure: false,
                  restSeconds: null,
                }),
              },
            ],
          },
        ],
      },
    ]);
  });

  it("fills a line from the RPT preset, takes edits set by set, and saves each set (ADR 0011)", async () => {
    const sent = api();
    renderRoute("/programs/new");

    await userEvent.type(await screen.findByLabelText("Program name"), "RPT days");
    await writeMondayPull();
    expect(screen.getByRole("button", { name: "Same for all sets" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await userEvent.click(screen.getByRole("button", { name: "RPT" }));

    expect(screen.getByRole("button", { name: "Set by set" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.queryByLabelText("Set 1 load step percent")).not.toBeInTheDocument();
    const step = screen.getByLabelText("Set 3 load step percent");
    expect(step).toHaveValue("-10");
    await userEvent.clear(step);
    await userEvent.type(step, "-15");
    const reps = screen.getByLabelText("Set 2 reps");
    await userEvent.clear(reps);
    await userEvent.type(reps, "9");
    await done();
    await goTo("Review");
    await userEvent.click(screen.getByRole("button", { name: "Save program" }));

    await screen.findByRole("link", { name: "+ New program" });
    // No scheme name anywhere: the sets are the line.
    expect(sent[0].days[0].lines[0]).toEqual({
      movementGroup: "pull",
      exerciseId: null,
      sets: [
        { reps: 6, repsMax: 8, toFailure: false, loadStepPercent: null, restSeconds: null },
        { reps: 9, repsMax: 10, toFailure: false, loadStepPercent: -10, restSeconds: null },
        { reps: 10, repsMax: 12, toFailure: false, loadStepPercent: -15, restSeconds: null },
      ],
    });
  });

  it("goes back to one count for all sets from the first set", async () => {
    api();
    renderRoute("/programs/new");
    await writeMondayPull();
    await userEvent.click(screen.getByRole("button", { name: "Drop set" }));
    expect(screen.getAllByText("failure")).not.toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "Remove set 3" }));
    expect(screen.queryByLabelText("Set 3 rest seconds")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Same for all sets" }));

    expect(screen.getByLabelText("Sets")).toHaveValue("2");
    expect(screen.getByLabelText("Rest seconds")).toHaveValue("0");
  });

  it("names a specific exercise when one is picked", async () => {
    const sent = api();
    renderRoute("/programs/new");

    await userEvent.type(await screen.findByLabelText("Program name"), "Rows");
    await toggleDay("Mon");
    await userEvent.click(screen.getByRole("button", { name: /^Next: / }));
    await addMovement("ring", /^Ring row/);
    await done();
    await goTo("Basics");
    await userEvent.click(screen.getByRole("button", { name: /On these weekdays/ }));
    await goTo("Review");
    await userEvent.click(screen.getByRole("button", { name: "Save program" }));

    await screen.findByRole("link", { name: "+ New program" });
    expect(sent[0]).toMatchObject({ scheduleMode: "fixed" });
    expect(sent[0].days[0].lines[0]).toMatchObject({
      exerciseId: "ring",
      movementGroup: null,
    });
  });

  it("reorders, duplicates and removes a day's movements", async () => {
    const sent = api();
    renderRoute("/programs/new");

    await userEvent.type(await screen.findByLabelText("Program name"), "Pulls");
    await writeMondayPull();
    await done();
    await addMovement("ring", /^Ring row/);
    await userEvent.click(screen.getByRole("button", { name: "DUPLICATE" }));
    expect(screen.getByText("MOVEMENT 3 OF 3")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "REMOVE FROM DAY 1" }));
    await userEvent.click(screen.getByRole("button", { name: "Move Ring row up" }));
    expect(screen.getByRole("button", { name: "Move Ring row up" })).toBeDisabled();
    await goTo("Review");
    await userEvent.click(screen.getByRole("button", { name: "Save program" }));

    await screen.findByRole("link", { name: "+ New program" });
    expect(sent[0].days[0].lines.map((l) => l.exerciseId ?? l.movementGroup)).toEqual([
      "ring",
      "pull",
    ]);
  });

  it("copies a written day onto an empty one", async () => {
    api();
    renderRoute("/programs/new");

    await toggleDay("Thu");
    await writeMondayPull();
    await done();
    await goTo("Day 2");
    await userEvent.click(screen.getByRole("button", { name: /^Copy Monday/ }));

    expect(screen.getByRole("button", { name: /^Any pull/ })).toBeInTheDocument();
    await goTo("Review");
    const week = screen.getByRole("list", { name: "The week" });
    expect(within(week).getByRole("button", { name: /^Day 2/ })).toHaveTextContent("Any pull");
  });

  it("keeps a dropped day's movements if it is picked again", async () => {
    api();
    renderRoute("/programs/new");

    await writeMondayPull();
    await done();
    await goTo("Basics");
    await toggleDay("Mon");
    expect(within(steps()).getAllByRole("button")).toHaveLength(2);
    await toggleDay("Mon");
    await goTo("Day 1");
    expect(screen.getByRole("button", { name: /^Any pull/ })).toBeInTheDocument();
  });
});

const PULL_DAYS: CreateProgram = {
  name: "Pull days",
  summary: null,
  scheduleMode: "flexible",
  days: [
    {
      dayOfWeek: 1,
      lines: [
        {
          movementGroup: "pull",
          exerciseId: null,
          sets: uniformSets(3, {
            reps: 10,
            repsMax: null,
            toFailure: false,
            restSeconds: null,
          }),
        },
      ],
    },
  ],
};

/** The saved program the editor loads, and every body it saves back. */
function editing(overrides: Partial<EditableProgram> = {}) {
  const sent: CreateProgram[] = [];
  api({ programs: [SAVED] });
  server.use(
    http.get("/api/programs/:id", ({ params }) =>
      params.id === SAVED.id
        ? HttpResponse.json({
            id: SAVED.id,
            program: PULL_DAYS,
            hasRuns: false,
            archived: false,
            ...overrides,
          } satisfies EditableProgram)
        : HttpResponse.json({ message: "No such program." }, { status: 404 }),
    ),
    http.put("/api/programs/:id", async ({ request }) => {
      const body = (await request.json()) as CreateProgram;
      sent.push(body);
      return HttpResponse.json({
        program: { ...SAVED, name: body.name },
        forked: overrides.hasRuns === true,
      });
    }),
  );
  return sent;
}

/** Review's row for a day: "Mon", or "Day 1" when trained in order. */
const reviewDay = (label: string) =>
  within(screen.getByRole("list", { name: "The week" })).getByRole("button", {
    name: new RegExp(`^${label}`),
  });

describe("alternatives on a line (DN-185)", () => {
  const PLANK = fixtures.apiExercise({
    id: "plank",
    name: "Plank",
    movementGroup: null,
  });

  /** Monday: one line naming the chin-up, with Ring row on offer for it. */
  async function writeMondayChinUp() {
    server.use(
      http.get("/api/exercises/chin/alternatives", () =>
        HttpResponse.json({
          main: [fixtures.swapOption({ exerciseId: "ring", name: "Ring row" })],
          harder: [],
          needsEquipment: [],
        }),
      ),
    );
    await toggleDay("Mon");
    await userEvent.click(screen.getByRole("button", { name: /^Next: / }));
    await addMovement("chin", /^Chin-up/);
  }

  it("swaps the line's movement and keeps its scheme", async () => {
    const sent = api();
    renderRoute("/programs/new");

    await userEvent.type(await screen.findByLabelText("Program name"), "Rows");
    await writeMondayChinUp();
    const reps = screen.getByLabelText("Reps");
    await userEvent.clear(reps);
    await userEvent.type(reps, "8");

    await userEvent.click(screen.getByRole("button", { name: "Alternatives" }));
    await userEvent.click(await screen.findByRole("button", { name: /Ring row/ }));
    expect(screen.getByRole("heading", { name: "Ring row" })).toBeInTheDocument();
    await done();
    await goTo("Review");
    await userEvent.click(screen.getByRole("button", { name: "Save program" }));

    await screen.findByRole("link", { name: "+ New program" });
    expect(sent[0].days[0].lines[0]).toMatchObject({
      exerciseId: "ring",
      movementGroup: null,
      sets: uniformSets(3, { reps: 8, repsMax: null, toFailure: false, restSeconds: null }),
    });
  });

  it("marks the movement the line holds among its alternatives", async () => {
    api();
    renderRoute("/programs/new");

    await writeMondayChinUp();
    await userEvent.click(screen.getByRole("button", { name: "Alternatives" }));

    const current = await screen.findByRole("button", { current: true });
    expect(current).toHaveTextContent("Chin-up");
    expect(screen.getByText("ALTERNATIVES")).toBeInTheDocument();
  });

  it("offers no swap on a line that names a whole group", async () => {
    api();
    renderRoute("/programs/new");

    await writeMondayPull();

    expect(screen.getByRole("heading", { name: "Any pull" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Alternatives" })).toBeNull();
  });

  it("offers no swap on a movement with nothing to match on", async () => {
    api();
    server.use(
      http.get("/api/exercises", () => HttpResponse.json([CHIN_UP, RING_ROW, PLANK])),
    );
    renderRoute("/programs/new");

    await toggleDay("Mon");
    await userEvent.click(screen.getByRole("button", { name: /^Next: / }));
    await addMovement("plank", /^Plank/);

    expect(screen.getByRole("heading", { name: "Plank" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Alternatives" })).toBeNull();
  });

  it("shows the alternatives or the search, never both", async () => {
    api();
    renderRoute("/programs/new");

    await writeMondayChinUp();
    await userEvent.click(screen.getByRole("button", { name: "Alternatives" }));
    expect(await screen.findByText("ALTERNATIVES")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Change movement" }));
    expect(screen.getByLabelText("Search movements")).toBeInTheDocument();
    expect(screen.queryByText("ALTERNATIVES")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Alternatives" }));
    expect(screen.queryByLabelText("Search movements")).toBeNull();
  });
});

describe("editing a program (DN-146)", () => {
  it("opens on Review, and saves a change made in Basics", async () => {
    const sent = editing();
    renderRoute(`/programs/${SAVED.id}/edit`);

    expect(await screen.findByRole("heading", { name: "Pull days" })).toBeInTheDocument();
    expect(reviewDay("Day 1")).toHaveTextContent("Any pull");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "EDIT BASICS" }));
    const name = screen.getByLabelText("Program name");
    await userEvent.clear(name);
    await userEvent.type(name, "Pull mornings");
    await goTo("Review");
    await userEvent.click(screen.getByRole("button", { name: "Save program" }));

    await screen.findByRole("link", { name: "+ New program" });
    expect(sent).toEqual([{ ...PULL_DAYS, name: "Pull mornings" }]);
  });

  it("says a rename reaches the people running it", async () => {
    editing({ hasRuns: true });
    renderRoute(`/programs/${SAVED.id}/edit`);

    expect(await screen.findByRole("status")).toHaveTextContent(
      /Renaming it or its days changes it for them too/,
    );
    expect(screen.getByRole("button", { name: "Save program" })).toBeEnabled();
  });

  it("warns before a change to the week saves a new version", async () => {
    const sent = editing({ hasRuns: true });
    renderRoute(`/programs/${SAVED.id}/edit`);

    await screen.findByRole("heading", { name: "Pull days" });
    await userEvent.click(reviewDay("Day 1"));
    await addMovement("chin", /or: any pull/);
    await done();
    await goTo("Review");

    expect(screen.getByRole("status")).toHaveTextContent(
      /saves a new version\. Runs already under way finish on this one/,
    );
    await userEvent.click(screen.getByRole("button", { name: "Save as new version" }));

    await screen.findByRole("link", { name: "+ New program" });
    expect(sent[0].days[0].lines).toHaveLength(2);
  });

  it("names a day in place, without a new version, once someone runs it (DN-155)", async () => {
    const sent = editing({
      hasRuns: true,
      program: {
        ...PULL_DAYS,
        days: [{ ...PULL_DAYS.days[0], label: "Pull" }],
      },
    });
    renderRoute(`/programs/${SAVED.id}/edit`);

    expect(await screen.findByRole("heading", { name: "Pull days" })).toBeInTheDocument();
    expect(reviewDay("Day 1")).toHaveTextContent("Pull");
    await goTo("Day 1");
    const name = screen.getByLabelText("Name for Mon");
    expect(name).toHaveValue("Pull");

    await userEvent.clear(name);
    await userEvent.type(name, "Back and Biceps");
    await goTo("Review");

    expect(screen.getByRole("status")).toHaveTextContent(
      /Renaming it or its days changes it for them too/,
    );
    await userEvent.click(screen.getByRole("button", { name: "Save program" }));

    await screen.findByRole("link", { name: "+ New program" });
    expect(sent[0].days[0]).toMatchObject({ dayOfWeek: 1, label: "Back and Biceps" });
  });

  it("will not save an archived program", async () => {
    editing({ archived: true });
    renderRoute(`/programs/${SAVED.id}/edit`);

    expect(
      await screen.findByText("This program is archived. Restore it before changing it."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save program" })).toBeDisabled();
  });

  it("says so when the program is not the athlete's", async () => {
    editing();
    renderRoute("/programs/someone-elses/edit");

    expect(await screen.findByText("There's no program of yours here.")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Steps" })).not.toBeInTheDocument();
  });
});

describe("Your programs", () => {
  it("lists what the athlete wrote, archived marked", async () => {
    api({
      programs: [SAVED, { ...SAVED, id: "old", name: "Old days", archived: true }],
    });
    renderRoute("/programs");

    expect(await screen.findByText("Pull days")).toBeInTheDocument();
    expect(screen.getByText("ARCHIVED")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "+ New program" })).toHaveAttribute(
      "href",
      "/programs/new",
    );
  });

  it("offers to edit a live program, not an archived one", async () => {
    api({
      programs: [SAVED, { ...SAVED, id: "old", name: "Old days", archived: true }],
    });
    renderRoute("/programs");

    expect(await screen.findByRole("link", { name: "Edit Pull days" })).toHaveAttribute(
      "href",
      "/programs/program-1/edit",
    );
    expect(screen.queryByRole("link", { name: "Edit Old days" })).not.toBeInTheDocument();
  });
});

describe("removing and restoring (DN-147)", () => {
  const OLD: ProgramSummary = { ...SAVED, id: "old", name: "Old days", archived: true };

  /** The list as the server holds it, moved by each archive and restore. */
  function shelf(options: { running?: boolean; restoreRefused?: boolean } = {}) {
    let rows = [SAVED, OLD];
    api();
    server.use(
      http.get("/api/programs", () => HttpResponse.json(rows)),
      http.post("/api/programs/:id/archive", ({ params }) => {
        rows = rows.map((r) => (r.id === params.id ? { ...r, archived: true } : r));
        return HttpResponse.json({
          program: rows.find((r) => r.id === params.id),
          running: options.running === true,
        });
      }),
      http.post("/api/programs/:id/unarchive", ({ params }) => {
        if (options.restoreRefused)
          return HttpResponse.json(
            { message: 'You already have a program called "Old days"' },
            { status: 409 },
          );
        rows = rows.map((r) => (r.id === params.id ? { ...r, archived: false } : r));
        return HttpResponse.json(rows.find((r) => r.id === params.id));
      }),
    );
  }

  it("offers Remove on live programs and Restore on archived ones", async () => {
    shelf();
    renderRoute("/programs");

    expect(await screen.findByRole("button", { name: "Remove Pull days" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Restore Old days" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Remove Old days" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Edit Old days" })).not.toBeInTheDocument();
  });

  it("moves a removed program to the archived section", async () => {
    shelf();
    renderRoute("/programs");

    await userEvent.click(await screen.findByRole("button", { name: "Remove Pull days" }));

    expect(await screen.findByRole("button", { name: "Restore Pull days" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Removed Pull days. Restore it below if you want it back.",
    );
  });

  it("says a run under way on it carries on", async () => {
    shelf({ running: true });
    renderRoute("/programs");

    await userEvent.click(await screen.findByRole("button", { name: "Remove Pull days" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      /Your run of it carries on to its end/,
    );
  });

  it("restores an archived program", async () => {
    shelf();
    renderRoute("/programs");

    await userEvent.click(await screen.findByRole("button", { name: "Restore Old days" }));

    expect(await screen.findByRole("link", { name: "Edit Old days" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Restored Old days.");
  });

  it("says why a restore into a taken name is refused", async () => {
    shelf({ restoreRefused: true });
    renderRoute("/programs");

    await userEvent.click(await screen.findByRole("button", { name: "Restore Old days" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Another of your programs is called Old days now. Rename that one first, then restore this.",
    );
    expect(screen.getByRole("button", { name: "Restore Old days" })).toBeInTheDocument();
  });
});

describe("the global library (DN-148)", () => {
  const JUST_WODS: GlobalProgramSummary = {
    id: "plan_just_wods",
    name: "Just WODs",
    summary: "A workout a day, chosen for you from the whole library.",
    scheduleMode: "flexible",
    days: [0, 1, 2, 3, 4, 5, 6],
    archived: false,
    builtIn: true,
  };
  const SHARED: GlobalProgramSummary = {
    ...SAVED,
    id: "global-1",
    name: "Starter strength",
    builtIn: false,
  };
  const RETIRED: GlobalProgramSummary = {
    ...SHARED,
    id: "global-old",
    name: "Old strength",
    archived: true,
  };
  const TOWEL_ROW = fixtures.apiExercise({
    id: "towel",
    name: "Towel row",
    movementGroup: "pull",
    ownerId: "user_alice",
  });

  /** An admin's view: their own programs, the global list, and every write. */
  function admin() {
    const calls: { method: string; path: string; body: unknown }[] = [];
    const record = async (request: Request) => {
      calls.push({
        method: request.method,
        path: new URL(request.url).pathname,
        body: request.method === "GET" ? null : await request.json().catch(() => null),
      });
    };
    api({ admin: true, programs: [SAVED] });
    server.use(
      http.get("/api/exercises", () => HttpResponse.json([CHIN_UP, RING_ROW, TOWEL_ROW])),
      http.get("/api/admin/programs", () => HttpResponse.json([JUST_WODS, SHARED, RETIRED])),
      http.post("/api/admin/programs", async ({ request }) => {
        await record(request);
        return HttpResponse.json({ ...SHARED, id: "global-new" }, { status: 201 });
      }),
      http.get("/api/admin/programs/:id", () =>
        HttpResponse.json({
          id: SHARED.id,
          program: PULL_DAYS,
          hasRuns: false,
          archived: false,
        } satisfies EditableProgram),
      ),
      http.put("/api/admin/programs/:id", async ({ request }) => {
        await record(request);
        return HttpResponse.json({ program: SHARED, forked: false });
      }),
      http.post("/api/admin/programs/:id/promote", async ({ request }) => {
        await record(request);
        return HttpResponse.json(SAVED);
      }),
    );
    return calls;
  }

  it("shows an athlete neither the global library nor a way to publish", async () => {
    api({ programs: [SAVED] });
    renderRoute("/programs");

    await screen.findByText("Pull days");
    expect(screen.queryByRole("region", { name: "Global library" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Publish Pull days" })).not.toBeInTheDocument();
  });

  it("lets an admin copy a live global program from the global list", async () => {
    admin();
    renderRoute("/programs");

    const library = await screen.findByRole("region", { name: "Global library" });
    expect(
      await within(library).findByRole("link", { name: "Copy Starter strength to your programs" }),
    ).toHaveAttribute("href", "/programs/new?copy=global-1");
    expect(within(library).queryByRole("link", { name: /Copy Just WODs/ })).toBeNull();
    expect(within(library).queryByRole("link", { name: /Copy Old strength/ })).toBeNull();
    expect(screen.queryByRole("region", { name: "From the library" })).toBeNull();
  });

  it("lists the global library for an admin, Just WODs built in and untouchable", async () => {
    admin();
    renderRoute("/programs");

    const library = await screen.findByRole("region", { name: "Global library" });
    const rows = await within(library).findAllByRole("listitem");
    expect(rows.map((r) => within(r).getByText(/WODs|strength/).textContent)).toEqual([
      "Just WODs",
      "Starter strength",
      "Old strength",
    ]);
    expect(within(rows[0]).getByText("Built in")).toBeInTheDocument();
    expect(within(rows[0]).queryByRole("button")).not.toBeInTheDocument();
    expect(within(rows[0]).queryByRole("link")).not.toBeInTheDocument();
    expect(within(rows[1]).getByRole("link", { name: "Edit Starter strength" })).toHaveAttribute(
      "href",
      "/programs/global/global-1/edit",
    );
    expect(within(rows[1]).getByRole("button", { name: "Remove Starter strength" })).toBeEnabled();
    expect(within(rows[2]).getByRole("button", { name: "Restore Old strength" })).toBeEnabled();
  });

  it("publishes one of the admin's own programs only once they confirm", async () => {
    const calls = admin();
    renderRoute("/programs");

    await userEvent.click(await screen.findByRole("button", { name: "Publish Pull days" }));
    expect(screen.getByText(/There's no taking it back/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Keep it mine" }));
    expect(calls).toEqual([]);

    await userEvent.click(screen.getByRole("button", { name: "Publish Pull days" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm publishing Pull days" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Published Pull days. Every athlete is offered it now.",
    );
    expect(calls).toEqual([
      { method: "POST", path: "/api/admin/programs/program-1/promote", body: null },
    ]);
  });

  it("writes a new program to the global library when the admin ticks publish", async () => {
    const calls = admin();
    renderRoute("/programs/new");

    await userEvent.type(await screen.findByLabelText("Program name"), "Starter strength");
    await userEvent.click(screen.getByRole("checkbox", { name: /Publish to the global library/ }));
    await writeMondayPull();
    await done();
    await goTo("Review");
    await userEvent.click(screen.getByRole("button", { name: "Save program" }));

    await screen.findByRole("link", { name: "+ New program" });
    expect(calls).toMatchObject([{ method: "POST", path: "/api/admin/programs" }]);
  });

  it("offers a global program only library movements, and flags one picked before", async () => {
    admin();
    renderRoute("/programs/new");

    await userEvent.type(await screen.findByLabelText("Program name"), "Rows");
    await toggleDay("Mon");
    await userEvent.click(screen.getByRole("button", { name: /^Next: / }));
    await addMovement("towel", /^Towel row/);
    await done();

    await goTo("Basics");
    await userEvent.click(screen.getByRole("checkbox", { name: /Publish to the global library/ }));
    await goTo("Review");

    expect(reviewDay("Day 1")).toHaveTextContent("Towel row");
    expect(screen.getByText("Only you have Towel row; pick a library movement.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save program" })).toBeDisabled();
    expect(screen.getByText(/1 thing to fix before saving/)).toBeInTheDocument();

    // The line already holding it stays a card; the picker adds none.
    await goTo("Day 1");
    expect(screen.getByRole("button", { name: /^Towel row/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "+ Add movement" }));
    await userEvent.type(screen.getByLabelText("Search movements"), "towel");
    expect(screen.getByRole("heading", { name: "No “towel” in the library" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Towel row/ })).toHaveLength(1);
    // A global program names library movements only: no adding one of the admin's own.
    expect(screen.queryByRole("button", { name: /to my movements/ })).not.toBeInTheDocument();
  });

  it("does not offer publishing to an athlete", async () => {
    api();
    renderRoute("/programs/new");
    await screen.findByLabelText("Program name");
    expect(screen.queryByRole("checkbox", { name: /Publish/ })).not.toBeInTheDocument();
  });

  it("edits a global program through the admin route", async () => {
    const calls = admin();
    renderRoute("/programs/global/global-1/edit");

    expect(await screen.findByText(/EVERY ATHLETE IS OFFERED THIS/)).toBeInTheDocument();
    await goTo("Basics");
    expect(screen.queryByRole("checkbox", { name: /Publish/ })).not.toBeInTheDocument();
    const name = screen.getByLabelText("Program name");
    await userEvent.clear(name);
    await userEvent.type(name, "Pull for all");
    await goTo("Review");
    await userEvent.click(screen.getByRole("button", { name: "Save program" }));

    await screen.findByRole("link", { name: "+ New program" });
    expect(calls).toEqual([
      {
        method: "PUT",
        path: "/api/admin/programs/global-1",
        body: { ...PULL_DAYS, name: "Pull for all" },
      },
    ]);
  });

  describe("exporting (DN-150)", () => {
    const FILE: ProgramExport = {
      format: "regimen-works/programs",
      version: 1,
      programs: [{ ...PULL_DAYS, name: "Old strength" }],
    };

    function exporting() {
      const calls = admin();
      server.use(
        http.post("/api/admin/programs/export", async ({ request }) => {
          calls.push({
            method: "POST",
            path: "/api/admin/programs/export",
            body: await request.json(),
          });
          return HttpResponse.json(FILE);
        }),
      );
      return calls;
    }

    it("offers a tick on every global program but Just WODs", async () => {
      exporting();
      renderRoute("/programs");

      const library = await screen.findByRole("region", { name: "Global library" });
      expect(
        await within(library).findByRole("checkbox", {
          name: "Include Starter strength in the export",
        }),
      ).toBeInTheDocument();
      expect(
        within(library).getByRole("checkbox", { name: "Include Old strength in the export" }),
      ).toBeInTheDocument();
      expect(within(library).queryByRole("checkbox", { name: /Just WODs/ })).toBeNull();
      expect(
        within(library).getByRole("button", { name: "Tick programs to export" }),
      ).toBeDisabled();
    });

    it("exports the ticked programs, archived included, as one saved file", async () => {
      const calls = exporting();
      vi.mocked(saveJson).mockClear();
      renderRoute("/programs");

      const library = await screen.findByRole("region", { name: "Global library" });
      await userEvent.click(
        await within(library).findByRole("checkbox", {
          name: "Include Old strength in the export",
        }),
      );
      await userEvent.click(within(library).getByRole("button", { name: "Export 1 program" }));

      await vi.waitFor(() => expect(saveJson).toHaveBeenCalledOnce());
      expect(vi.mocked(saveJson).mock.calls[0]).toEqual([
        expect.stringMatching(/^regimen-works-programs-\d{4}-\d{2}-\d{2}\.json$/),
        FILE,
      ]);
      expect(calls).toContainEqual({
        method: "POST",
        path: "/api/admin/programs/export",
        body: { ids: ["global-old"] },
      });
      expect(
        within(library).getByRole("checkbox", { name: "Include Old strength in the export" }),
      ).not.toBeChecked();
    });

    it("shows no export to an athlete", async () => {
      api({ programs: [SAVED] });
      renderRoute("/programs");

      await screen.findByText("Pull days");
      expect(screen.queryByRole("checkbox")).toBeNull();
      expect(screen.queryByRole("button", { name: /export/i })).toBeNull();
    });
  });
});

describe("copying a global program (DN-149)", () => {
  const STARTER: ProgramSummary = {
    ...SAVED,
    id: "global-1",
    name: "Starter strength",
  };
  const STARTER_PROGRAM: CreateProgram = { ...PULL_DAYS, name: STARTER.name };

  function library() {
    const sent = api({ library: [STARTER] });
    server.use(
      http.get("/api/programs/library/:id", ({ params }) =>
        params.id === STARTER.id
          ? HttpResponse.json(STARTER_PROGRAM)
          : HttpResponse.json({ message: "No such program." }, { status: 404 }),
      ),
    );
    return sent;
  }

  it("offers an athlete the library's programs to copy", async () => {
    library();
    renderRoute("/programs");

    const offered = await screen.findByRole("region", { name: "From the library" });
    expect(within(offered).getByText("Starter strength")).toBeInTheDocument();
    expect(
      within(offered).getByRole("link", { name: "Copy Starter strength to your programs" }),
    ).toHaveAttribute("href", "/programs/new?copy=global-1");
  });

  it("opens the original on Review and saves it as the athlete's own", async () => {
    const sent = library();
    renderRoute("/programs/new?copy=global-1");

    expect(
      await screen.findByRole("heading", { name: "Starter strength (copy)" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(
      "Copied from Starter strength in the library",
    );
    expect(reviewDay("Day 1")).toHaveTextContent("Any pull");

    await userEvent.click(screen.getByRole("button", { name: "Save program" }));

    await screen.findByRole("link", { name: "+ New program" });
    expect(sent).toEqual([{ ...PULL_DAYS, name: "Starter strength (copy)" }]);
  });

  it("keeps an admin's copy their own, with no way to publish it from the wizard", async () => {
    library();
    server.use(
      http.get("/api/me", () =>
        HttpResponse.json({
          id: "admin_root",
          isAdmin: true,
          onboardedAt: "2026-09-01T00:00:00.000Z",
        }),
      ),
    );
    renderRoute("/programs/new?copy=global-1");

    await screen.findByRole("heading", { name: "Starter strength (copy)" });
    await goTo("Basics");
    expect(
      screen.queryByRole("checkbox", { name: /Publish to the global library/ }),
    ).not.toBeInTheDocument();
  });

  it("says so when the program is no longer in the library", async () => {
    library();
    renderRoute("/programs/new?copy=gone");

    expect(
      await screen.findByText("That program isn't in the library any more."),
    ).toBeInTheDocument();
  });
});

describe("from the setup wizard", () => {
  it("opens the editor from Build your own and comes back with the program chosen", async () => {
    api({ onboarded: false });
    renderRoute("/setup");

    await userEvent.click(await screen.findByRole("button", { name: "Begin" }));
    await userEvent.click(screen.getByRole("button", { name: "Next: your program" }));
    await userEvent.click(screen.getByRole("link", { name: /Build your own/ }));

    await userEvent.type(await screen.findByLabelText("Program name"), "Pull days");
    await writeMondayPull();
    await done();
    await goTo("Review");
    await userEvent.click(screen.getByRole("button", { name: "Save program" }));

    const chosen = await screen.findByRole("button", { name: /Pull days/ });
    expect(chosen).toHaveAttribute("aria-pressed", "true");
  });

  it.each([
    ["saving", "Save program"],
    ["cancelling", "← CANCEL"],
  ])("keeps the kit the athlete answered when %s the editor (DN-195)", async (_, leave) => {
    api({ onboarded: false });
    renderRoute("/setup");

    await userEvent.click(await screen.findByRole("button", { name: "Begin" }));
    await userEvent.click(screen.getByRole("button", { name: /Nothing/ }));
    await userEvent.click(screen.getByRole("button", { name: "Next: your program" }));
    await userEvent.click(screen.getByRole("link", { name: /Build your own/ }));

    if (leave === "Save program") {
      await userEvent.type(await screen.findByLabelText("Program name"), "Pull days");
      await writeMondayPull();
      await done();
      await goTo("Review");
      await userEvent.click(screen.getByRole("button", { name: leave }));
    } else {
      await userEvent.click(await screen.findByRole("link", { name: leave }));
    }

    // Back on the picker, not on welcome, and the kit still says nothing.
    expect(await screen.findByRole("heading", { name: "Pick your program" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("checkbox", { name: /pull-up bar/i })).not.toBeChecked();
  });
});
