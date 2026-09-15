import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderRoute } from "../../test/renderRoute";
import { server, http, HttpResponse } from "../../test/server";
import * as fixtures from "../../test/fixtures";

vi.mock("@clerk/clerk-react", async () => {
  const { clerkTestDouble } = await import("../../test/clerk");
  return clerkTestDouble();
});

/**
 * Which runner a WOD gets, and that it mounts (DN-104).
 *
 * `ActiveWorkoutPage` picks by format: EMOM and Tabata get the auto-advancing
 * interval countdown, AMRAP and For Time the round-tap stopwatch. A runner
 * that fails to mount is a blank screen mid-workout, and until now nothing
 * caught it — `IntervalWorkout.tsx` is 485 lines and was the least covered
 * file in this workspace.
 *
 * Covered here rather than in the browser suite (DN-72) on purpose. The
 * scheduler assigns one WOD per athlete per day, so reaching the interval
 * runner there means overwriting today's assignment — a suite that otherwise
 * only drives what a person would, reaching behind the UI to set up. And what
 * the browser suite exists to catch is integration breakage; a runner not
 * mounting is not that.
 */

const ID = fixtures.ASSIGNMENT_ID;

/** Today, with a WOD of the shape the runner under test needs. */
function todayWith(wod: Partial<ReturnType<typeof fixtures.wod>>) {
  const day = fixtures.today();
  server.use(
    http.get("/api/today", () =>
      HttpResponse.json({
        ...day,
        assignment: { ...day.assignment!, wod: fixtures.wod(wod) },
      }),
    ),
  );
}

describe("the round-tap runner", () => {
  it("runs a For Time WOD", async () => {
    todayWith({ type: "for_time", name: "Fran" });

    renderRoute(`/workout/${ID}`);

    expect(await screen.findByText("ROUND COMPLETE")).toBeInTheDocument();
    expect(screen.queryByText("START INTERVALS")).not.toBeInTheDocument();
  });

  it("runs an AMRAP", async () => {
    todayWith({ type: "amrap", name: "Cindy", rounds: null });

    renderRoute(`/workout/${ID}`);

    expect(await screen.findByText("ROUND COMPLETE")).toBeInTheDocument();
  });
});

describe("the interval runner", () => {
  it("runs an EMOM on the structure the WOD prescribes", async () => {
    todayWith({
      type: "emom",
      name: "Chelsea",
      rounds: null,
      workSeconds: 60,
      restSeconds: 0,
      intervalCount: 10,
    });

    renderRoute(`/workout/${ID}`);

    expect(await screen.findByText("START INTERVALS")).toBeInTheDocument();
    // No rest, so the header names the work length alone.
    expect(screen.getByText(/CHELSEA · EMOM 60 · CUES ON/)).toBeInTheDocument();
    expect(screen.queryByText("ROUND COMPLETE")).not.toBeInTheDocument();
  });

  it("runs a Tabata on its 20/10 structure", async () => {
    todayWith({
      type: "tabata",
      name: "Tabata This",
      rounds: null,
      workSeconds: 20,
      restSeconds: 10,
      intervalCount: 8,
    });

    renderRoute(`/workout/${ID}`);

    expect(await screen.findByText("START INTERVALS")).toBeInTheDocument();
    expect(screen.getByText(/TABATA 20\/10 · CUES ON/)).toBeInTheDocument();
  });

  it("still mounts an EMOM row that predates the interval columns", async () => {
    // Feature #30 added workSeconds/restSeconds/intervalCount; a row seeded
    // before them, or written by hand as "emom, 12 minutes", has to fall back
    // to the format's classic structure rather than refusing to start. A wrong
    // fallback does not throw — it runs the athlete through the wrong number
    // of intervals.
    todayWith({
      type: "emom",
      name: "Legacy",
      timeCapMinutes: 12,
      rounds: null,
      workSeconds: null,
      restSeconds: null,
      intervalCount: null,
    });

    renderRoute(`/workout/${ID}`);

    expect(await screen.findByText("START INTERVALS")).toBeInTheDocument();
    expect(screen.getByText(/LEGACY · EMOM 60 · CUES ON/)).toBeInTheDocument();
  });

  it("starts the sequence on the START tap", async () => {
    // The sequence is anchored to that tap, not to the session's start, so
    // nothing counts down until the server has recorded an interval origin.
    // The API is stubbed statefully here for exactly that reason: the screen
    // reads where it is from the session, not from local state.
    const user = userEvent.setup();
    const wod = fixtures.wod({
      type: "emom",
      name: "Chelsea",
      rounds: null,
      workSeconds: 60,
      restSeconds: 0,
      intervalCount: 10,
    });
    let started = false;
    const runningSession = fixtures.session({
      // Five seconds into the first interval, so the countdown has somewhere
      // to be without depending on when the test happens to run.
      startedAt: new Date(Date.now() - 5_000).toISOString(),
      intervalIndex: 0,
      intervalStartedAtSeconds: 0,
    });
    const day = fixtures.today();
    server.use(
      http.get("/api/today", () =>
        HttpResponse.json({
          ...day,
          assignment: {
            ...day.assignment!,
            wod,
            session: started ? runningSession : null,
          },
        }),
      ),
      http.post("/api/assignments/:assignmentId/session/interval", () => {
        started = true;
        return HttpResponse.json(runningSession);
      }),
    );

    renderRoute(`/workout/${ID}`);
    await screen.findByText("START INTERVALS");

    await user.click(screen.getByText("START INTERVALS"));

    expect(await screen.findByText("WORK")).toBeInTheDocument();
    expect(screen.getByText("INTERVAL 1 / 10")).toBeInTheDocument();
  });
});
