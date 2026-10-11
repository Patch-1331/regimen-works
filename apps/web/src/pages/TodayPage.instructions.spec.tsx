import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderRoute } from "../test/renderRoute";
import { server, http, HttpResponse } from "../test/server";
import * as fixtures from "../test/fixtures";

/**
 * A movement's instructions on the plate, now that they are steps (DN-165).
 *
 * Driven through the page because the change that can go wrong is in the
 * page's own checks: "no copy" used to be null and is now an empty list, and
 * an empty list is truthy — a row testing `instructions` directly would grow a
 * caret that opens onto nothing.
 */

vi.mock("@clerk/clerk-react", async () => {
  const { clerkTestDouble } = await import("../test/clerk");
  return clerkTestDouble();
});

function plateWith(instructions: string[]) {
  server.use(
    http.get("/api/exercises", () => HttpResponse.json([])),
    http.get("/api/today", () =>
      HttpResponse.json(
        fixtures.today({
          assignment: {
            ...fixtures.today().assignment!,
            wod: fixtures.wod({
              movements: [fixtures.movement({ exercise: { ...fixtures.movement().exercise, instructions } })],
            }),
          },
        }),
      ),
    ),
  );
}

describe("instructions on the WOD plate", () => {
  it("numbers a movement's steps when it has several", async () => {
    plateWith([
      "Hands under the shoulders, body in one line.",
      "Lower until your chest nearly touches the floor.",
      "Press back up.",
    ]);
    renderRoute("/");

    await userEvent.click(await screen.findByRole("button", { name: /how to do push-up/i }));

    const steps = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(steps.map((s) => s.textContent)).toEqual([
      "Hands under the shoulders, body in one line.",
      "Lower until your chest nearly touches the floor.",
      "Press back up.",
    ]);
  });

  it("shows a single step as plain prose, not a list of one", async () => {
    // Every row from before the import is exactly this: its old prose, whole.
    plateWith(["Hands under the shoulders, body in one line."]);
    renderRoute("/");

    await userEvent.click(await screen.findByRole("button", { name: /how to do push-up/i }));

    expect(screen.getByText("Hands under the shoulders, body in one line.")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("leaves a movement with no steps as an inert label", async () => {
    plateWith([]);
    renderRoute("/");

    await screen.findByText("PUSH-UP");
    expect(screen.queryByRole("button", { name: /how to do push-up/i })).not.toBeInTheDocument();
  });
});
