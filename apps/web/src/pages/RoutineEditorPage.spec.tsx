import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CreateRoutine, RoutineSummary } from "@regimen-works/shared";
import { renderRoute } from "../test/renderRoute";
import { server, http, HttpResponse } from "../test/server";
import * as fixtures from "../test/fixtures";

vi.mock("@clerk/clerk-react", async () => {
  const { clerkTestDouble } = await import("../test/clerk");
  return clerkTestDouble();
});

/**
 * Writing a routine (DN-145): the week sheet, "My routines", and the way in
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

const SAVED: RoutineSummary = {
  id: "routine-1",
  name: "Pull days",
  summary: "Your routine, 1 day a week",
  scheduleMode: "flexible",
  days: [1],
  archived: false,
};

function api(options: { onboarded?: boolean; routines?: RoutineSummary[] } = {}) {
  const sent: CreateRoutine[] = [];
  let saved = false;
  server.use(
    http.get("/api/me", () =>
      HttpResponse.json({
        id: "user_alice",
        isAdmin: false,
        onboardedAt: options.onboarded === false ? null : "2026-09-01T00:00:00.000Z",
      }),
    ),
    http.get("/api/exercises", () => HttpResponse.json([CHIN_UP, RING_ROW])),
    http.get("/api/routines", () =>
      HttpResponse.json(options.routines ?? (saved ? [SAVED] : [])),
    ),
    http.post("/api/routines", async ({ request }) => {
      sent.push((await request.json()) as CreateRoutine);
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
  it("refuses to save until the routine is named and has a day", async () => {
    api();
    renderRoute("/library/routines/new");

    const save = await screen.findByRole("button", { name: "Save routine" });
    expect(save).toBeDisabled();
    expect(screen.getByText(/2 things to fix before saving/)).toBeInTheDocument();
  });

  it("shows every weekday, empty ones as rest", async () => {
    api();
    renderRoute("/library/routines/new");

    for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) {
      expect(await screen.findByRole("region", { name: day })).toBeInTheDocument();
    }
    expect(screen.getAllByText("Rest")).toHaveLength(7);
  });

  it("saves a routine and lists it", async () => {
    const sent = api();
    renderRoute("/library/routines/new");

    await userEvent.type(await screen.findByLabelText("Routine name"), "Pull days");
    await writeMondayPull();
    await userEvent.click(screen.getByRole("button", { name: "Save routine" }));

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
    renderRoute("/library/routines/new");

    await userEvent.type(await screen.findByLabelText("Routine name"), "Rows");
    const monday = await screen.findByRole("region", { name: "Mon" });
    await userEvent.click(within(monday).getByRole("button", { name: "+ ADD MOVEMENT" }));
    await userEvent.type(within(monday).getByLabelText("Search movements"), "ring");
    await userEvent.click(within(monday).getByRole("button", { name: /^Ring row/ }));
    await userEvent.click(screen.getByRole("button", { name: /On these weekdays/ }));
    await userEvent.click(screen.getByRole("button", { name: "Save routine" }));

    await screen.findByRole("link", { name: "+ New routine" });
    expect(sent[0]).toMatchObject({ scheduleMode: "fixed" });
    expect(sent[0].days[0].lines[0]).toMatchObject({
      exerciseId: "ring",
      movementGroup: null,
    });
  });

  it("copies a day to another weekday", async () => {
    api();
    renderRoute("/library/routines/new");

    await writeMondayPull();
    const monday = screen.getByRole("region", { name: "Mon" });
    await userEvent.click(within(monday).getByRole("button", { name: "COPY TO…" }));
    await userEvent.click(within(monday).getByRole("button", { name: "Thu" }));

    const thursday = screen.getByRole("region", { name: "Thu" });
    expect(within(thursday).getByText("Any pull")).toBeInTheDocument();
    expect(within(thursday).queryByText("Rest")).not.toBeInTheDocument();
  });
});

describe("My routines", () => {
  it("lists what the athlete wrote, archived marked", async () => {
    api({
      routines: [SAVED, { ...SAVED, id: "old", name: "Old days", archived: true }],
    });
    renderRoute("/library/routines");

    expect(await screen.findByText("Pull days")).toBeInTheDocument();
    expect(screen.getByText("ARCHIVED")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "+ New routine" })).toHaveAttribute(
      "href",
      "/library/routines/new",
    );
  });
});

describe("from the setup wizard", () => {
  it("opens the editor from Build your own and comes back with the routine chosen", async () => {
    api({ onboarded: false });
    renderRoute("/setup");

    await userEvent.click(await screen.findByRole("button", { name: "Begin" }));
    await userEvent.click(screen.getByRole("link", { name: /Build your own/ }));

    await userEvent.type(await screen.findByLabelText("Routine name"), "Pull days");
    await writeMondayPull();
    await userEvent.click(screen.getByRole("button", { name: "Save routine" }));

    const chosen = await screen.findByRole("button", { name: /Pull days/ });
    expect(chosen).toHaveAttribute("aria-pressed", "true");
  });
});
