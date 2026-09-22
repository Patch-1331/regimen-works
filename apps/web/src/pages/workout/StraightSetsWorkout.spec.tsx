import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LogSet, WorkoutSession } from "@regimen-works/shared";
import { renderRoute } from "../../test/renderRoute";
import { server, http, HttpResponse } from "../../test/server";
import * as fixtures from "../../test/fixtures";

vi.mock("@clerk/clerk-react", async () => {
  const { clerkTestDouble } = await import("../../test/clerk");
  return clerkTestDouble();
});

/**
 * The straight-sets runner (DN-20).
 *
 * What these guard is the thing the screen exists for and the two runners
 * beside it cannot do: an untimed session that survives being put down.
 * Position is never held in the component -- it is one number on the server,
 * read back against the session's own snapshot -- so the tests drive the
 * screen from the session a refresh would have fetched, which is the same
 * thing a locked phone comes back to.
 */

const ID = fixtures.ASSIGNMENT_ID;

/** Chin-up 5×3 rest 90, then push-up 3×8 rest 60 — eight sets in all. */
const CHIN_UP = fixtures.sessionMovement();
const PUSH_UP = fixtures.sessionMovement({
  planSlotMovementId: "plan-slot-movement-2",
  order: 1,
  sets: 3,
  reps: 8,
  restSeconds: 60,
  exercise: { id: "exercise-push-up", name: "Push-up", movementGroup: "push_horizontal", rung: 2 },
});

/**
 * The same two movements as the day prescribes them.
 *
 * The runner reads the session's snapshot and the log screen reads today's
 * prescription, so a test that walks from one to the other needs both to
 * describe the same eight sets (DN-126).
 */
const PRESCRIBED = [
  fixtures.prescribedMovement(),
  fixtures.prescribedMovement({
    id: "plan-slot-movement-2",
    order: 1,
    sets: 3,
    reps: 8,
    restSeconds: 60,
    movementGroup: "push_horizontal",
    exercise: { id: "exercise-push-up", name: "Push-up", movementGroup: "push_horizontal", rung: 2 },
  }),
];

/** Every `sets` body the screen posted, in order. */
type Posted = LogSet[];

/**
 * A straight-sets session, served as today's, with `sets` posts recorded.
 *
 * The POST answers with the session it was handed rather than the one it was
 * asked for, and `/today` keeps serving the original: what the screen shows
 * has to come from a real read, so a test that wants the next state serves it.
 */
function running(
  overrides: Partial<WorkoutSession> = {},
  dayOverrides: Partial<ReturnType<typeof fixtures.today>> = {},
): Posted {
  const posted: Posted = [];
  const session = fixtures.session({
    capSeconds: null,
    autoStopAtCap: false,
    setsCompleted: 0,
    movements: [CHIN_UP, PUSH_UP],
    ...overrides,
  });
  const day = fixtures.today(dayOverrides);

  server.use(
    http.get("/api/today", () =>
      HttpResponse.json({
        ...day,
        assignment: {
          ...day.assignment!,
          wod: null,
          prescription: { movements: PRESCRIBED },
          status: "in_progress",
          session,
        },
      }),
    ),
    http.post(`/api/assignments/:assignmentId/session/sets`, async ({ request }) => {
      posted.push((await request.json()) as LogSet);
      return HttpResponse.json(session);
    }),
  );
  return posted;
}

describe("the straight-sets runner", () => {
  it("opens on the first set of the first movement", async () => {
    running();
    renderRoute(`/workout/${ID}`);

    expect(await screen.findByText("CHIN-UP")).toBeInTheDocument();
    expect(screen.getByText("SET 1 OF 5")).toBeInTheDocument();
    expect(screen.getByText("WORK")).toBeInTheDocument();
    // The count for one set, not the day's total -- eight sets of work is not
    // eight reps, and the number the size of the screen is the one to count to.
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText(/STRAIGHT SETS · 8 SETS/)).toBeInTheDocument();
  });

  it("has no clock on it", async () => {
    running();
    renderRoute(`/workout/${ID}`);

    await screen.findByText("CHIN-UP");
    // The WOD runners head the screen with ELAPSED. This day is untimed on
    // purpose, and a running number to race is the whole thing it is not.
    expect(screen.queryByText(/ELAPSED/)).not.toBeInTheDocument();
    expect(screen.queryByText(/CAP/)).not.toBeInTheDocument();
  });

  it("records the set as an absolute count, so a replayed tap is not a second set", async () => {
    const posted = running({ setsCompleted: 3 });
    renderRoute(`/workout/${ID}`);

    await userEvent.click(await screen.findByText("SET DONE"));

    expect(posted).toHaveLength(1);
    expect(posted[0].setsCompleted).toBe(4);
  });

  it("starts the rest the movement prescribes when a set is done", async () => {
    const posted = running();
    renderRoute(`/workout/${ID}`);

    await userEvent.click(await screen.findByText("SET DONE"));

    // Where the rest started, on the session's own clock -- not how long it
    // runs, which is the movement's and is already in the snapshot.
    expect(posted[0].restStartedAtSeconds).not.toBeNull();
  });

  it("starts no rest after the last set of the day", async () => {
    const posted = running({ setsCompleted: 7 });
    renderRoute(`/workout/${ID}`);

    await userEvent.click(await screen.findByText("SET DONE"));

    expect(posted[0]).toEqual({ setsCompleted: 8, restStartedAtSeconds: null });
  });

  it("starts no rest on a movement that prescribes none", async () => {
    const posted = running({
      movements: [fixtures.sessionMovement({ restSeconds: 0 })],
    });
    renderRoute(`/workout/${ID}`);

    await userEvent.click(await screen.findByText("SET DONE"));

    expect(posted[0].restStartedAtSeconds).toBeNull();
  });

  it("counts the rest down from when it started, not from when the screen opened", async () => {
    // 30 seconds into a 90-second rest that began at the 10-second mark.
    running({
      setsCompleted: 1,
      startedAt: new Date(Date.now() - 40_000).toISOString(),
      restStartedAtSeconds: 10,
    });
    renderRoute(`/workout/${ID}`);

    expect(await screen.findByText("REST")).toBeInTheDocument();
    expect(screen.getByText("60")).toBeInTheDocument();
    expect(screen.queryByText("WORK")).not.toBeInTheDocument();
  });

  it("is back at work when the rest ran out while the screen was closed", async () => {
    running({
      setsCompleted: 1,
      startedAt: new Date(Date.now() - 200_000).toISOString(),
      restStartedAtSeconds: 10,
    });
    renderRoute(`/workout/${ID}`);

    expect(await screen.findByText("WORK")).toBeInTheDocument();
    expect(screen.getByText("SET 2 OF 5")).toBeInTheDocument();
  });

  it("ends the rest without advancing the set when the athlete goes back early", async () => {
    const posted = running({
      setsCompleted: 2,
      startedAt: new Date(Date.now() - 20_000).toISOString(),
      restStartedAtSeconds: 10,
    });
    renderRoute(`/workout/${ID}`);

    await userEvent.click(await screen.findByText("START NEXT SET"));

    expect(posted[0]).toEqual({ setsCompleted: 2, restStartedAtSeconds: null });
  });

  it("resumes on the movement the set count lands in", async () => {
    // Six sets done: the chin-up's five, then one push-up set.
    running({ setsCompleted: 6 });
    renderRoute(`/workout/${ID}`);

    expect(await screen.findByText("PUSH-UP")).toBeInTheDocument();
    expect(screen.getByText("SET 2 OF 3")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
  });

  it("counts each movement's sets against its own total, not the day's", async () => {
    running({ setsCompleted: 6 });
    renderRoute(`/workout/${ID}`);

    await screen.findByText("SESSION");
    expect(screen.getByText("5/5")).toBeInTheDocument();
    expect(screen.getByText("1/3")).toBeInTheDocument();
  });

  it("offers the finish once every set is done", async () => {
    running({ setsCompleted: 8 });
    renderRoute(`/workout/${ID}`);

    expect(await screen.findByText("All sets done")).toBeInTheDocument();
    expect(screen.getByText("FINISH SESSION")).toBeInTheDocument();
    expect(screen.queryByText("SET DONE")).not.toBeInTheDocument();
  });

  it("ends at the log, the same as every other finished session", async () => {
    // This used to end on Today. The log screen read a WOD to know what kind
    // of number to ask for and a strength day has none, so it would have sat
    // there loading -- the day ended with nothing written down, which is the
    // hole DN-126 closed.
    running({ setsCompleted: 8 }, { warmupCooldownEnabled: false });
    renderRoute(`/workout/${ID}`);

    await userEvent.click(await screen.findByText("FINISH SESSION"));

    expect(
      await screen.findByRole("button", { name: "SAVE RESULT" }),
    ).toBeInTheDocument();
  });

  it("runs the cool-down first where there is one, and that ends at the log too", async () => {
    // The cool-down is the athlete's, not the WOD's, so a strength day keeps
    // it -- and its exit is now the same one a WOD day takes.
    running({ setsCompleted: 8 });
    renderRoute(`/workout/${ID}`);

    await userEvent.click(await screen.findByText("FINISH SESSION"));
    await userEvent.click(await screen.findByRole("button", { name: "LOG RESULT" }));

    expect(
      await screen.findByRole("button", { name: "SAVE RESULT" }),
    ).toBeInTheDocument();
  });

  it("is chosen over the round-tap runner by the session, not by the assignment", async () => {
    running();
    renderRoute(`/workout/${ID}`);

    await screen.findByText("CHIN-UP");
    expect(screen.queryByText("ROUND COMPLETE")).not.toBeInTheDocument();
  });
});
