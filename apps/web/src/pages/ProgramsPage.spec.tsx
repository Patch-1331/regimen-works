import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import {
  DEFAULT_PROGRAM_ID,
  type ProgramRun,
  type ProgramSummary,
} from "@regimen-works/shared";
import { renderRoute } from "../test/renderRoute";
import { server, http, HttpResponse } from "../test/server";
import * as fixtures from "../test/fixtures";

vi.mock("@clerk/clerk-react", async () => {
  const { clerkTestDouble } = await import("../test/clerk");
  return clerkTestDouble();
});

/**
 * The Programs tab (DN-179): the run under way, Just WODs pinned, your
 * programs, the library, and the runs before this one. What is in each list
 * and what each row offers is DN-145 to DN-150's, and pinned in
 * ProgramEditorPage.spec.tsx; this is the tab's own shape.
 */

const MINE: ProgramSummary = {
  id: "program-1",
  name: "Pull days",
  summary: "Your program, 1 day a week",
  scheduleMode: "flexible",
  days: [1],
  archived: false,
};

const GLOBAL: ProgramSummary = {
  ...MINE,
  id: "global-1",
  name: "Pull-Up Builder",
  summary: "Your first chin-up, six weeks.",
};

function serve(
  runs: { current?: ProgramRun | null; past?: ProgramRun[] } = {},
) {
  server.use(
    http.get("/api/programs/runs", () =>
      HttpResponse.json({ current: runs.current ?? null, past: runs.past ?? [] }),
    ),
    http.get("/api/programs/library", () => HttpResponse.json([GLOBAL])),
    http.get("/api/programs", () => HttpResponse.json([MINE])),
  );
}

async function region(name: string) {
  return within(await screen.findByRole("region", { name }));
}

describe("the Programs tab", () => {
  it("sits between Library and Settings in the tab bar", async () => {
    serve();
    renderRoute("/programs");

    const tabs = within(
      await screen.findByRole("navigation", { name: "Tabs" }),
    ).getAllByRole("link");
    expect(tabs.map((t) => t.textContent)).toEqual([
      "TODAY",
      "HISTORY",
      "STATS",
      "LIBRARY",
      "PROGRAMS",
      "SETTINGS",
    ]);
    expect(tabs[4]).toHaveAttribute("href", "/programs");
  });

  it("lays the sections out top to bottom", async () => {
    serve({ past: [fixtures.programRun({ status: "ended", week: 2 })] });
    renderRoute("/programs");

    expect(
      await screen.findByRole("heading", { name: "Programs" }),
    ).toBeInTheDocument();
    await screen.findByRole("region", { name: "No program" });
    await screen.findByRole("region", { name: "From the library" });
    expect(screen.getAllByRole("region").map((r) => r.ariaLabel)).toEqual([
      "Current run",
      "No program",
      "Your programs",
      "From the library",
      "Past runs",
    ]);
    // Writing or pasting one in sits after the library, before the past.
    const newProgram = screen.getByRole("link", { name: "+ New program" });
    expect(newProgram).toHaveAttribute("href", "/programs/new");
    expect(
      screen.getByRole("link", { name: "Or paste a program in" }),
    ).toHaveAttribute("href", "/programs/paste");
    expect(
      screen
        .getByRole("region", { name: "From the library" })
        .compareDocumentPosition(newProgram) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe("the current run", () => {
  it("names the program, its week and what it is", async () => {
    serve({ current: fixtures.programRun() });
    renderRoute("/programs");

    const current = await region("Current run");
    expect(await current.findByText("Foundations")).toBeInTheDocument();
    expect(current.getByText("Week 3 of 6")).toBeInTheDocument();
    expect(current.getByText("Six weeks of the basics.")).toBeInTheDocument();
  });

  it("counts an open-ended run without a length", async () => {
    serve({ current: fixtures.programRun({ totalWeeks: null, week: 12 }) });
    renderRoute("/programs");

    expect(
      await (await region("Current run")).findByText("Week 12"),
    ).toBeInTheDocument();
  });

  it("says plainly that Just WODs is no program", async () => {
    serve({
      current: fixtures.programRun({
        programId: DEFAULT_PROGRAM_ID,
        programName: "Just WODs",
        programSummary: "A workout a day, picked for you.",
        totalWeeks: null,
        week: 40,
      }),
    });
    renderRoute("/programs");

    const current = await region("Current run");
    expect(
      await current.findByText(/No program is driving your week/),
    ).toBeInTheDocument();
    expect(current.queryByText(/Week/)).not.toBeInTheDocument();
    expect(
      (await region("No program")).getByText("What you're on now"),
    ).toBeInTheDocument();
  });

  it("says when nothing is running at all", async () => {
    serve();
    renderRoute("/programs");

    expect(
      await (await region("Current run")).findByText(/Nothing is running/),
    ).toBeInTheDocument();
  });
});

describe("Just WODs, pinned", () => {
  it("is offered as the no-program choice, in its own words", async () => {
    serve({ current: fixtures.programRun() });
    renderRoute("/programs");

    const pinned = await region("No program");
    expect(pinned.getByText("Just WODs")).toBeInTheDocument();
    expect(
      pinned.getByText("A workout a day, picked for you."),
    ).toBeInTheDocument();
    // Not what they are on, so not marked as it.
    expect(pinned.queryByText("What you're on now")).not.toBeInTheDocument();
  });
});

describe("your programs and the library", () => {
  it("lists the athlete's own with edit and remove", async () => {
    serve();
    renderRoute("/programs");

    const mine = await region("Your programs");
    expect(await mine.findByText("Pull days")).toBeInTheDocument();
    expect(mine.getByRole("link", { name: "Edit Pull days" })).toHaveAttribute(
      "href",
      "/programs/program-1/edit",
    );
    expect(
      mine.getByRole("button", { name: "Remove Pull days" }),
    ).toBeInTheDocument();
  });

  it("offers the library's programs to copy into the athlete's own", async () => {
    serve();
    renderRoute("/programs");

    const library = await region("From the library");
    expect(
      library.getByRole("link", { name: "Copy Pull-Up Builder to your programs" }),
    ).toHaveAttribute("href", "/programs/new?copy=global-1");
  });
});

describe("past runs", () => {
  it("lists finished and ended runs as the API orders them, newest first", async () => {
    serve({
      past: [
        fixtures.programRun({
          enrollmentId: "ended",
          status: "ended",
          week: 2,
          finishedAt: "2026-09-23T10:00:00.000Z",
        }),
        fixtures.programRun({
          enrollmentId: "finished",
          programName: "Pull-Up Builder",
          status: "completed",
          week: 6,
          finishedAt: "2026-08-01T10:00:00.000Z",
        }),
      ],
    });
    renderRoute("/programs");

    const past = await region("Past runs");
    const rows = past.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Foundations");
    expect(rows[0]).toHaveTextContent("ended at week 2 of 6");
    expect(rows[1]).toHaveTextContent("Pull-Up Builder");
    expect(rows[1]).toHaveTextContent("finished, 6 weeks");
  });

  it("says when there are none yet", async () => {
    serve();
    renderRoute("/programs");

    expect(
      await (await region("Past runs")).findByText("Nothing finished or ended yet."),
    ).toBeInTheDocument();
  });

  it("says so when the runs cannot be read", async () => {
    serve();
    server.use(
      http.get("/api/programs/runs", () =>
        HttpResponse.json({ message: "down" }, { status: 500 }),
      ),
    );
    renderRoute("/programs");

    expect(
      await screen.findByText("Couldn't load your runs."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Past runs" }),
    ).not.toBeInTheDocument();
  });
});

describe("the old paths", () => {
  it.each(["/library/programs", "/library/routines"])(
    "sends %s to Programs",
    async (path) => {
      serve();
      renderRoute(path);

      expect(
        await screen.findByRole("heading", { name: "Programs" }),
      ).toBeInTheDocument();
    },
  );

  it("keeps the rest of the path and the query string", async () => {
    serve();
    renderRoute("/library/routines/new?from=setup");

    // The editor, and still knowing it came from the wizard.
    expect(
      await screen.findByRole("link", { name: "← CANCEL" }),
    ).toHaveAttribute("href", "/setup");
  });
});

describe("the library, without programs", () => {
  it("has two sections, movements and workouts", async () => {
    renderRoute("/library/wods");

    const nav = await screen.findByRole("navigation", {
      name: "Library sections",
    });
    expect(
      within(nav)
        .getAllByRole("link")
        .map((l) => l.textContent),
    ).toEqual(["Movements", "Workouts"]);
  });
});
