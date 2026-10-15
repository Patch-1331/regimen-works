import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PROGRAM_ID,
  type TodayProgram,
  type TodayResponse,
} from "@regimen-works/shared";
import { screen } from "@testing-library/react";
import { renderRoute } from "../test/renderRoute";
import { server, http, HttpResponse } from "../test/server";
import * as fixtures from "../test/fixtures";

/**
 * What Today says about the program the athlete is on (DN-16).
 *
 * Two facts the screen has to get right, and both are about restraint. Just
 * WODs is a real enrollment that nobody chose, so naming it would invent a
 * program the athlete never signed up for. And a flexible program defers to
 * the athlete's own training days, so calling a day they took off "planned
 * rest" would have the app taking credit for their decision.
 */

vi.mock("@clerk/clerk-react", async () => {
  const { clerkTestDouble } = await import("../test/clerk");
  return clerkTestDouble();
});

// 2026-09-16 is a Wednesday — day 3 of a Monday-first program week.
const WEDNESDAY = "2026-09-16";

function todayIs(overrides: Partial<TodayResponse>) {
  server.use(
    http.get("/api/today", () =>
      HttpResponse.json(fixtures.today({ date: WEDNESDAY, ...overrides })),
    ),
  );
}

describe("the program strip", () => {
  it("names the program, the week and the day", async () => {
    todayIs({ program: fixtures.todayProgram() });

    renderRoute("/");

    expect(
      await screen.findByText(/PULL-UP BUILDER · WK 2\/6 · D 3/),
    ).toBeInTheDocument();
  });

  it("numbers the day Monday-first, so Sunday closes the week", async () => {
    // 2026-09-20 is a Sunday: day 7 of the program week, not day 0. The
    // weekday numbering the API works in is Sunday-first, and a Wednesday
    // cannot tell the two apart -- this is the day that can.
    todayIs({ date: "2026-09-20", program: fixtures.todayProgram() });

    renderRoute("/");

    expect(await screen.findByText(/WK 2\/6 · D 7/)).toBeInTheDocument();
  });

  it("drops the total on an open-ended program, which has no second half", async () => {
    todayIs({ program: fixtures.todayProgram({ totalWeeks: null }) });

    renderRoute("/");

    expect(await screen.findByText(/WK 2 · D 3/)).toBeInTheDocument();
  });

  it("adds the authored week's label, which is the part worth knowing early", async () => {
    todayIs({ program: fixtures.todayProgram({ weekLabel: "Deload" }) });

    renderRoute("/");

    expect(await screen.findByText(/· DELOAD/)).toBeInTheDocument();
  });

  it("adds the day's own name, when the program gave it one (DN-155)", async () => {
    todayIs({
      program: fixtures.todayProgram({ weekLabel: "Deload", dayLabel: "Chest and Triceps" }),
    });

    renderRoute("/");

    expect(
      await screen.findByText(/· DELOAD · CHEST AND TRICEPS$/),
    ).toBeInTheDocument();
  });

  it("says nothing for an athlete on Just WODs", async () => {
    // A real enrollment, and deliberately not a program: it is the absence of
    // programming, so a strip naming it would be describing a choice the
    // athlete never made.
    todayIs({
      program: fixtures.todayProgram({ programId: DEFAULT_PROGRAM_ID, name: "Just WODs" }),
    });

    renderRoute("/");

    expect(
      await screen.findByRole("heading", { level: 1 }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/JUST WODS/)).not.toBeInTheDocument();
    expect(screen.queryByText(/WK /)).not.toBeInTheDocument();
  });

  it("says nothing for an athlete on no program at all", async () => {
    todayIs({ program: null });

    renderRoute("/");

    expect(
      await screen.findByRole("heading", { level: 1 }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/WK /)).not.toBeInTheDocument();
  });
});

describe("the rest-day copy", () => {
  function restingWith(program: TodayProgram | null) {
    todayIs({
      isRestDay: true,
      assignment: null,
      warmup: null,
      cooldown: null,
      program,
    });
  }

  it("says the program planned it, when the program planned it", async () => {
    restingWith(fixtures.todayProgram({ slotKind: "rest" }));

    renderRoute("/");

    expect(
      await screen.findByText(
        /Planned rest — week 2, day 3 of Pull-Up Builder/,
      ),
    ).toBeInTheDocument();
  });

  it("does not claim a day the athlete took off", async () => {
    // A flexible program defers to the athlete's training days, and reports a
    // null slot kind on a day they did not pick. The program is still shown
    // above the plate; it just is not credited with the rest.
    restingWith(fixtures.todayProgram({ slotKind: null }));

    renderRoute("/");

    expect(
      await screen.findByText(/isn't one of your training days/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Planned rest/)).not.toBeInTheDocument();
  });

  it("no longer claims the week's training days are used up", async () => {
    // The old copy was a leftover of the day-quota scheduler DN-12 removed:
    // rest is a property of the date now, so "already used" described a rule
    // the app had stopped having.
    restingWith(null);

    renderRoute("/");

    expect(
      await screen.findByText(/isn't one of your training days/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/already used/)).not.toBeInTheDocument();
  });
});
