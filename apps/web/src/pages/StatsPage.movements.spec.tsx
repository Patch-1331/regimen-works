import { describe, expect, it, vi } from "vitest";
import type { MovementHistory } from "@regimen-works/shared";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderRoute } from "../test/renderRoute";
import { server, http, HttpResponse } from "../test/server";
import * as fixtures from "../test/fixtures";

/**
 * The movement panel, once it can say what has actually been trained (DN-96).
 *
 * DN-91 made this card say what the athlete has *chosen*. This is the other
 * half: what has been happening. Driven through the real page because what
 * changed is what the card shows — `movementHistory.spec.ts` already pins how
 * the runs are worked out.
 */

vi.mock("@clerk/clerk-react", async () => {
  const { clerkTestDouble } = await import("../test/clerk");
  return clerkTestDouble();
});

const chinUp = fixtures.apiExercise({
  id: "chin-up",
  name: "Chin-up",
  line: "pull",
  rung: 1,
});
const negative = fixtures.apiExercise({
  id: "negative",
  name: "Negative chin-up",
  line: "pull",
  rung: 0,
});

function history(overrides: Partial<MovementHistory>[] = []): MovementHistory[] {
  return overrides.map((movement) => ({
    exerciseId: "chin-up",
    name: "Chin-up",
    line: "pull",
    unit: "reps",
    sessions: 1,
    total: 30,
    firstTrained: "2026-09-14",
    lastTrained: "2026-09-14",
    days: [
      {
        date: "2026-09-14",
        wodName: "Cindy",
        reps: 30,
        isSwapped: false,
        prescribedName: null,
        prescribedReason: null,
      },
    ],
    ...movement,
  }));
}

/** The pull line, chosen at chin-ups, with whatever history the test wants. */
function statsShowing(movements: MovementHistory[]) {
  server.use(
    http.get("/api/exercises", () => HttpResponse.json([negative, chinUp])),
    http.get("/api/skill-levels", () =>
      HttpResponse.json([fixtures.skillLevel({ line: "pull", rung: 1 })]),
    ),
    http.get("/api/movement-history", () => HttpResponse.json(movements)),
  );
}

describe("the movement panel history", () => {
  it("says what has been trained, under what was chosen", async () => {
    statsShowing(
      history([
        {
          days: [
            { date: "2026-09-14", wodName: "Cindy", reps: 30, isSwapped: false, prescribedName: null, prescribedReason: null },
            { date: "2026-09-05", wodName: "Cindy", reps: 30, isSwapped: false, prescribedName: null, prescribedReason: null },
          ],
        },
      ]),
    );
    renderRoute("/stats");

    // The chosen movement, and then the training behind it.
    expect(await screen.findByText("Chin-up")).toBeInTheDocument();
    expect(await screen.findByText(/Chin-up 2× since/)).toBeInTheDocument();
  });

  it("names what came before the movement they are on now", async () => {
    statsShowing([
      ...history([{ days: [{ date: "2026-09-14", wodName: "Cindy", reps: 30, isSwapped: false, prescribedName: null, prescribedReason: null }] }]),
      ...history([
        {
          exerciseId: "negative",
          name: "Negative chin-up",
          days: [{ date: "2026-08-20", wodName: "Cindy", reps: 30, isSwapped: false, prescribedName: null, prescribedReason: null }],
        },
      ]),
    ]);
    renderRoute("/stats");

    expect(
      await screen.findByText(/Negative chin-up before that/),
    ).toBeInTheDocument();
  });

  it("stays quiet about a line that has never been trained", async () => {
    // Not "0 sessions" — a count of nothing reads as a mark against someone
    // for a movement group they may not have met yet.
    statsShowing([]);
    renderRoute("/stats");

    await screen.findByText("Chin-up");
    expect(screen.queryByText(/since/)).not.toBeInTheDocument();
    expect(screen.queryByText("TRAINED")).not.toBeInTheDocument();
  });

  it("lists the runs when the card is opened", async () => {
    statsShowing(
      history([
        {
          days: [
            { date: "2026-09-14", wodName: "Cindy", reps: 30, isSwapped: false, prescribedName: null, prescribedReason: null },
            { date: "2026-09-05", wodName: "Cindy", reps: 30, isSwapped: false, prescribedName: null, prescribedReason: null },
          ],
        },
      ]),
    );
    renderRoute("/stats");

    // Collapsed, the card summarises; the run list belongs to the expansion,
    // next to the movements it is about.
    await screen.findByText(/Chin-up 2× since/);
    expect(screen.queryByText("TRAINED")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Pull/ }));

    expect(screen.getByText("TRAINED")).toBeInTheDocument();
    expect(screen.getByText(/2× ·/)).toBeInTheDocument();
  });

  it("keeps the panel up when the history has not arrived", async () => {
    // The card exists to say what was chosen; the history is an addition to
    // it. A slow or failed second request must not take the card with it.
    server.use(
      http.get("/api/exercises", () => HttpResponse.json([negative, chinUp])),
      http.get("/api/skill-levels", () =>
        HttpResponse.json([fixtures.skillLevel({ line: "pull", rung: 1 })]),
      ),
      http.get("/api/movement-history", () => new HttpResponse(null, { status: 500 })),
    );
    renderRoute("/stats");

    expect(await screen.findByText("Chin-up")).toBeInTheDocument();
  });
});
