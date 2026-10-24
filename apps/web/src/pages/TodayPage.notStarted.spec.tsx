import { describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { TodayResponse } from "@regimen-works/shared";
import { screen } from "@testing-library/react";
import { renderRoute } from "../test/renderRoute";
import { server, http, HttpResponse } from "../test/server";
import * as fixtures from "../test/fixtures";

/**
 * Today before the program's start date (DN-200): the wait is the day, and
 * the athlete can end it by starting now.
 */

vi.mock("@clerk/clerk-react", async () => {
  const { clerkTestDouble } = await import("../test/clerk");
  return clerkTestDouble();
});

// A Saturday, two days before `notStartedProgram()` starts on Monday 09-21.
const SATURDAY = "2026-09-19";

function waiting(overrides: Partial<TodayResponse> = {}): TodayResponse {
  return fixtures.today({
    date: SATURDAY,
    isRestDay: true,
    assignment: null,
    warmup: null,
    cooldown: null,
    program: fixtures.notStartedProgram(),
    ...overrides,
  });
}

function todayIs(day: TodayResponse) {
  server.use(http.get("/api/today", () => HttpResponse.json(day)));
}

describe("a program that has not started", () => {
  it("says how long to go, when it starts and which days were picked", async () => {
    todayIs(waiting());

    renderRoute("/");

    expect(await screen.findByText("2 DAYS TO GO")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: /Foundations starts Monday/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("You picked Mon · Wed · Fri. Nothing to do today."),
    ).toBeInTheDocument();
    // Not a rest day: nothing is owed on a day the athlete chose not to start.
    expect(screen.queryByText("Rest day")).not.toBeInTheDocument();
  });

  it("shows the first session, its size and roughly how long it takes", async () => {
    todayIs(waiting());

    renderRoute("/");

    expect(await screen.findByText("MON 21 SEP · FIRST UP")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Full body A" })).toBeInTheDocument();
    expect(screen.getByText("5 movements · about 35 minutes")).toBeInTheDocument();
  });

  it("says tomorrow rather than a weekday the day before", async () => {
    todayIs(waiting({ date: "2026-09-20" }));

    renderRoute("/");

    expect(await screen.findByText("1 DAY TO GO")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: /starts tomorrow/ }),
    ).toBeInTheDocument();
  });

  it("does not invent a name or a size for a WOD picked on the day", async () => {
    todayIs(
      waiting({
        program: fixtures.notStartedProgram({
          firstSession: {
            date: "2026-09-21",
            name: null,
            slotKind: "wod_generated",
            movementCount: null,
            minutes: 20,
          },
        }),
      }),
    );

    renderRoute("/");

    expect(
      await screen.findByRole("heading", { name: "A WOD picked on the day" }),
    ).toBeInTheDocument();
    expect(screen.getByText("about 20 minutes")).toBeInTheDocument();
  });

  it("starts the program today and shows day one", async () => {
    let started = false;
    server.use(
      http.get("/api/today", () => HttpResponse.json(waiting())),
      http.post("/api/today/start-program", () => {
        started = true;
        return HttpResponse.json(
          fixtures.today({
            date: SATURDAY,
            program: fixtures.todayProgram({
              name: "Foundations",
              week: 1,
              totalWeeks: 6,
            }),
          }),
        );
      }),
    );

    renderRoute("/");
    await userEvent.click(
      await screen.findByRole("button", { name: /START TODAY INSTEAD/ }),
    );

    expect(started).toBe(true);
    expect(await screen.findByText(/FOUNDATIONS · WK 1\/6 · D 6/)).toBeInTheDocument();
    expect(screen.queryByText(/DAYS TO GO/)).not.toBeInTheDocument();
  });

  it("says why when today can no longer be day one", async () => {
    server.use(
      http.get("/api/today", () => HttpResponse.json(waiting())),
      http.post("/api/today/start-program", () =>
        HttpResponse.json(
          {
            message:
              "Today's workout is already under way, so the earliest you can start is tomorrow.",
          },
          { status: 400 },
        ),
      ),
    );

    renderRoute("/");
    await userEvent.click(
      await screen.findByRole("button", { name: /START TODAY INSTEAD/ }),
    );

    expect(
      await screen.findByText(/the earliest you can start is tomorrow/),
    ).toBeInTheDocument();
  });

  it("opens the program in Programs", async () => {
    todayIs(waiting());

    renderRoute("/");
    await userEvent.click(
      await screen.findByRole("button", { name: "LOOK THROUGH THE PROGRAM" }),
    );

    expect(
      await screen.findByRole("link", { name: "PROGRAMS", current: "page" }),
    ).toBeInTheDocument();
  });

  it("leaves a day already under way to be finished", async () => {
    // An assignment from before the athlete chose the program: still theirs.
    todayIs(waiting({ isRestDay: false, assignment: fixtures.today().assignment }));

    renderRoute("/");

    expect(await screen.findByRole("heading", { level: 1 })).not.toHaveTextContent(
      /starts/,
    );
    expect(screen.queryByText(/DAYS TO GO/)).not.toBeInTheDocument();
  });
});
