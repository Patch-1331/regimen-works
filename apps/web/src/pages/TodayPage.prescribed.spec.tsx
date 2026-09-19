import { describe, expect, it, vi } from "vitest";
import type { PrescribedMovement } from "@regimen-works/shared";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderRoute } from "../test/renderRoute";
import { server, http, HttpResponse } from "../test/server";
import * as fixtures from "../test/fixtures";

/**
 * Today, on a day the program prescribes straight sets (DN-125).
 *
 * The other kind of day. A WOD is scored against a clock; this is "pull, 5×3,
 * rest 90s" and there is no clock over it, so the screen shares the panel with
 * the WOD plate and almost nothing else. What these say is that everything the
 * WOD plate is careful about is still true here: the numbers on the readouts
 * are facts about *this* day, an equipment fallback says so out loud, and the
 * swap is one tap against a real session.
 */

vi.mock("@clerk/clerk-react", async () => {
  const { clerkTestDouble } = await import("../test/clerk");
  return clerkTestDouble();
});

const chinUp = fixtures.apiExercise({
  id: "exercise-chin-up",
  name: "Chin-up",
  pattern: "pull",
  line: "pull",
  rung: 1,
});

const ringRow = fixtures.apiExercise({
  id: "exercise-ring-row",
  name: "Ring row",
  pattern: "pull",
  line: "pull",
  rung: 0,
});

/** Today, prescribing the given movements and nothing else. */
function prescribing(movements: PrescribedMovement[]) {
  server.use(
    http.get("/api/exercises", () => HttpResponse.json([ringRow, chinUp])),
    http.get("/api/today", () =>
      HttpResponse.json(
        fixtures.today({
          assignment: {
            ...fixtures.today().assignment!,
            wod: null,
            prescription: { movements },
          },
        }),
      ),
    ),
  );
}

describe("the prescribed plate", () => {
  it("reads the day out as sets, reps and rest", async () => {
    prescribing([fixtures.prescribedMovement()]);
    renderRoute("/");

    expect(await screen.findByText("CHIN-UP")).toBeInTheDocument();
    expect(screen.getByText(/5 × 3/)).toBeInTheDocument();
    expect(screen.getByText("REST 90S")).toBeInTheDocument();
  });

  it("counts a hold in seconds, the way the WOD plate does", async () => {
    prescribing([
      fixtures.prescribedMovement({
        exercise: { unit: "seconds", name: "Hollow hold" },
        sets: 3,
        reps: 40,
      }),
    ]);
    renderRoute("/");

    expect(await screen.findByText(/3 × 40s/)).toBeInTheDocument();
  });

  it("reads a whole number of minutes as minutes", async () => {
    // "REST 120S" is a number the athlete has to divide before it means
    // anything.
    prescribing([fixtures.prescribedMovement({ restSeconds: 120 })]);
    renderRoute("/");

    expect(await screen.findByText("REST 2M")).toBeInTheDocument();
  });

  it("says straight through rather than a rest of nothing", async () => {
    // Zero is a prescription, not a field somebody left blank.
    prescribing([fixtures.prescribedMovement({ restSeconds: 0 })]);
    renderRoute("/");

    expect(await screen.findByText("STRAIGHT THROUGH")).toBeInTheDocument();
  });

  it("reports what the day has rather than dimming what it hasn't", async () => {
    // A prescribed day has no time cap and no rounds. Dimming those two says
    // today is a lesser day; filling them in says something false. So the bank
    // holds the two numbers this day does have.
    prescribing([
      fixtures.prescribedMovement({ sets: 5 }),
      fixtures.prescribedMovement({
        id: "plan-slot-movement-2",
        order: 1,
        sets: 3,
        exercise: { id: ringRow.id, name: "Ring row", rung: 0 },
      }),
    ]);
    renderRoute("/");

    expect(await screen.findByText("MOVEMENTS")).toBeInTheDocument();
    expect(screen.getByText("SETS")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.queryByText(/time cap/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/rounds/i)).not.toBeInTheDocument();
  });

  it("names the movement equipment took away", async () => {
    // The same honesty rule the WOD plate follows: an app that quietly hands
    // somebody a different movement should at least say so.
    prescribing([
      fixtures.prescribedMovement({
        exercise: { id: ringRow.id, name: "Row under table", line: null, rung: null },
        prescribedName: "Chin-up",
        prescribedId: chinUp.id,
        prescribedReason: "equipment",
      }),
    ]);
    renderRoute("/");

    expect(await screen.findByText("ROW UNDER TABLE")).toBeInTheDocument();
    expect(screen.getByText("NO KIT")).toBeInTheDocument();

    // And offers it back (DN-110): an athlete handed a row under the table for
    // want of a bar, in a gym that has one, should be able to take the session
    // as the program wrote it.
    await userEvent.click(
      screen.getByRole("button", { name: /swap row under table/i }),
    );
    expect(screen.getByText("Chin-up")).toBeInTheDocument();
  });

  it("swaps a prescribed movement by its own id", async () => {
    const bodies: unknown[] = [];
    prescribing([fixtures.prescribedMovement()]);
    server.use(
      http.post("/api/assignments/:id/substitutions", async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({});
      }),
    );
    renderRoute("/");

    await userEvent.click(
      await screen.findByRole("button", { name: /swap chin-up/i }),
    );
    await userEvent.click(screen.getByRole("button", { name: /^ring row$/i }));

    // Keyed off the PlanSlotMovement, because a prescribed day has no
    // WodMovement anywhere in it.
    expect(bodies).toEqual([
      {
        wodMovementId: null,
        planSlotMovementId: "plan-slot-movement-1",
        exerciseId: "exercise-ring-row",
      },
    ]);
  });

  it("reverts through the prescribed path rather than the WOD one", async () => {
    const urls: string[] = [];
    prescribing([fixtures.prescribedMovement({ isSwapped: true })]);
    server.use(
      http.delete("/api/assignments/:id/substitutions/*", ({ request }) => {
        urls.push(new URL(request.url).pathname);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderRoute("/");

    await userEvent.click(
      await screen.findByRole("button", { name: /swap chin-up/i }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /use what's prescribed/i }),
    );

    expect(urls).toEqual([
      `/api/assignments/${fixtures.ASSIGNMENT_ID}/substitutions/prescribed/plan-slot-movement-1`,
    ]);
  });

  it("offers no way to start a session it cannot run yet", async () => {
    // The runner is its own issue and is not built. A button that does nothing
    // would be worse than saying so.
    prescribing([fixtures.prescribedMovement()]);
    renderRoute("/");

    await screen.findByText("CHIN-UP");
    expect(
      screen.queryByRole("button", { name: /start workout/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /mark today as rest/i }),
    ).toBeInTheDocument();
  });
});
