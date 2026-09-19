import { describe, expect, it, vi } from "vitest";
import type { Equipment } from "@regimen-works/shared";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderRoute } from "../test/renderRoute";
import { server, http, HttpResponse } from "../test/server";
import * as fixtures from "../test/fixtures";

/**
 * Which rows of the plate carry a swap control (DN-80).
 *
 * The rule used to be "every row on a progression line", which was the same
 * thing as "every row with somewhere to go" while equipment meant the bar.
 * A jump rope breaks that equivalence: cardio carries `line: null`, so the row
 * most likely to need a way out was the one row that had none.
 *
 * Driven through the real page rather than `buildSwapOptions` directly,
 * because what changed is which rows get a control at all — a fact about the
 * plate, not about the option list.
 */

vi.mock("@clerk/clerk-react", async () => {
  const { clerkTestDouble } = await import("../test/clerk");
  return clerkTestDouble();
});

const ROPE: Equipment[] = ["jump_rope"];

const doubleUnders = fixtures.apiExercise({
  id: "double-unders",
  name: "Double-unders",
  pattern: "cardio",
  equipment: ROPE,
  line: null,
  rung: null,
  altExercise: { id: "high-knees", name: "High knees" },
});

const highKnees = fixtures.apiExercise({
  id: "high-knees",
  name: "High knees",
  pattern: "cardio",
  line: null,
  rung: null,
  altExercise: null,
});

/** A plate whose single movement is the given cardio exercise. */
function plateShowing(
  exercise: typeof doubleUnders,
  movementOverrides: {
    isSwapped?: boolean;
    prescribedName?: string | null;
    prescribedId?: string | null;
    prescribedReason?: "equipment" | "remembered_choice" | null;
  } = {},
) {
  server.use(
    http.get("/api/exercises", () =>
      HttpResponse.json([doubleUnders, highKnees]),
    ),
    http.get("/api/today", () =>
      HttpResponse.json(
        fixtures.today({
          assignment: {
            ...fixtures.today().assignment!,
            wod: fixtures.wod({
              dominantPattern: "cardio",
              movements: [
                fixtures.movement({
                  ...movementOverrides,
                  exercise: {
                    id: exercise.id,
                    name: exercise.name,
                    pattern: "cardio",
                    equipment: exercise.id === "double-unders" ? ROPE : [],
                    unit: "reps",
                    instructions: null,
                    line: null,
                    rung: null,
                    altExerciseId: exercise.altExercise?.id ?? null,
                  },
                }),
              ],
            }),
          },
        }),
      ),
    ),
  );
}

describe("the swap control on an off-ladder movement", () => {
  it("is offered on a movement that has a no-equipment alternative", async () => {
    plateShowing(doubleUnders);
    renderRoute("/");

    const swap = await screen.findByRole("button", { name: /swap double-unders/i });
    await userEvent.click(swap);

    // Both halves of the choice, with the current one marked — not the
    // alternative alone, which would read as an instruction.
    expect(screen.getByRole("button", { name: /^double-unders$/i })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByText("High knees")).toBeInTheDocument();
    expect(screen.getByText("NO KIT")).toBeInTheDocument();
  });

  it("is withheld from a movement with no ladder and no alternative", async () => {
    plateShowing(highKnees);
    renderRoute("/");

    await screen.findByText("HIGH KNEES");
    // The row this gate was written for: nothing to climb, nothing to fall to.
    expect(
      screen.queryByRole("button", { name: /swap high knees/i }),
    ).not.toBeInTheDocument();
  });

  it("stays on a swapped row that now offers nothing further", async () => {
    // The athlete took the alternative: what they hold has no ladder under it
    // and no alternative of its own, so revert is the only way back. Without
    // the control the swap would be a one-way door.
    plateShowing(highKnees, { isSwapped: true });
    renderRoute("/");

    await userEvent.click(
      await screen.findByRole("button", { name: /swap high knees/i }),
    );
    expect(
      screen.getByRole("button", { name: /use what's prescribed/i }),
    ).toBeInTheDocument();
  });
});

/**
 * The rope pair, once it is a progression line (DN-115).
 *
 * Both movements need the rope, so before the line the panel could only offer
 * the way *off* it: an athlete who owned a rope and could not yet turn doubles
 * was shown high knees, which is the app taking away gear they have.
 */
describe("a line where every rung needs the same equipment", () => {
  const singleUnders = fixtures.apiExercise({
    id: "single-unders",
    name: "Single-unders",
    pattern: "cardio",
    equipment: ROPE,
    line: "cardio_rope",
    rung: 0,
    altExercise: { id: "high-knees", name: "High knees" },
  });
  const linedDoubleUnders = fixtures.apiExercise({
    ...doubleUnders,
    line: "cardio_rope",
    rung: 1,
  });

  /** Rope Trick as an athlete who owns a rope is served it. */
  function ropeDay() {
    server.use(
      http.get("/api/exercises", () =>
        HttpResponse.json([singleUnders, linedDoubleUnders, highKnees]),
      ),
      http.get("/api/today", () =>
        HttpResponse.json(
          fixtures.today({
            assignment: {
              ...fixtures.today().assignment!,
              wod: fixtures.wod({
                dominantPattern: "cardio",
                movements: [
                  fixtures.movement({
                    exercise: {
                      id: "double-unders",
                      name: "Double-unders",
                      pattern: "cardio",
                      equipment: ROPE,
                      unit: "reps",
                      instructions: null,
                      line: "cardio_rope",
                      rung: 1,
                      altExerciseId: "high-knees",
                    },
                  }),
                ],
              }),
            },
          }),
        ),
      ),
    );
  }

  it("offers the easier rung instead of only the way off the rope", async () => {
    ropeDay();
    renderRoute("/");

    await userEvent.click(
      await screen.findByRole("button", { name: /swap double-unders/i }),
    );

    // The whole line in order with the current rung marked, then the
    // bodyweight alternative last — the shape every other line already has.
    expect(screen.getByRole("button", { name: /^single-unders/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^double-unders/i })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  it("still offers the way off the rope entirely", async () => {
    // The line is a movement they own the kit for; high knees is for the day
    // the rope is in the other bag. Adding the first must not cost the second.
    ropeDay();
    renderRoute("/");

    await userEvent.click(
      await screen.findByRole("button", { name: /swap double-unders/i }),
    );

    expect(screen.getByRole("button", { name: /^high knees/i })).toBeInTheDocument();
    expect(screen.getByText("NO KIT")).toBeInTheDocument();
  });
});

/**
 * Taking back the prescribed movement after the equipment layer dropped it
 * (DN-110).
 *
 * The athlete owns no rope, so the plate shows high knees where the workout
 * said double-unders. Today they are somewhere that has one. Revert does not
 * apply — there is no substitution behind this row, the equipment layer moved
 * it during resolution — so until now the one movement they had actually
 * found the gear for was the one they could not pick.
 */
describe("the prescribed movement after an equipment fallback", () => {
  /** High knees, standing in for the double-unders the athlete owns no rope for. */
  function equipmentResolvedPlate() {
    plateShowing(highKnees, {
      prescribedName: "Double-unders",
      prescribedId: "double-unders",
      prescribedReason: "equipment",
    });
  }

  it("gives the row a control it would otherwise not have", async () => {
    equipmentResolvedPlate();
    renderRoute("/");

    // High knees have no ladder and no alternative of their own: without the
    // prescription there is nothing to offer, which is the case above.
    expect(
      await screen.findByRole("button", { name: /swap high knees/i }),
    ).toBeInTheDocument();
  });

  it("offers the movement the workout asked for, marked as such", async () => {
    equipmentResolvedPlate();
    renderRoute("/");

    await userEvent.click(
      await screen.findByRole("button", { name: /swap high knees/i }),
    );

    const prescribed = screen.getByRole("button", { name: /^double-unders/i });
    expect(prescribed).toBeInTheDocument();
    expect(prescribed).toHaveAttribute("aria-current", "false");
    expect(screen.getByText("PRESCRIBED")).toBeInTheDocument();
  });

  it("swaps to it, rather than reverting a substitution that isn't there", async () => {
    const swaps: unknown[] = [];
    equipmentResolvedPlate();
    server.use(
      http.post("/api/assignments/:assignmentId/substitutions", async ({ request }) => {
        swaps.push(await request.json());
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderRoute("/");

    await userEvent.click(
      await screen.findByRole("button", { name: /swap high knees/i }),
    );
    await userEvent.click(screen.getByRole("button", { name: /^double-unders/i }));

    expect(swaps).toEqual([
      {
        wodMovementId: "wod-movement-1",
        planSlotMovementId: null,
        exerciseId: "double-unders",
      },
    ]);
  });

  it("stops telling the athlete what the workout says once it offers it", async () => {
    equipmentResolvedPlate();
    renderRoute("/");

    await userEvent.click(
      await screen.findByRole("button", { name: /swap high knees/i }),
    );

    // The sentence explained a movement they could not have. Above a row that
    // reads DOUBLE-UNDERS it is the app talking to itself, and its wording is
    // final where the control no longer is.
    expect(screen.queryByText(/the workout says/i)).not.toBeInTheDocument();
    expect(
      screen.getByText("Not in your equipment — take it anyway if you have one today."),
    ).toBeInTheDocument();
  });

  it("offers nothing on a row the athlete swapped themselves", async () => {
    // Same movement showing, but the athlete chose it: the payload carries no
    // prescription, and putting it back is what revert is for. Two controls
    // for one intention would be one too many.
    plateShowing(highKnees, { isSwapped: true });
    renderRoute("/");

    await userEvent.click(
      await screen.findByRole("button", { name: /swap high knees/i }),
    );
    expect(
      screen.queryByRole("button", { name: /^double-unders/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /use what's prescribed/i }),
    ).toBeInTheDocument();
  });
});
