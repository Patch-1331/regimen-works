import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LogResultRequest, WorkoutSession } from "@regimen-works/shared";
import { renderRoute } from "../test/renderRoute";
import { server, http, HttpResponse } from "../test/server";
import * as fixtures from "../test/fixtures";

vi.mock("@clerk/clerk-react", async () => {
  const { clerkTestDouble } = await import("../test/clerk");
  return clerkTestDouble();
});

/**
 * Writing down a straight-sets day (DN-126).
 *
 * The log screen used to read a WOD to know what kind of number to ask for, so
 * a prescribed day never reached it: the runner, the cool-down and Today's
 * finished plate all routed around it and the day ended with nothing recorded.
 * What these guard is the number that gets sent -- both halves of it, because
 * "6" on its own would be scored against whatever the program says that day
 * prescribes next year.
 */

const ID = fixtures.ASSIGNMENT_ID;

/** Chin-up 5×3 and push-up 3×8 — eight sets in all. */
const PRESCRIBED = [
  fixtures.prescribedMovement(),
  fixtures.prescribedMovement({
    id: "plan-slot-movement-2",
    order: 1,
    sets: 3,
    reps: 8,
    movementGroup: "push_horizontal",
    exercise: { id: "exercise-push-up", name: "Push-up", movementGroup: "push_horizontal", sortOrder: 2 },
  }),
];

/** Every result body the screen saved, in order. */
type Saved = LogResultRequest[];

/** Today as a prescribed day, with the log POST recorded. */
function prescribedDay(session: Partial<WorkoutSession> | null = null): Saved {
  const saved: Saved = [];
  const day = fixtures.today();

  server.use(
    http.get("/api/today", () =>
      HttpResponse.json({
        ...day,
        assignment: {
          ...day.assignment!,
          wod: null,
          prescription: { movements: PRESCRIBED },
          status: session ? "completed" : "scheduled",
          session: session
            ? fixtures.session({
                capSeconds: null,
                autoStopAtCap: false,
                status: "completed",
                movements: [],
                ...session,
              })
            : null,
        },
      }),
    ),
    http.post(`/api/assignments/:assignmentId/log`, async ({ request }) => {
      saved.push((await request.json()) as LogResultRequest);
      return HttpResponse.json({
        id: "log-1",
        assignmentId: ID,
        resultType: "sets_completed",
        resultValue: "8/8",
        rpe: null,
        notes: null,
      });
    }),
  );
  return saved;
}

describe("the log screen on a prescribed day", () => {
  it("names the day and says what it prescribed, with no cap to report", async () => {
    prescribedDay();
    renderRoute(`/log/${ID}`);

    expect(await screen.findByRole("heading", { name: "Strength" })).toBeInTheDocument();
    expect(screen.getByText("STRAIGHT SETS · 8 SETS")).toBeInTheDocument();
    // A prescribed day is untimed on purpose (DN-20), so there is no clock to
    // report and nothing to say about a cap that was never set.
    expect(screen.queryByText(/MIN/)).not.toBeInTheDocument();
  });

  it("asks for sets rather than rounds or a clock", async () => {
    prescribedDay();
    renderRoute(`/log/${ID}`);

    expect(await screen.findByText("SETS DONE")).toBeInTheDocument();
    expect(screen.getByText("of 8")).toBeInTheDocument();
    expect(screen.queryByText("ROUNDS")).not.toBeInTheDocument();
  });

  it("arrives pre-filled from the session, so a finished day is one tap", async () => {
    prescribedDay({ setsCompleted: 8 });
    renderRoute(`/log/${ID}`);

    await screen.findByText("SETS DONE");
    expect(screen.getByLabelText("SETS DONE")).toHaveTextContent("8");
  });

  it("saves both halves, because the denominator is not derivable later", async () => {
    // "6" read back next year would be scored against whatever the program
    // says this day prescribes then, which is a different session.
    const saved = prescribedDay({ setsCompleted: 8 });
    renderRoute(`/log/${ID}`);

    await userEvent.click(await screen.findByRole("button", { name: "SAVE RESULT" }));

    expect(saved).toEqual([
      { resultType: "sets_completed", resultValue: "8/8", rpe: null, notes: null },
    ]);
  });

  it("records a session the athlete cut short", async () => {
    const saved = prescribedDay({ setsCompleted: 8 });
    renderRoute(`/log/${ID}`);

    await screen.findByText("SETS DONE");
    await userEvent.click(screen.getByLabelText("Decrease SETS DONE"));
    await userEvent.click(screen.getByLabelText("Decrease SETS DONE"));
    await userEvent.click(screen.getByRole("button", { name: "SAVE RESULT" }));

    expect(saved[0].resultValue).toBe("6/8");
  });

  it("will not count past what the day prescribed", async () => {
    // Not a bigger session -- a number the API refuses, and one the athlete
    // would have to undo before anything could be saved at all.
    const saved = prescribedDay({ setsCompleted: 8 });
    renderRoute(`/log/${ID}`);

    await screen.findByText("SETS DONE");
    await userEvent.click(screen.getByLabelText("Increase SETS DONE"));
    await userEvent.click(screen.getByRole("button", { name: "SAVE RESULT" }));

    expect(saved[0].resultValue).toBe("8/8");
  });

  it("reads an already-saved result back for editing", async () => {
    prescribedDay({ setsCompleted: 8 });
    server.use(
      http.get(`/api/assignments/:assignmentId/log`, () =>
        HttpResponse.json({
          id: "log-1",
          assignmentId: ID,
          resultType: "sets_completed",
          resultValue: "5/8",
          rpe: 6,
          notes: "Grip went.",
        }),
      ),
    );
    renderRoute(`/log/${ID}`);

    await screen.findByText("SETS DONE");
    expect(screen.getByLabelText("SETS DONE")).toHaveTextContent("5");
    expect(screen.getByDisplayValue("Grip went.")).toBeInTheDocument();
  });
});
