import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import type { MovementVolume } from "@regimen-works/shared";
import { renderRoute } from "../test/renderRoute";
import { server, http, HttpResponse } from "../test/server";
import * as fixtures from "../test/fixtures";

vi.mock("@clerk/clerk-react", async () => {
  const { clerkTestDouble } = await import("../test/clerk");
  return clerkTestDouble();
});

/**
 * What the completion card says on a prescribed day (DN-22).
 *
 * The card has always been a record rather than a verdict, and this keeps it
 * one while giving it something specific to say: two sets of numbers that both
 * happened, and which way the total moved between them. `stats.spec.ts` pins
 * how the comparison is worked out; this is the wording it comes out as, and
 * the days it stays quiet on.
 */

const ID = fixtures.ASSIGNMENT_ID;

function volume(sessions: MovementVolume["sessions"]): MovementVolume {
  return { exerciseId: "chin-up", name: "Chin-up", unit: "reps", sessions };
}

/** Today's session and last week's, as the API would answer them. */
function twoSessions(today: number[], before: number[]): MovementVolume {
  return volume([
    { date: "2026-09-16", assignmentId: ID, sets: today },
    { date: "2026-09-09", assignmentId: "assignment-0", sets: before },
  ]);
}

/** A just-finished prescribed day, with `volumes` behind it. */
function finishingAStrengthDay(volumes: MovementVolume[]) {
  const day = fixtures.today();
  server.use(
    http.get("/api/today", () =>
      HttpResponse.json({
        ...day,
        assignment: {
          ...day.assignment!,
          wod: null,
          prescription: { movements: [fixtures.prescribedMovement()] },
          status: "completed",
          session: fixtures.session({
            capSeconds: null,
            autoStopAtCap: false,
            status: "completed",
            movements: [],
            setsCompleted: 3,
          }),
        },
      }),
    ),
    http.get("/api/movement-volume", () => HttpResponse.json(volumes)),
  );
}

describe("the completion card on a prescribed day", () => {
  it("quotes today's sets against the last time the movement was trained", async () => {
    finishingAStrengthDay([twoSessions([3, 3, 3], [3, 3, 2])]);

    renderRoute(`/log/${ID}`);

    expect(await screen.findByText("Chin-up — 3, 3, 3, up from 3, 3, 2 last time.")).toBeInTheDocument();
  });

  it("says a smaller session was smaller, and says nothing more about it", async () => {
    // A record, not a grade (DN-88): the day after a hard one is information.
    finishingAStrengthDay([twoSessions([3, 2, 2], [3, 3, 3])]);

    renderRoute(`/log/${ID}`);

    expect(await screen.findByText("Chin-up — 3, 2, 2, down from 3, 3, 3 last time.")).toBeInTheDocument();
  });

  it("names an equal total as equal while still quoting both", async () => {
    finishingAStrengthDay([twoSessions([3, 3, 2], [2, 3, 3])]);

    renderRoute(`/log/${ID}`);

    expect(
      await screen.findByText("Chin-up — 3, 3, 2, the same total as 2, 3, 3 last time."),
    ).toBeInTheDocument();
  });

  it("states the session on its own the first time a movement is trained", async () => {
    finishingAStrengthDay([volume([{ date: "2026-09-16", assignmentId: ID, sets: [3, 3, 3] }])]);

    renderRoute(`/log/${ID}`);

    expect(await screen.findByText("Chin-up — 3, 3, 3.")).toBeInTheDocument();
  });

  it("speaks for each movement the session held", async () => {
    finishingAStrengthDay([
      twoSessions([3, 3, 3], [3, 3, 2]),
      {
        exerciseId: "push-up",
        name: "Push-up",
        unit: "reps",
        sessions: [
          { date: "2026-09-16", assignmentId: ID, sets: [8, 8] },
          { date: "2026-09-09", assignmentId: "assignment-0", sets: [8, 6] },
        ],
      },
    ]);

    renderRoute(`/log/${ID}`);

    expect(await screen.findByText("Chin-up — 3, 3, 3, up from 3, 3, 2 last time.")).toBeInTheDocument();
    expect(screen.getByText("Push-up — 8, 8, up from 8, 6 last time.")).toBeInTheDocument();
  });

  it("says nothing about movements this session did not train", async () => {
    finishingAStrengthDay([
      volume([{ date: "2026-09-09", assignmentId: "assignment-0", sets: [3, 3] }]),
    ]);

    renderRoute(`/log/${ID}`);

    // The card still fires -- it is about the session, not the movements.
    expect(await screen.findByText("WORKOUT DONE")).toBeInTheDocument();
    expect(screen.queryByText(/Chin-up —/)).not.toBeInTheDocument();
  });

  it("stays a plain finish on a WOD day, and does not go looking", async () => {
    // Not asked for at all rather than asked for and ignored: a WOD day has
    // no prescribed movements, so every set in the answer would belong to
    // some other day.
    let asked = 0;
    server.use(
      http.get("/api/movement-volume", () => {
        asked += 1;
        return HttpResponse.json([]);
      }),
    );

    renderRoute(`/log/${ID}`);

    expect(await screen.findByText("WORKOUT DONE")).toBeInTheDocument();
    expect(screen.queryByText(/—.*last time/)).not.toBeInTheDocument();
    expect(asked).toBe(0);
  });
});
