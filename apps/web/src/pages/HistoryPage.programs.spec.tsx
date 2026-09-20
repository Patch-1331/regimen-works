import { describe, expect, it, vi } from "vitest";
import type { CompletedProgram } from "@regimen-works/shared";
import { screen } from "@testing-library/react";
import { renderRoute } from "../test/renderRoute";
import { server, http, HttpResponse } from "../test/server";
import * as fixtures from "../test/fixtures";

/**
 * The programs the athlete has finished, on History (DN-18).
 *
 * The record, as opposed to the prompt: the card above Today is dismissible
 * and shows one program once, and this list is permanent and shows all of
 * them. Which is why the assertions below care most about the two never being
 * confused -- a dismissed card must still have a row here.
 */

vi.mock("@clerk/clerk-react", async () => {
  const { clerkTestDouble } = await import("../test/clerk");
  return clerkTestDouble();
});

function completedAre(programs: CompletedProgram[]) {
  server.use(
    http.get("/api/programs/completed", () => HttpResponse.json(programs)),
  );
}

describe("programs completed", () => {
  it("names each finished program and what it came to", async () => {
    completedAre([fixtures.completedProgram()]);

    renderRoute("/history");

    expect(await screen.findByText("PROGRAMS COMPLETED")).toBeInTheDocument();
    expect(screen.getByText("Pull-Up Builder")).toBeInTheDocument();
    expect(
      screen.getByText("6 weeks · 24 sessions · pull: Negative chin-up → Chin-up"),
    ).toBeInTheDocument();
  });

  it("lists them in the order the API sends, most recent first", async () => {
    completedAre([
      fixtures.completedProgram({
        enrollmentId: "e2",
        planName: "Bar Muscle-Up",
      }),
      fixtures.completedProgram({ enrollmentId: "e1" }),
    ]);

    renderRoute("/history");

    const names = (await screen.findAllByText(/Bar Muscle-Up|Pull-Up Builder/)).map(
      (el) => el.textContent,
    );
    expect(names).toEqual(["Bar Muscle-Up", "Pull-Up Builder"]);
  });

  it("says nothing at all when no program has been finished", async () => {
    // Which is every athlete until the day one ends. An empty heading is a
    // reminder of nothing.
    completedAre([]);

    renderRoute("/history");

    await screen.findByRole("heading", { name: /history/i });
    expect(screen.queryByText("PROGRAMS COMPLETED")).not.toBeInTheDocument();
  });

  it("still lists the workout log underneath", async () => {
    completedAre([fixtures.completedProgram()]);

    renderRoute("/history");

    expect(await screen.findByText("PROGRAMS COMPLETED")).toBeInTheDocument();
    expect(screen.getByText("Fran")).toBeInTheDocument();
  });

  it("reads sensibly for a program nobody trained", async () => {
    completedAre([
      fixtures.completedProgram({
        summary: { weeks: 6, sessions: 0, rungChanges: [] },
      }),
    ]);

    renderRoute("/history");

    expect(await screen.findByText("6 weeks · 0 sessions")).toBeInTheDocument();
  });
});
