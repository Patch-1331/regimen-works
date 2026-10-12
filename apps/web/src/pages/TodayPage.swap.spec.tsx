import { describe, expect, it, vi } from "vitest";
import type { Equipment, SwapOptionsResponse } from "@regimen-works/shared";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderRoute } from "../test/renderRoute";
import { server, http, HttpResponse } from "../test/server";
import * as fixtures from "../test/fixtures";

/**
 * Which rows of the plate carry a swap control (DN-80).
 *
 * The rule used to be "every row on a movement groups", which was the same
 * thing as "every row with somewhere to go" while equipment meant the bar.
 * A jump rope breaks that equivalence: cardio carries `line: null`, so the row
 * most likely to need a way out was the one row that had none.
 *
 * Driven through the real page rather than `canSwap` directly, because what
 * changed is which rows get a control at all — a fact about the plate, not
 * about the option list. What the list holds is the API's to decide (DN-170);
 * these serve it the answer and check the plate shows it.
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
  movementGroup: null,
  sortOrder: null,
  fallbackExercise: { id: "high-knees", name: "High knees" },
});

const highKnees = fixtures.apiExercise({
  id: "high-knees",
  name: "High knees",
  pattern: "cardio",
  movementGroup: null,
  sortOrder: null,
  fallbackExercise: null,
});

const NOTHING: SwapOptionsResponse = { main: [], harder: [], needsEquipment: [] };

/** What the API offers for double-unders: the written way off the rope. */
const ropeOptions: SwapOptionsResponse = {
  ...NOTHING,
  main: [fixtures.swapOption({ exerciseId: "high-knees", name: "High knees", isFallback: true })],
};

/** Serves the swap panel `options`, whichever row asks. */
function offering(options: SwapOptionsResponse) {
  server.use(
    http.get("/api/assignments/:assignmentId/substitutions/options", () =>
      HttpResponse.json(options),
    ),
  );
}

/** A plate whose single movement is the given cardio exercise. */
function plateShowing(
  exercise: typeof doubleUnders,
  movementOverrides: {
    isSwapped?: boolean;
    prescribedName?: string | null;
    prescribedId?: string | null;
    prescribedReason?: "equipment" | "remembered_choice" | null;
    primaryMuscles?: ("quadriceps" | "calves")[];
  } = {},
) {
  const { primaryMuscles = [], ...movement } = movementOverrides;
  server.use(
    http.get("/api/today", () =>
      HttpResponse.json(
        fixtures.today({
          assignment: {
            ...fixtures.today().assignment!,
            wod: fixtures.wod({
              dominantPattern: "cardio",
              movements: [
                fixtures.movement({
                  ...movement,
                  exercise: {
                    id: exercise.id,
                    name: exercise.name,
                    pattern: "cardio",
                    equipment: exercise.id === "double-unders" ? ROPE : [],
                    unit: "reps",
                    instructions: [],
                    movementGroup: null,
                    sortOrder: null,
                    fallbackExerciseId: exercise.fallbackExercise?.id ?? null,
                    primaryMuscles,
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

describe("the swap control on an off-group movement", () => {
  it("is offered on a movement that has a no-equipment alternative", async () => {
    plateShowing(doubleUnders);
    offering(ropeOptions);
    renderRoute("/");

    const swap = await screen.findByRole("button", { name: /swap double-unders/i });
    await userEvent.click(swap);

    // Both halves of the choice, with the current one marked — not the
    // alternative alone, which would read as an instruction.
    expect(
      await screen.findByRole("button", { name: /^double-unders$/i }),
    ).toHaveAttribute("aria-current", "true");
    expect(screen.getByText("High knees")).toBeInTheDocument();
    expect(screen.getByText("NO KIT")).toBeInTheDocument();
  });

  it("is offered on a movement with only its muscles to match on", async () => {
    // DN-170: the whole library is a place to go now, not just a group or a
    // written alternative. High knees name their muscles, and that is enough.
    plateShowing(highKnees, { primaryMuscles: ["quadriceps"] });
    offering({
      ...NOTHING,
      main: [fixtures.swapOption({ exerciseId: "butt-kicks", name: "Butt kicks" })],
    });
    renderRoute("/");

    await userEvent.click(
      await screen.findByRole("button", { name: /swap high knees/i }),
    );
    expect(
      await screen.findByRole("button", { name: /^butt kicks$/i }),
    ).toBeInTheDocument();
  });

  it("is withheld from a movement with no muscles, no group and no fallback", async () => {
    plateShowing(highKnees);
    renderRoute("/");

    await screen.findByText("HIGH KNEES");
    // The row this gate was written for: nothing to match on, nothing to
    // climb, nothing to fall to.
    expect(
      screen.queryByRole("button", { name: /swap high knees/i }),
    ).not.toBeInTheDocument();
  });

  it("stays on a swapped row that now offers nothing further", async () => {
    // The athlete took the alternative: what they hold has no group under it
    // and no alternative of its own, so revert is the only way back. Without
    // the control the swap would be a one-way door.
    plateShowing(highKnees, { isSwapped: true });
    renderRoute("/");

    await userEvent.click(
      await screen.findByRole("button", { name: /swap high knees/i }),
    );
    expect(
      await screen.findByRole("button", { name: /use what's prescribed/i }),
    ).toBeInTheDocument();
  });
});

/**
 * A pick from the panel's last section (DN-170).
 *
 * "Needs equipment you haven't listed" is "take it anyway if you have one
 * today" for a whole list. Taking one is the same swap as any other: it does
 * not add the kit to the athlete's equipment, which would quietly change every
 * plate after today's.
 */
describe("a pick from the movements that need unlisted equipment", () => {
  it("swaps today and touches nothing else", async () => {
    const writes: string[] = [];
    const swaps: unknown[] = [];
    plateShowing(highKnees, { primaryMuscles: ["quadriceps"] });
    offering({
      ...NOTHING,
      needsEquipment: [
        fixtures.swapOption({ exerciseId: "box-step-up", name: "Box step-up", equipment: ["box"] }),
      ],
    });
    server.use(
      http.post("/api/assignments/:assignmentId/substitutions", async ({ request }) => {
        swaps.push(await request.json());
        return new HttpResponse(null, { status: 204 });
      }),
      http.all("/api/settings", ({ request }) => {
        if (request.method !== "GET") writes.push("settings");
        return HttpResponse.json(fixtures.settings());
      }),
      http.all("/api/schedule-rule", ({ request }) => {
        if (request.method !== "GET") writes.push("schedule-rule");
        return HttpResponse.json({ maxDaysPerWeek: 5 });
      }),
    );
    renderRoute("/");

    await userEvent.click(
      await screen.findByRole("button", { name: /swap high knees/i }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: /needs equipment you haven't listed/i }),
    );
    await userEvent.click(screen.getByRole("button", { name: /^box step-up$/i }));

    expect(swaps).toEqual([
      {
        wodMovementId: "wod-movement-1",
        planSlotMovementId: null,
        exerciseId: "box-step-up",
      },
    ]);
    expect(writes).toEqual([]);
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
    // Matched against the double-unders the workout wrote (DN-170), which
    // the high knees already showing are the alternative to.
    offering(ropeOptions);
  }

  it("gives the row a control it would otherwise not have", async () => {
    equipmentResolvedPlate();
    renderRoute("/");

    // High knees have no muscles, group or fallback of their own: without the
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

    const prescribed = await screen.findByRole("button", { name: /^double-unders/i });
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
    await userEvent.click(await screen.findByRole("button", { name: /^double-unders/i }));

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
    expect(
      await screen.findByText("Not in your equipment — take it anyway if you have one today."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/the workout says/i)).not.toBeInTheDocument();
  });

  it("offers nothing on a row the athlete swapped themselves", async () => {
    // Same movement showing, but the athlete chose it: the payload carries no
    // prescription, and putting it back is what revert is for. Two controls
    // for one intention would be one too many.
    plateShowing(highKnees, { isSwapped: true });
    offering(ropeOptions);
    renderRoute("/");

    await userEvent.click(
      await screen.findByRole("button", { name: /swap high knees/i }),
    );
    await screen.findByText("High knees");
    expect(
      screen.queryByRole("button", { name: /^double-unders/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /use what's prescribed/i }),
    ).toBeInTheDocument();
  });
});
