import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderRoute } from "../test/renderRoute";
import { server, http, HttpResponse } from "../test/server";
import * as fixtures from "../test/fixtures";

/**
 * One movement, read in full (DN-171). Through the real route, because the
 * link from the list and the `:id` it carries are half of what is under test.
 */

vi.mock("@clerk/clerk-react", async () => {
  const { clerkTestDouble } = await import("../test/clerk");
  return clerkTestDouble();
});

const BENCH_PRESS = fixtures.apiExercise({
  id: "db-bench",
  name: "Dumbbell bench press",
  key: "Dumbbell_Bench_Press",
  pattern: "push",
  movementGroup: "push_horizontal",
  equipment: ["dumbbell", "bench"],
  primaryMuscles: ["chest"],
  secondaryMuscles: ["shoulders", "triceps"],
  level: "intermediate",
  force: "push",
  mechanic: "compound",
  category: "strength",
  instructions: ["Lie back on the bench.", "Press the dumbbells up.", "Lower them slowly."],
  fallbackExercise: { id: "push-up", name: "Push-up" },
});

/** The movement page for `exercise`, as an athlete owning `equipment`. */
function showing(exercise = BENCH_PRESS, equipment: string[] = ["dumbbell"]) {
  server.use(
    http.get("/api/exercises/:id", () => HttpResponse.json(exercise)),
    http.get("/api/settings", () =>
      HttpResponse.json(fixtures.settings({ equipment: equipment as never })),
    ),
  );
  renderRoute(`/library/movements/${exercise.id}`);
}

describe("a movement's detail view", () => {
  it("reads the instructions out as numbered steps", async () => {
    showing();

    const ordered = (await screen.findByText("Lie back on the bench.")).closest("ol")!;
    expect(within(ordered).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Lie back on the bench.",
      "Press the dumbbells up.",
      "Lower them slowly.",
    ]);
  });

  it("names the muscles it works, prime movers first", async () => {
    showing();

    expect(await screen.findByText("Chest")).toBeInTheDocument();
    expect(screen.getByText("Shoulders, Triceps")).toBeInTheDocument();
  });

  it("marks which of the equipment the athlete has", async () => {
    showing();

    const kit = within(await screen.findByRole("list", { name: /equipment needed/i }));
    expect(kit.getByText("Dumbbell").closest("li")).toHaveTextContent("YOU HAVE THIS");
    expect(kit.getByText(/bench/i).closest("li")).toHaveTextContent("NOT IN YOUR EQUIPMENT");
  });

  it("describes the exercise, and the level as the exercise's", async () => {
    showing();

    await screen.findByText("Lie back on the bench.");
    for (const [term, value] of [
      ["Level", "Intermediate"],
      ["Category", "Strength"],
      ["Force", "Push"],
      ["Mechanic", "Compound"],
      ["Group", "Push · Horizontal"],
    ]) {
      expect(screen.getByText(term, { selector: "dt" }).nextSibling).toHaveTextContent(value);
    }
    // A fact about the movement, never a comparison with the athlete.
    expect(screen.queryByText(/your level|too hard|ready/i)).not.toBeInTheDocument();
  });

  it("links the alternative for when the kit isn't there", async () => {
    showing();

    expect(await screen.findByRole("link", { name: "Push-up" })).toHaveAttribute(
      "href",
      "/library/movements/push-up",
    );
  });

  it("shows no image, and no space where one would be", async () => {
    showing();

    await screen.findByText("Lie back on the bench.");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(document.querySelector("img, picture, figure")).toBeNull();
  });

  it("credits the dataset on a movement that came from it", async () => {
    showing();
    expect(await screen.findByText(/free-exercise-db/i)).toBeInTheDocument();
  });

  it("says so plainly on an athlete's own movement with nothing described", async () => {
    showing(
      fixtures.apiExercise({
        id: "mine",
        name: "Sandbag carry",
        ownerId: "user_alice",
        movementGroup: null,
        key: null,
      }),
    );

    expect(await screen.findByText("YOURS")).toBeInTheDocument();
    expect(screen.getByText("Not described.")).toBeInTheDocument();
    expect(screen.getByText("None — bodyweight.")).toBeInTheDocument();
    expect(screen.getByText("No written instructions yet.")).toBeInTheDocument();
    // Their own movement is not the dataset's to credit.
    expect(screen.queryByText(/free-exercise-db/i)).not.toBeInTheDocument();
  });

  it("says a retired movement is retired", async () => {
    showing({ ...BENCH_PRESS, archivedAt: "2026-09-01T00:00:00.000Z" });
    expect(await screen.findByText("RETIRED")).toBeInTheDocument();
  });

  it("says there is nothing there for a movement it may not see", async () => {
    server.use(
      http.get("/api/exercises/:id", () =>
        HttpResponse.json({ message: "No such movement" }, { status: 404 }),
      ),
    );
    renderRoute("/library/movements/theirs");

    expect(await screen.findByText(/there's no movement here/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /← movements/i })).toHaveAttribute("href", "/library");
  });
});
