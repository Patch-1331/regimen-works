import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Equipment } from "@regimen-works/shared";
import { renderRoute } from "../test/renderRoute";
import { server, http, HttpResponse } from "../test/server";
import * as fixtures from "../test/fixtures";

/**
 * The Settings screen where the athlete says what they own (DN-35).
 *
 * Driven through the real route rather than the component, because what is
 * being checked is mostly what leaves the page: `equipment` is a whole-set
 * replacement with no add or remove verb, so a PATCH that carries one piece
 * is not "add one", it is "this is all I own".
 */

vi.mock("@clerk/clerk-react", async () => {
  const { clerkTestDouble } = await import("../test/clerk");
  return clerkTestDouble();
});

/** Serves settings with the given kit, and records every PATCH body sent. */
function settingsOwning(owned: Equipment[]) {
  const patches: { equipment?: Equipment[] }[] = [];
  let current = fixtures.settings({ equipment: owned });

  server.use(
    http.get("/api/settings", () => HttpResponse.json(current)),
    http.patch("/api/settings", async ({ request }) => {
      const body = (await request.json()) as { equipment?: Equipment[] };
      patches.push(body);
      current = { ...current, ...body };
      return HttpResponse.json(current);
    }),
  );

  return patches;
}

describe("equipment in Settings", () => {
  it("lists every piece in the catalog, with what counts as owning it", () => {
    settingsOwning(["bar"]);
    renderRoute("/settings");

    return waitFor(() => {
      expect(screen.getByRole("checkbox", { name: /pull-up bar/i })).toBeChecked();
      expect(screen.getByRole("checkbox", { name: /jump rope/i })).not.toBeChecked();
      expect(screen.getByRole("checkbox", { name: /box or step/i })).not.toBeChecked();
      expect(screen.getByRole("checkbox", { name: /dumbbell/i })).not.toBeChecked();
      expect(screen.getByRole("checkbox", { name: /kettlebell/i })).not.toBeChecked();
      // The catalog's copy, not the screen's: what the app will accept as a box.
      expect(screen.getByText(/bottom stair/i)).toBeInTheDocument();
    });
  });

  it("offers the bar like any other piece", async () => {
    // DN-35 said to leave the bar out as the assumed baseline; the catalog
    // written after it says the opposite, and an athlete with no doorway to
    // hang from has to be able to say so.
    settingsOwning(["bar"]);
    renderRoute("/settings");

    const bar = await screen.findByRole("checkbox", { name: /pull-up bar/i });
    expect(bar).toBeEnabled();
  });

  it("sends the whole set when a piece is ticked, not just the piece", async () => {
    const patches = settingsOwning(["bar"]);
    renderRoute("/settings");

    await userEvent.click(await screen.findByRole("checkbox", { name: /kettlebell/i }));

    // The field is a whole-set replacement: sending `["kettlebell"]` here
    // would silently take the athlete's bar away.
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0].equipment).toEqual(["bar", "kettlebell"]);
  });

  it("drops only the piece unticked", async () => {
    const patches = settingsOwning(["bar", "jump_rope", "box"]);
    renderRoute("/settings");

    await userEvent.click(await screen.findByRole("checkbox", { name: /jump rope/i }));

    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0].equipment).toEqual(["bar", "box"]);
  });

  it("builds the next set from what the server last said, not from the first render", async () => {
    // The clobber DN-35 warns about: a set built from state captured at mount
    // would still hold the kit from before the first tick, and the second
    // write would undo the first.
    const patches = settingsOwning(["bar"]);
    renderRoute("/settings");

    await userEvent.click(await screen.findByRole("checkbox", { name: /dumbbell/i }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: /dumbbell/i })).toBeChecked());
    await userEvent.click(screen.getByRole("checkbox", { name: /box or step/i }));

    await waitFor(() => expect(patches).toHaveLength(2));
    expect(patches[1].equipment).toEqual(["bar", "dumbbell", "box"]);
  });

  it("says what owning nothing means rather than refusing it", async () => {
    settingsOwning([]);
    renderRoute("/settings");

    expect(
      await screen.findByText(/every workout will be built from bodyweight movements alone/i),
    ).toBeInTheDocument();
    // An empty set is a real answer, so nothing is disabled or forced back on.
    expect(screen.getByRole("checkbox", { name: /pull-up bar/i })).not.toBeChecked();
  });

  it("keeps the warning that a change lands on the next workout", async () => {
    settingsOwning(["bar"]);
    renderRoute("/settings");

    expect(
      await screen.findByText(/takes effect on your next workout/i),
    ).toBeInTheDocument();
  });
});
