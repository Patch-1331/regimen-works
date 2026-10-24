import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  DEFAULT_PROGRAM_ID,
  addIsoDays,
  type CommitSetup,
  type ProgramRun,
  type ProgramSummary,
} from "@regimen-works/shared";
import { renderRoute } from "../test/renderRoute";
import { server, http, HttpResponse } from "../test/server";
import * as fixtures from "../test/fixtures";
import { localIsoDate } from "../lib/weekdays";
import { formatStartDate } from "../lib/setup";

vi.mock("@clerk/clerk-react", async () => {
  const { clerkTestDouble } = await import("../test/clerk");
  return clerkTestDouble();
});

/**
 * Starting a program from the Programs tab (DN-180): the wizard's own steps
 * from the one after the picker, against the same `POST /setup`. The steps
 * themselves are pinned in SetupPage.spec.tsx; this is the way in, what the
 * confirm step says, and the two ways out.
 */

const TODAY = localIsoDate();

const MINE: ProgramSummary = {
  id: "program-pull-days",
  name: "Pull days",
  summary: "Your program, 3 days a week",
  scheduleMode: "flexible",
  days: [1, 3, 5],
  archived: false,
};
const ARCHIVED: ProgramSummary = {
  ...MINE,
  id: "program-old",
  name: "Old block",
  archived: true,
};
const LIBRARY: ProgramSummary = {
  ...MINE,
  id: "program-pull-up-builder",
  name: "Pull-Up Builder",
  summary: "Your first chin-up, six weeks.",
};

/** Foundations under way, at week 2 of 6. */
const MID_RUN = fixtures.programRun({ week: 2 });
const ON_JUST_WODS = fixtures.programRun({
  programId: DEFAULT_PROGRAM_ID,
  programName: "Just WODs",
  totalWeeks: null,
});

/** An onboarded athlete with `current` under way; returns what was committed. */
function athlete(
  current: ProgramRun | null,
  setup: Partial<ReturnType<typeof fixtures.setupOptions>> = {},
) {
  const sent: CommitSetup[] = [];
  server.use(
    http.get("/api/programs/runs", () =>
      HttpResponse.json({ current, past: [] }),
    ),
    http.get("/api/programs/library", () => HttpResponse.json([LIBRARY])),
    http.get("/api/programs", () => HttpResponse.json([MINE, ARCHIVED])),
    http.get("/api/setup", () =>
      HttpResponse.json(
        fixtures.setupOptions({
          programs: [
            fixtures.setupProgram(),
            fixtures.boundedProgram(),
            fixtures.setupProgram({
              id: MINE.id,
              name: MINE.name,
              summary: MINE.summary,
              minDaysPerWeek: 3,
              maxDaysPerWeek: 3,
              defaultDays: [1, 3, 5],
            }),
          ],
          earliestStartDate: TODAY,
          latestStartDate: addIsoDays(TODAY, 20),
          ...setup,
        }),
      ),
    ),
    http.post("/api/setup", async ({ request }) => {
      sent.push((await request.json()) as CommitSetup);
      return HttpResponse.json({ onboardedAt: "2026-09-01T09:00:00.000Z" });
    }),
  );
  return sent;
}

const click = async (name: string | RegExp) =>
  userEvent.click(await screen.findByRole("button", { name }));

/** Programs, Start on `name`, then on through days and start date to confirm. */
async function startToConfirm(name: string) {
  renderRoute("/programs");
  await userEvent.click(
    await screen.findByRole("link", { name: `Start ${name}` }),
  );
  await click("Continue");
  await click("Continue");
}

async function region(name: string) {
  return within(await screen.findByRole("region", { name }));
}

describe("Start on the Programs tab", () => {
  it("is on Just WODs, your live programs and the library", async () => {
    athlete(MID_RUN);
    renderRoute("/programs");

    for (const name of ["Just WODs", "Pull days", "Pull-Up Builder"]) {
      expect(
        await screen.findByRole("link", { name: `Start ${name}` }),
      ).toHaveAttribute(
        "href",
        expect.stringMatching(/^\/programs\/[^/]+\/start$/),
      );
    }
  });

  it("is not on an archived program", async () => {
    athlete(MID_RUN);
    renderRoute("/programs");

    await screen.findByRole("link", { name: "Start Pull days" });
    expect(
      screen.queryByRole("link", { name: "Start Old block" }),
    ).not.toBeInTheDocument();
  });

  it("is not on the program already running", async () => {
    athlete(fixtures.programRun({ programId: MINE.id, programName: MINE.name }));
    renderRoute("/programs");

    const yours = await region("Your programs");
    await yours.findByRole("link", { name: "Edit Pull days" });
    expect(
      yours.queryByRole("link", { name: "Start Pull days" }),
    ).not.toBeInTheDocument();
  });

  it("is not on Just WODs while it is what the athlete is on", async () => {
    athlete(ON_JUST_WODS);
    renderRoute("/programs");

    await screen.findByRole("link", { name: "Start Pull days" });
    expect(
      screen.queryByRole("link", { name: "Start Just WODs" }),
    ).not.toBeInTheDocument();
  });
});

describe("starting a program from Programs", () => {
  it("opens on the days, with the program already chosen", async () => {
    athlete(MID_RUN);
    renderRoute("/programs");

    await userEvent.click(
      await screen.findByRole("link", { name: "Start Pull-Up Builder" }),
    );

    expect(
      await screen.findByRole("heading", { name: "Which days do you train?" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Pull-Up Builder is written as 6 weeks/)).toBeInTheDocument();
    // Nothing behind this step to go back to: Programs is where it came from.
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
  });

  it("names the run it ends on the confirm step", async () => {
    athlete(MID_RUN);
    await startToConfirm("Pull-Up Builder");

    expect(
      await screen.findByRole("heading", { name: "Start Pull-Up Builder" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "This ends Foundations at week 2 of 6. What you've trained stays in your history.",
      ),
    ).toBeInTheDocument();
  });

  it("names the program it ends when the athlete goes back to Just WODs", async () => {
    athlete(MID_RUN);
    await startToConfirm("Just WODs");

    expect(
      await screen.findByText(/^This ends Foundations at week 2 of 6\./),
    ).toBeInTheDocument();
  });

  it("says it ends nothing when the athlete is on Just WODs", async () => {
    athlete(ON_JUST_WODS);
    await startToConfirm("Pull-Up Builder");

    await screen.findByRole("heading", { name: "Start Pull-Up Builder" });
    expect(screen.queryByText(/^This ends/)).not.toBeInTheDocument();
  });

  it("does not offer today once today has been trained", async () => {
    // The API moves the earliest start to tomorrow (DN-178); the step offers
    // exactly what it is given.
    athlete(MID_RUN, { earliestStartDate: addIsoDays(TODAY, 1) });
    renderRoute("/programs");
    await userEvent.click(
      await screen.findByRole("link", { name: "Start Pull-Up Builder" }),
    );
    await click("Continue");

    expect(
      await screen.findByText(
        "Today's already under way, so the earliest start is tomorrow.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: formatStartDate(TODAY) }),
    ).not.toBeInTheDocument();
  });

  it("starts it through setup and lands on Today", async () => {
    const sent = athlete(MID_RUN);
    await startToConfirm("Pull-Up Builder");

    await click("Start Pull-Up Builder");

    expect(
      await screen.findByRole("heading", { name: "Fran" }),
    ).toBeInTheDocument();
    expect(sent).toEqual([
      {
        programId: "program-pull-up-builder",
        trainingDays: [1, 3, 5],
        weeks: 6,
        startDate: TODAY,
        defaultRestSeconds: null,
      },
    ]);
  });

  it("neither asks for kit nor saves any (DN-195)", async () => {
    // The athlete's kit was set before they ever reached Programs; this
    // start has no answer to it and must not overwrite the one they gave.
    let settingsWrites = 0;
    const sent = athlete(MID_RUN);
    server.use(
      http.patch("/api/settings", () => {
        settingsWrites += 1;
        return HttpResponse.json(fixtures.settings());
      }),
    );
    await startToConfirm("Pull-Up Builder");
    expect(
      screen.queryByRole("heading", { name: "What do you have to train with?" }),
    ).not.toBeInTheDocument();

    await click("Start Pull-Up Builder");

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(settingsWrites).toBe(0);
  });

  it.each([
    ["the days", 0],
    ["the start date", 1],
    ["the confirm step", 2],
  ])("cancels from %s back to Programs, writing nothing", async (_, steps) => {
    const sent = athlete(MID_RUN);
    renderRoute("/programs");
    await userEvent.click(
      await screen.findByRole("link", { name: "Start Pull-Up Builder" }),
    );
    for (let i = 0; i < steps; i += 1) await click("Continue");

    await click("Cancel");

    expect(
      await screen.findByRole("heading", { name: "Programs" }),
    ).toBeInTheDocument();
    expect(sent).toEqual([]);
  });

  it("goes back to Programs for a program that cannot be started", async () => {
    athlete(MID_RUN);
    renderRoute(`/programs/${ARCHIVED.id}/start`);

    expect(
      await screen.findByRole("heading", { name: "Programs" }),
    ).toBeInTheDocument();
  });
});
