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
 * Writing a program (DN-145): the week sheet, "Your programs", and the way in
 * from the setup wizard.
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

/** Monday: add a line, and pick "any pull" beneath the chin-up. */
async function writeMondayPull() {
  const monday = await screen.findByRole("region", { name: "Mon" });
  await userEvent.click(within(monday).getByRole("button", { name: "+ ADD MOVEMENT" }));
  await userEvent.type(within(monday).getByLabelText("Search movements"), "chin");
  await userEvent.click(
    await within(monday).findByRole("button", { name: /or: any pull/ }),
  );
}

describe("the week sheet", () => {
  it("refuses to save until the program is named and has a day", async () => {
    api();
    renderRoute("/library/programs/new");

    const save = await screen.findByRole("button", { name: "Save program" });
    expect(save).toBeDisabled();
    expect(screen.getByText(/2 things to fix before saving/)).toBeInTheDocument();
  });

  it("shows every weekday, empty ones as rest", async () => {
    api();
    renderRoute("/library/programs/new");

    for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) {
      expect(await screen.findByRole("region", { name: day })).toBeInTheDocument();
    }
    expect(screen.getAllByText("Rest")).toHaveLength(7);
  });

  it("saves a program and lists it", async () => {
    const sent = api();
    renderRoute("/library/programs/new");

    await userEvent.type(await screen.findByLabelText("Program name"), "Pull days");
    await writeMondayPull();
    await userEvent.click(screen.getByRole("button", { name: "Save program" }));

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
                sets: 3,
                reps: 10,
                repsMax: null,
                toFailure: false,
                restSeconds: null,
              },
            ],
          },
        ],
      },
    ]);
  });

  it("names a specific exercise when one is picked", async () => {
    const sent = api();
    renderRoute("/library/programs/new");

    await userEvent.type(await screen.findByLabelText("Program name"), "Rows");
    const monday = await screen.findByRole("region", { name: "Mon" });
    await userEvent.click(within(monday).getByRole("button", { name: "+ ADD MOVEMENT" }));
    await userEvent.type(within(monday).getByLabelText("Search movements"), "ring");
    await userEvent.click(within(monday).getByRole("button", { name: /^Ring row/ }));
    await userEvent.click(screen.getByRole("button", { name: /On these weekdays/ }));
    await userEvent.click(screen.getByRole("button", { name: "Save program" }));

    await screen.findByRole("link", { name: "+ New program" });
    expect(sent[0]).toMatchObject({ scheduleMode: "fixed" });
    expect(sent[0].days[0].lines[0]).toMatchObject({
      exerciseId: "ring",
      movementGroup: null,
    });
  });

  it("copies a day to another weekday", async () => {
    api();
    renderRoute("/library/programs/new");

    await writeMondayPull();
    const monday = screen.getByRole("region", { name: "Mon" });
    await userEvent.click(within(monday).getByRole("button", { name: "COPY TO…" }));
    await userEvent.click(within(monday).getByRole("button", { name: "Thu" }));

    const thursday = screen.getByRole("region", { name: "Thu" });
    expect(within(thursday).getByText("Any pull")).toBeInTheDocument();
    expect(within(thursday).queryByText("Rest")).not.toBeInTheDocument();
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
          sets: 3,
          reps: 10,
          repsMax: null,
          toFailure: false,
          restSeconds: null,
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

describe("editing a program (DN-146)", () => {
  it("loads the saved program into the sheet and saves it back", async () => {
    const sent = editing();
    renderRoute(`/library/programs/${SAVED.id}/edit`);

    const name = await screen.findByLabelText("Program name");
    expect(name).toHaveValue("Pull days");
    expect(
      within(screen.getByRole("region", { name: "Mon" })).getByText("Any pull"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    await userEvent.clear(name);
    await userEvent.type(name, "Pull mornings");
    await userEvent.click(screen.getByRole("button", { name: "Save program" }));

    await screen.findByRole("link", { name: "+ New program" });
    expect(sent).toEqual([{ ...PULL_DAYS, name: "Pull mornings" }]);
  });

  it("says a rename reaches the people running it", async () => {
    editing({ hasRuns: true });
    renderRoute(`/library/programs/${SAVED.id}/edit`);

    expect(await screen.findByRole("status")).toHaveTextContent(
      /Renaming it or its days changes it for them too/,
    );
    expect(screen.getByRole("button", { name: "Save program" })).toBeEnabled();
  });

  it("warns before a change to the week saves a new version", async () => {
    const sent = editing({ hasRuns: true });
    renderRoute(`/library/programs/${SAVED.id}/edit`);

    await writeMondayPull();

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
    renderRoute(`/library/programs/${SAVED.id}/edit`);

    const name = await screen.findByLabelText("Name for Mon");
    expect(name).toHaveValue("Pull");
    expect(screen.queryByLabelText("Name for Tue")).not.toBeInTheDocument();

    await userEvent.clear(name);
    await userEvent.type(name, "Back and Biceps");

    expect(screen.getByRole("status")).toHaveTextContent(
      /Renaming it or its days changes it for them too/,
    );
    await userEvent.click(screen.getByRole("button", { name: "Save program" }));

    await screen.findByRole("link", { name: "+ New program" });
    expect(sent[0].days[0]).toMatchObject({ dayOfWeek: 1, label: "Back and Biceps" });
  });

  it("will not save an archived program", async () => {
    editing({ archived: true });
    renderRoute(`/library/programs/${SAVED.id}/edit`);

    expect(
      await screen.findByText("This program is archived. Restore it before changing it."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save program" })).toBeDisabled();
  });

  it("says so when the program is not the athlete's", async () => {
    editing();
    renderRoute("/library/programs/someone-elses/edit");

    expect(await screen.findByText("There's no program of yours here.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Program name")).not.toBeInTheDocument();
  });
});

describe("Your programs", () => {
  it("lists what the athlete wrote, archived marked", async () => {
    api({
      programs: [SAVED, { ...SAVED, id: "old", name: "Old days", archived: true }],
    });
    renderRoute("/library/programs");

    expect(await screen.findByText("Pull days")).toBeInTheDocument();
    expect(screen.getByText("ARCHIVED")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "+ New program" })).toHaveAttribute(
      "href",
      "/library/programs/new",
    );
  });

  it("offers to edit a live program, not an archived one", async () => {
    api({
      programs: [SAVED, { ...SAVED, id: "old", name: "Old days", archived: true }],
    });
    renderRoute("/library/programs");

    expect(await screen.findByRole("link", { name: "Edit Pull days" })).toHaveAttribute(
      "href",
      "/library/programs/program-1/edit",
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
    renderRoute("/library/programs");

    expect(await screen.findByRole("button", { name: "Remove Pull days" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Restore Old days" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Remove Old days" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Edit Old days" })).not.toBeInTheDocument();
  });

  it("moves a removed program to the archived section", async () => {
    shelf();
    renderRoute("/library/programs");

    await userEvent.click(await screen.findByRole("button", { name: "Remove Pull days" }));

    expect(await screen.findByRole("button", { name: "Restore Pull days" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Removed Pull days. Restore it below if you want it back.",
    );
  });

  it("says a run under way on it carries on", async () => {
    shelf({ running: true });
    renderRoute("/library/programs");

    await userEvent.click(await screen.findByRole("button", { name: "Remove Pull days" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      /Your run of it carries on to its end/,
    );
  });

  it("restores an archived program", async () => {
    shelf();
    renderRoute("/library/programs");

    await userEvent.click(await screen.findByRole("button", { name: "Restore Old days" }));

    expect(await screen.findByRole("link", { name: "Edit Old days" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Restored Old days.");
  });

  it("says why a restore into a taken name is refused", async () => {
    shelf({ restoreRefused: true });
    renderRoute("/library/programs");

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
    renderRoute("/library/programs");

    await screen.findByText("Pull days");
    expect(screen.queryByRole("region", { name: "Global library" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Publish Pull days" })).not.toBeInTheDocument();
  });

  it("lets an admin copy a live global program from the global list", async () => {
    admin();
    renderRoute("/library/programs");

    const library = await screen.findByRole("region", { name: "Global library" });
    expect(
      await within(library).findByRole("link", { name: "Copy Starter strength to your programs" }),
    ).toHaveAttribute("href", "/library/programs/new?copy=global-1");
    expect(within(library).queryByRole("link", { name: /Copy Just WODs/ })).toBeNull();
    expect(within(library).queryByRole("link", { name: /Copy Old strength/ })).toBeNull();
    expect(screen.queryByRole("region", { name: "From the library" })).toBeNull();
  });

  it("lists the global library for an admin, Just WODs built in and untouchable", async () => {
    admin();
    renderRoute("/library/programs");

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
      "/library/programs/global/global-1/edit",
    );
    expect(within(rows[1]).getByRole("button", { name: "Remove Starter strength" })).toBeEnabled();
    expect(within(rows[2]).getByRole("button", { name: "Restore Old strength" })).toBeEnabled();
  });

  it("publishes one of the admin's own programs only once they confirm", async () => {
    const calls = admin();
    renderRoute("/library/programs");

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
    renderRoute("/library/programs/new");

    await userEvent.type(await screen.findByLabelText("Program name"), "Starter strength");
    await userEvent.click(screen.getByRole("checkbox", { name: /Publish to the global library/ }));
    await writeMondayPull();
    await userEvent.click(screen.getByRole("button", { name: "Save program" }));

    await screen.findByRole("link", { name: "+ New program" });
    expect(calls).toMatchObject([{ method: "POST", path: "/api/admin/programs" }]);
  });

  it("offers a global program only library movements, and flags one picked before", async () => {
    admin();
    renderRoute("/library/programs/new");

    await userEvent.type(await screen.findByLabelText("Program name"), "Rows");
    const monday = await screen.findByRole("region", { name: "Mon" });
    await userEvent.click(within(monday).getByRole("button", { name: "+ ADD MOVEMENT" }));
    await userEvent.type(within(monday).getByLabelText("Search movements"), "towel");
    await userEvent.click(within(monday).getByRole("button", { name: /^Towel row/ }));

    await userEvent.click(screen.getByRole("checkbox", { name: /Publish to the global library/ }));

    expect(within(monday).getByText("Towel row")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save program" })).toBeDisabled();
    expect(screen.getByText(/1 thing to fix before saving/)).toBeInTheDocument();

    // The line already holding it stays a button; the picker adds none.
    const holding = within(monday).getAllByRole("button", { name: /^Towel row/ }).length;
    await userEvent.click(within(monday).getByRole("button", { name: "+ ADD MOVEMENT" }));
    await userEvent.type(within(monday).getByLabelText("Search movements"), "towel");
    expect(within(monday).getByText(/Nothing in the library is/)).toBeInTheDocument();
    expect(within(monday).getAllByRole("button", { name: /^Towel row/ })).toHaveLength(holding);
  });

  it("does not offer publishing to an athlete", async () => {
    api();
    renderRoute("/library/programs/new");
    await screen.findByLabelText("Program name");
    expect(screen.queryByRole("checkbox", { name: /Publish/ })).not.toBeInTheDocument();
  });

  it("edits a global program through the admin route", async () => {
    const calls = admin();
    renderRoute("/library/programs/global/global-1/edit");

    const name = await screen.findByLabelText("Program name");
    expect(screen.getByText(/EVERY ATHLETE IS OFFERED THIS/)).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /Publish/ })).not.toBeInTheDocument();
    await userEvent.clear(name);
    await userEvent.type(name, "Pull for all");
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
      renderRoute("/library/programs");

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
      renderRoute("/library/programs");

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
      renderRoute("/library/programs");

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
    renderRoute("/library/programs");

    const offered = await screen.findByRole("region", { name: "From the library" });
    expect(within(offered).getByText("Starter strength")).toBeInTheDocument();
    expect(
      within(offered).getByRole("link", { name: "Copy Starter strength to your programs" }),
    ).toHaveAttribute("href", "/library/programs/new?copy=global-1");
  });

  it("fills the sheet from the original and saves it as the athlete's own", async () => {
    const sent = library();
    renderRoute("/library/programs/new?copy=global-1");

    expect(await screen.findByLabelText("Program name")).toHaveValue(
      "Starter strength (copy)",
    );
    expect(screen.getByRole("note")).toHaveTextContent(
      "Copied from Starter strength in the library",
    );
    const monday = screen.getByRole("region", { name: "Mon" });
    expect(within(monday).getByText("Any pull")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Save program" }));

    await screen.findByRole("link", { name: "+ New program" });
    expect(sent).toEqual([{ ...PULL_DAYS, name: "Starter strength (copy)" }]);
  });

  it("keeps an admin's copy their own, with no way to publish it from the sheet", async () => {
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
    renderRoute("/library/programs/new?copy=global-1");

    await screen.findByLabelText("Program name");
    expect(
      screen.queryByRole("checkbox", { name: /Publish to the global library/ }),
    ).not.toBeInTheDocument();
  });

  it("says so when the program is no longer in the library", async () => {
    library();
    renderRoute("/library/programs/new?copy=gone");

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
    await userEvent.click(screen.getByRole("link", { name: /Build your own/ }));

    await userEvent.type(await screen.findByLabelText("Program name"), "Pull days");
    await writeMondayPull();
    await userEvent.click(screen.getByRole("button", { name: "Save program" }));

    const chosen = await screen.findByRole("button", { name: /Pull days/ });
    expect(chosen).toHaveAttribute("aria-pressed", "true");
  });
});
