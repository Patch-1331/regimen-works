import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { EditSetLogs, LogResultRequest, WorkoutSetLog } from "@regimen-works/shared";
import { renderRoute } from "../test/renderRoute";
import { server, http, HttpResponse } from "../test/server";
import * as fixtures from "../test/fixtures";

vi.mock("@clerk/clerk-react", async () => {
  const { clerkTestDouble } = await import("../test/clerk");
  return clerkTestDouble();
});

/**
 * Correcting the reps at log time (DN-21).
 *
 * The runner records every set as prescribed, because asking the athlete to
 * type a count between sets costs more than the reading is worth. That makes
 * this screen the only place "I said three and did two" can be written down --
 * and the only place a per-movement history can be made wrong, so what these
 * guard is which rows get sent and which are left alone.
 */

const ID = fixtures.ASSIGNMENT_ID;

/** Chin-up 5×3 and push-up 3×8, as `prescribedMovement` resolves them. */
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

/** The first two sets of the chin-up, and the first of the push-up. */
const RECORDED: WorkoutSetLog[] = [
  fixtures.workoutSetLog(),
  fixtures.workoutSetLog({ id: "set-log-2", setNumber: 2 }),
  fixtures.workoutSetLog({
    id: "set-log-3",
    movementOrder: 1,
    setNumber: 1,
    exerciseId: "exercise-push-up",
    prescribedReps: 8,
    actualReps: 8,
  }),
];

type Sent = { corrections: EditSetLogs[]; saved: LogResultRequest[] };

/** A finished prescribed day, with everything this screen writes recorded. */
function loggingAStrengthDay(
  options: { setLogs?: WorkoutSetLog[]; correctionFails?: boolean } = {},
): Sent {
  const sent: Sent = { corrections: [], saved: [] };
  const day = fixtures.today();

  server.use(
    http.get("/api/today", () =>
      HttpResponse.json({
        ...day,
        assignment: {
          ...day.assignment!,
          wod: null,
          prescription: { movements: PRESCRIBED },
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
    http.get(`/api/assignments/:assignmentId/session/sets`, () =>
      HttpResponse.json(options.setLogs ?? RECORDED),
    ),
    http.patch(`/api/assignments/:assignmentId/session/sets`, async ({ request }) => {
      sent.corrections.push((await request.json()) as EditSetLogs);
      if (options.correctionFails) return new HttpResponse(null, { status: 500 });
      return HttpResponse.json(RECORDED);
    }),
    http.post(`/api/assignments/:assignmentId/log`, async ({ request }) => {
      sent.saved.push((await request.json()) as LogResultRequest);
      return HttpResponse.json({
        id: "log-1",
        assignmentId: ID,
        resultType: "sets_completed",
        resultValue: "3/8",
        rpe: null,
        notes: null,
      });
    }),
  );
  return sent;
}

describe("correcting the reps on a prescribed day", () => {
  it("lists every set the runner recorded, against the movement it belongs to", async () => {
    loggingAStrengthDay();
    renderRoute(`/log/${ID}`);

    // Named, because a column of bare number boxes says nothing about which
    // set a reading is for.
    expect(await screen.findByLabelText("Chin-up set 1 reps")).toHaveValue(3);
    expect(screen.getByLabelText("Chin-up set 2 reps")).toHaveValue(3);
    expect(screen.getByLabelText("Push-up set 1 reps")).toHaveValue(8);
  });

  it("arrives filled with the day as prescribed, which is what the runner wrote", async () => {
    // The default, so a day that went as asked saves without touching this at
    // all -- the correction is the exception, not the entry.
    loggingAStrengthDay();
    renderRoute(`/log/${ID}`);

    await screen.findByLabelText("Chin-up set 1 reps");
    // Beside each row, because "2" means nothing without the number it was
    // measured against -- the same reason the stored result carries both.
    expect(screen.getAllByText("of 3")).toHaveLength(2);
  });

  it("sends nothing when the athlete changes nothing", async () => {
    const sent = loggingAStrengthDay();
    renderRoute(`/log/${ID}`);

    await screen.findByLabelText("Chin-up set 1 reps");
    await userEvent.click(screen.getByRole("button", { name: "SAVE RESULT" }));

    expect(sent.corrections).toEqual([]);
    expect(sent.saved).toHaveLength(1);
  });

  it("sends only the sets that were changed", async () => {
    // Every row would be a rewrite of the session, and a request that rewrites
    // eight rows to say one of them is wrong is a request that can get seven
    // of them wrong.
    const sent = loggingAStrengthDay();
    renderRoute(`/log/${ID}`);

    const second = await screen.findByLabelText("Chin-up set 2 reps");
    await userEvent.clear(second);
    await userEvent.type(second, "1");
    await userEvent.click(screen.getByRole("button", { name: "SAVE RESULT" }));

    expect(sent.corrections).toEqual([
      { sets: [{ movementOrder: 0, setNumber: 2, actualReps: 1 }] },
    ]);
  });

  it("records a set attempted and not made", async () => {
    // Zero is an answer. A form that read it as "nothing entered" and fell
    // back to the prescription would write down a set that went as asked.
    const sent = loggingAStrengthDay();
    renderRoute(`/log/${ID}`);

    const first = await screen.findByLabelText("Chin-up set 1 reps");
    await userEvent.clear(first);
    await userEvent.type(first, "0");
    await userEvent.click(screen.getByRole("button", { name: "SAVE RESULT" }));

    expect(sent.corrections[0].sets[0].actualReps).toBe(0);
  });

  it("corrects several sets in one request", async () => {
    const sent = loggingAStrengthDay();
    renderRoute(`/log/${ID}`);

    const first = await screen.findByLabelText("Chin-up set 1 reps");
    await userEvent.clear(first);
    await userEvent.type(first, "2");
    const push = screen.getByLabelText("Push-up set 1 reps");
    await userEvent.clear(push);
    await userEvent.type(push, "6");
    await userEvent.click(screen.getByRole("button", { name: "SAVE RESULT" }));

    expect(sent.corrections).toEqual([
      {
        sets: [
          { movementOrder: 0, setNumber: 1, actualReps: 2 },
          { movementOrder: 1, setNumber: 1, actualReps: 6 },
        ],
      },
    ]);
  });

  it("does not save the result when the correction could not be written", async () => {
    // Saving first would navigate away from a correction that was lost, and
    // the athlete would have no way to tell it had not been written.
    const sent = loggingAStrengthDay({ correctionFails: true });
    renderRoute(`/log/${ID}`);

    const first = await screen.findByLabelText("Chin-up set 1 reps");
    await userEvent.clear(first);
    await userEvent.type(first, "2");
    await userEvent.click(screen.getByRole("button", { name: "SAVE RESULT" }));

    expect(sent.corrections).toHaveLength(1);
    expect(sent.saved).toEqual([]);
    expect(screen.getByRole("button", { name: "SAVE RESULT" })).toBeInTheDocument();
  });

  it("asks nothing where the runner recorded no sets", async () => {
    // A day logged from memory without having been run. There is nothing to
    // correct, and an empty section would read as sets that went missing.
    loggingAStrengthDay({ setLogs: [] });
    renderRoute(`/log/${ID}`);

    await screen.findByText("SETS DONE");
    expect(screen.queryByText("REPS PER SET")).not.toBeInTheDocument();
  });

  it("names a set by position where the program has since reordered the day", async () => {
    // The order is the session's own snapshot, and the prescription is that
    // list read live. A row with no match is still a set that was done, so it
    // is named rather than dropped -- hiding it would lose a correction the
    // athlete can still make.
    loggingAStrengthDay({
      setLogs: [fixtures.workoutSetLog({ movementOrder: 4, setNumber: 2 })],
    });
    renderRoute(`/log/${ID}`);

    expect(await screen.findByLabelText("Movement 5 set 2 reps")).toHaveValue(3);
  });

  it("asks nothing on a WOD day, which has no sets at all", async () => {
    renderRoute(`/log/${ID}`);

    expect(await screen.findByRole("heading", { name: "Fran" })).toBeInTheDocument();
    expect(screen.queryByText("REPS PER SET")).not.toBeInTheDocument();
  });
});
