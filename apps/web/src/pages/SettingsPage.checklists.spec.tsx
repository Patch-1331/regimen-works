import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReorderChecklistEntries } from "@regimen-works/shared";
import { renderRoute } from "../test/renderRoute";
import { server, http, HttpResponse } from "../test/server";
import * as fixtures from "../test/fixtures";

/**
 * The athlete's own warm-up and cool-down lists in Settings (DN-173): seen in
 * the order the checklist will show them, moved and removed from here.
 */

vi.mock("@clerk/clerk-react", async () => {
  const { clerkTestDouble } = await import("../test/clerk");
  return clerkTestDouble();
});

const ENTRIES = [
  fixtures.checklistEntry({ id: "w1", kind: "warmup", pattern: null, sortOrder: 0, exercise: { id: "a", name: "Arm circles" } }),
  fixtures.checklistEntry({ id: "w2", kind: "warmup", pattern: "squat", sortOrder: 1, exercise: { id: "b", name: "Air squat" } }),
  fixtures.checklistEntry({ id: "w3", kind: "warmup", pattern: "pull", sortOrder: 2, exercise: { id: "c", name: "Scap pull-up" } }),
  fixtures.checklistEntry({ id: "c1", kind: "cooldown", pattern: null, sortOrder: 0, exercise: { id: "d", name: "Child's pose" } }),
];

function showing(entries = ENTRIES) {
  server.use(http.get("/api/checklist-entries", () => HttpResponse.json(entries)));
  renderRoute("/settings");
}

function names(list: HTMLElement) {
  return within(list)
    .getAllByRole("listitem")
    .map((li) => li.textContent);
}

describe("my warm-up & cool-down in Settings", () => {
  it("shows each list in its set order, with the day each entry is for", async () => {
    showing();

    const warmup = await screen.findByRole("list", { name: "My warm-up" });
    expect(names(warmup)).toEqual([
      expect.stringContaining("Arm circlesAny day"),
      expect.stringContaining("Air squatSquat days"),
      expect.stringContaining("Scap pull-upPull days"),
    ]);
    expect(names(screen.getByRole("list", { name: "My cool-down" }))).toEqual([
      expect.stringContaining("Child's pose"),
    ]);
  });

  it("points at the library when the athlete has nothing of their own", async () => {
    showing([]);

    const section = within(await screen.findByRole("region", { name: /my warm-up & cool-down/i }));
    expect(await section.findAllByText("Nothing of your own yet.")).toHaveLength(2);
    expect(section.getByText(/from any movement's page in the library/i)).toBeInTheDocument();
  });

  it("moves an entry up by sending the whole list in its new order", async () => {
    let sent: ReorderChecklistEntries | undefined;
    server.use(
      http.put("/api/checklist-entries/order", async ({ request }) => {
        sent = (await request.json()) as ReorderChecklistEntries;
        return HttpResponse.json([]);
      }),
    );
    showing();

    await userEvent.click(await screen.findByRole("button", { name: "Move Scap pull-up up" }));

    await waitFor(() => expect(sent).toEqual({ kind: "warmup", entryIds: ["w1", "w3", "w2"] }));
  });

  it("cannot move the first entry up or the last one down", async () => {
    showing();

    expect(await screen.findByRole("button", { name: "Move Arm circles up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Scap pull-up down" })).toBeDisabled();
    // A list of one cannot move at all.
    expect(screen.getByRole("button", { name: "Move Child's pose up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Child's pose down" })).toBeDisabled();
  });

  it("removes an entry", async () => {
    let removed: string | undefined;
    server.use(
      http.delete("/api/checklist-entries/:id", ({ params }) => {
        removed = params.id as string;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    showing();

    await userEvent.click(
      await screen.findByRole("button", { name: "Remove Child's pose from cool-down" }),
    );

    await waitFor(() => expect(removed).toBe("c1"));
  });

  it("says so when the list changed under a stale screen", async () => {
    server.use(
      http.put("/api/checklist-entries/order", () =>
        HttpResponse.json(
          { message: "Your warm-up has changed since it was loaded. Reload and try again." },
          { status: 409 },
        ),
      ),
    );
    showing();

    await userEvent.click(await screen.findByRole("button", { name: "Move Air squat up" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/has changed since it was loaded/i);
  });
});
