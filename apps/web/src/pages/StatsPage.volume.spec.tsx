import { describe, expect, it, vi } from "vitest";
import type { MovementVolume } from "@regimen-works/shared";
import { screen } from "@testing-library/react";
import { renderRoute } from "../test/renderRoute";
import { server, http, HttpResponse } from "../test/server";

/**
 * Movement volume in Stats, from the sets that were actually recorded (DN-22).
 *
 * Driven through the real page because what is being checked is that the
 * section reaches the screen at all — `stats.spec.ts` pins how the totals and
 * the ordering are worked out, and this is the wiring around them.
 */

vi.mock("@clerk/clerk-react", async () => {
  const { clerkTestDouble } = await import("../test/clerk");
  return clerkTestDouble();
});

function serveVolume(volumes: MovementVolume[]) {
  server.use(http.get("/api/movement-volume", () => HttpResponse.json(volumes)));
}

const chinUp: MovementVolume = {
  exerciseId: "chin-up",
  name: "Chin-up",
  unit: "reps",
  sessions: [
    { date: "2026-09-14", assignmentId: "a-2", sets: [3, 3, 3] },
    { date: "2026-09-07", assignmentId: "a-1", sets: [3, 3, 2] },
  ],
};

describe("Stats, movement volume", () => {
  it("charts a movement that has been trained more than once", async () => {
    serveVolume([chinUp]);

    await renderRoute("/stats");

    expect(await screen.findByLabelText("Volume trend for Chin-up")).toBeInTheDocument();
  });

  it("says where the movement started and where it is now", async () => {
    serveVolume([chinUp]);

    await renderRoute("/stats");

    // The totals, not the set lists: the caption is the chart's axis in words.
    expect(await screen.findByText("8 reps")).toBeInTheDocument();
    expect(screen.getByText("9 reps")).toBeInTheDocument();
  });

  it("reads a hold in the unit it was done in", async () => {
    // Seconds of a hold and reps of a pull-up are not the same quantity,
    // which is why each movement gets its own card.
    serveVolume([
      {
        exerciseId: "hollow-hold",
        name: "Hollow hold",
        unit: "seconds",
        sessions: [
          { date: "2026-09-14", assignmentId: "a-2", sets: [40] },
          { date: "2026-09-07", assignmentId: "a-1", sets: [30] },
        ],
      },
    ]);

    await renderRoute("/stats");

    expect(await screen.findByText("40 seconds")).toBeInTheDocument();
    expect(screen.getByText("30 seconds")).toBeInTheDocument();
  });

  it("asks for a second session rather than charting one", async () => {
    serveVolume([{ ...chinUp, sessions: [chinUp.sessions[0]] }]);

    await renderRoute("/stats");

    expect(
      await screen.findByText(/Train a prescribed movement on more than one day/),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Volume trend for Chin-up")).not.toBeInTheDocument();
  });

  it("says so when no prescribed movement has been recorded", async () => {
    await renderRoute("/stats");

    expect(
      await screen.findByText(/Train a prescribed movement on more than one day/),
    ).toBeInTheDocument();
  });
});
