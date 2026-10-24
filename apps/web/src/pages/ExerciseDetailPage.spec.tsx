import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

describe("putting a movement on your own warm-up or cool-down (DN-173)", () => {
  function withEntries(entries: ReturnType<typeof fixtures.checklistEntry>[]) {
    server.use(http.get("/api/checklist-entries", () => HttpResponse.json(entries)));
  }

  it("says when the movement is on neither of your lists", async () => {
    withEntries([]);
    showing();

    const section = within(await screen.findByRole("region", { name: /your warm-up & cool-down/i }));
    expect(await section.findByText(/not on your warm-up or cool-down/i)).toBeInTheDocument();
  });

  it("lists only the entries for this movement, with the day each is for", async () => {
    withEntries([
      fixtures.checklistEntry({ id: "e1", kind: "warmup", pattern: "push", exercise: { id: "db-bench", name: "Dumbbell bench press" } }),
      fixtures.checklistEntry({ id: "e2", kind: "cooldown", pattern: null, exercise: { id: "db-bench", name: "Dumbbell bench press" } }),
      fixtures.checklistEntry({ id: "e3", kind: "warmup", exercise: { id: "other", name: "Arm circles" } }),
    ]);
    showing();

    const list = within(await screen.findByRole("list", { name: /on your lists/i }));
    expect(list.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      expect.stringContaining("Warm-up · Push days"),
      expect.stringContaining("Cool-down · Any day"),
    ]);
  });

  it("adds it to the list and day chosen, defaulting to the movement's own pattern", async () => {
    withEntries([]);
    let sent: unknown;
    server.use(
      http.post("/api/checklist-entries", async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json(fixtures.checklistEntry(), { status: 201 });
      }),
    );
    showing();

    const list = await screen.findByLabelText("List");
    await userEvent.selectOptions(list, "cooldown");
    expect(screen.getByLabelText("Day")).toHaveValue("push");
    await userEvent.click(screen.getByRole("button", { name: /add to my list/i }));

    await waitFor(() =>
      expect(sent).toEqual({ exerciseId: "db-bench", kind: "cooldown", pattern: "push" }),
    );
  });

  it("sends 'any day' as no pattern", async () => {
    withEntries([]);
    let sent: unknown;
    server.use(
      http.post("/api/checklist-entries", async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json(fixtures.checklistEntry(), { status: 201 });
      }),
    );
    showing();

    await userEvent.selectOptions(await screen.findByLabelText("Day"), "");
    await userEvent.click(screen.getByRole("button", { name: /add to my list/i }));

    await waitFor(() =>
      expect(sent).toEqual({ exerciseId: "db-bench", kind: "warmup", pattern: null }),
    );
  });

  it("says what the API said when the movement is already on that list", async () => {
    withEntries([]);
    server.use(
      http.post("/api/checklist-entries", () =>
        HttpResponse.json(
          { message: "Dumbbell bench press is already on your warm-up." },
          { status: 409 },
        ),
      ),
    );
    showing();

    await userEvent.click(await screen.findByRole("button", { name: /add to my list/i }));

    expect(
      await screen.findByText("Dumbbell bench press is already on your warm-up."),
    ).toBeInTheDocument();
  });

  it("takes it off a list", async () => {
    withEntries([
      fixtures.checklistEntry({ id: "e1", kind: "warmup", pattern: "push", exercise: { id: "db-bench", name: "Dumbbell bench press" } }),
    ]);
    let removed: string | undefined;
    server.use(
      http.delete("/api/checklist-entries/:id", ({ params }) => {
        removed = params.id as string;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    showing();

    await userEvent.click(
      await screen.findByRole("button", { name: /remove from warm-up · push days/i }),
    );

    await waitFor(() => expect(removed).toBe("e1"));
  });

  it("offers no add for a retired movement", async () => {
    withEntries([]);
    showing({ ...BENCH_PRESS, archivedAt: "2026-09-01T00:00:00.000Z" });

    await screen.findByText("RETIRED");
    expect(screen.queryByRole("button", { name: /add to my list/i })).not.toBeInTheDocument();
  });
});

describe("a movement's prescribed days (DN-192)", () => {
  const { movementHistory, movementHistoryDay, movementHistorySet } = fixtures;

  /** The bench page, with these days in its history and another movement's beside it. */
  function trained(days: ReturnType<typeof movementHistoryDay>[]) {
    server.use(
      http.get("/api/movement-history", () =>
        HttpResponse.json([
          movementHistory({ exerciseId: "db-bench", name: "Dumbbell bench press", days }),
          movementHistory({ exerciseId: "push-up", name: "Push-up" }),
        ]),
      ),
    );
    showing();
  }

  async function rows() {
    const list = await screen.findByRole("list", { name: /prescribed days/i });
    return within(list).getAllByRole("listitem").map((li) => li.textContent);
  }

  it("lists a reverse-pyramid day set by set, each with its load step", async () => {
    trained([
      movementHistoryDay({
        date: "2026-10-20",
        name: "Strength",
        reps: 6,
        repsMax: 8,
        sets: [
          movementHistorySet({ reps: 6, repsMax: 8 }),
          movementHistorySet({ reps: 8, repsMax: 10, loadStepPercent: -10 }),
          movementHistorySet({ reps: 10, repsMax: 12, loadStepPercent: -10 }),
        ],
      }),
    ]);

    const [day] = await rows();
    expect(day).toContain("6-8 · 8-10 −10% · 10-12 −10%");
    expect(day).toContain("Strength");
    // Relative steps only: the history holds no weight, and none is invented.
    expect(day).not.toMatch(/kg|lb/i);
  });

  it("reads a day of identical sets as sets × reps", async () => {
    trained([
      movementHistoryDay({
        date: "2026-10-13",
        name: "Strength",
        reps: 5,
        sets: Array.from({ length: 5 }, () => movementHistorySet()),
      }),
    ]);

    expect((await rows())[0]).toContain("5 × 5");
  });

  it("gives a WOD day its whole count, since it had rounds rather than sets", async () => {
    trained([movementHistoryDay({ date: "2026-09-14", name: "Cindy", reps: 30 })]);

    const [day] = await rows();
    expect(day).toContain("30");
    expect(day).toContain("Cindy");
    expect(day).not.toContain("×");
  });

  it("keeps the days newest first, as the history gives them", async () => {
    trained([
      movementHistoryDay({ date: "2026-10-20", name: "Strength", sets: [movementHistorySet()] }),
      movementHistoryDay({ date: "2026-09-14", name: "Cindy" }),
    ]);

    const [first, second] = await rows();
    expect(first).toContain("Strength");
    expect(second).toContain("Cindy");
  });

  it("says nothing for a movement never trained, rather than a count of nothing", async () => {
    let served = false;
    server.use(
      http.get("/api/movement-history", () => {
        served = true;
        // Another movement's days only.
        return HttpResponse.json([movementHistory({ exerciseId: "push-up" })]);
      }),
    );
    showing();

    await screen.findByText("Lie back on the bench.");
    await waitFor(() => expect(served).toBe(true));
    expect(screen.queryByText("PRESCRIBED")).not.toBeInTheDocument();
  });
});
