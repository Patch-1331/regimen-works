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
  movementOverrides: { isSwapped?: boolean } = {},
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
