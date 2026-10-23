import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CreateProgram, ProgramSummary } from "@regimen-works/shared";
import { renderRoute } from "../test/renderRoute";
import { server, http, HttpResponse } from "../test/server";
import * as fixtures from "../test/fixtures";

/** `count` sets, each matching `set`: a pasted line is that many identical sets. */
const times = (count: number, set: object) =>
  Array.from({ length: count }, () => expect.objectContaining(set));

vi.mock("@clerk/clerk-react", async () => {
  const { clerkTestDouble } = await import("../test/clerk");
  return clerkTestDouble();
});

/**
 * Pasting a program in (DN-152): the read-back, answering its refusals, and
 * the hand-off to the week sheet -- which is where it is saved, like any
 * program typed there.
 */

const SQUAT = fixtures.apiExercise({
  id: "squat",
  name: "Barbell squat",
  equipment: ["barbell"],
  movementGroup: null,
});
const FLOOR = fixtures.apiExercise({
  id: "floor",
  name: "Floor press",
  equipment: ["barbell"],
  movementGroup: null,
});
const CROSSOVER = fixtures.apiExercise({
  id: "crossover",
  name: "Low cable crossover",
  equipment: ["gym_machines"],
  movementGroup: null,
});

const SAVED: ProgramSummary = {
  id: "program-1",
  name: "Pasted",
  summary: "Your program, Mon and Wed",
  scheduleMode: "fixed",
  days: [1, 3],
  archived: false,
};

function api() {
  const sent: CreateProgram[] = [];
  server.use(
    http.get("/api/me", () =>
      HttpResponse.json({
        id: "user_alice",
        isAdmin: false,
        onboardedAt: "2026-09-01T00:00:00.000Z",
      }),
    ),
    http.get("/api/exercises", () => HttpResponse.json([SQUAT, FLOOR, CROSSOVER])),
    http.get("/api/programs/library", () => HttpResponse.json([])),
    http.get("/api/programs", () => HttpResponse.json([])),
    http.post("/api/programs", async ({ request }) => {
      sent.push((await request.json()) as CreateProgram);
      return HttpResponse.json(SAVED, { status: 201 });
    }),
  );
  return sent;
}

const PASTED = `Monday — Legs
Barbell Squat 5x5 @ 225
Low Cable Fly 4x8-10
Wednesday
Floor Press 2x10-15 & 2x5-8
Dips 3x8`;

async function pasteAndRead() {
  const box = await screen.findByLabelText("Pasted program");
  await userEvent.click(box);
  await userEvent.paste(PASTED);
  await userEvent.click(screen.getByRole("button", { name: "Read it" }));
}

describe("pasting a program", () => {
  it("is offered from Your programs", async () => {
    api();
    renderRoute("/programs");
    await userEvent.click(
      await screen.findByRole("link", { name: /paste a program in/i }),
    );
    expect(await screen.findByLabelText("Pasted program")).toBeInTheDocument();
  });

  it("reads every line back, refusing what it cannot match", async () => {
    api();
    renderRoute("/programs/paste");
    await pasteAndRead();

    const monday = screen.getByRole("region", { name: "Mon" });
    expect(within(monday).getByText("✓ Barbell squat")).toBeInTheDocument();
    expect(
      within(monday).getByText("Load 225 dropped — the app doesn't track weight."),
    ).toBeInTheDocument();
    expect(within(monday).getByText("✕ Low Cable Fly")).toBeInTheDocument();
    expect(
      within(monday).getByText("Nothing in the library is this movement."),
    ).toBeInTheDocument();

    const wednesday = screen.getByRole("region", { name: "Wed" });
    expect(within(wednesday).getByText("✓ Floor press")).toBeInTheDocument();
    expect(within(wednesday).getByText("2 × 10–15 & 2 × 5–8")).toBeInTheDocument();

    expect(screen.getByText("2 lines to pick or leave out.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open on the week sheet" }),
    ).toBeDisabled();
  });

  it("shows a guess as a guess", async () => {
    api();
    renderRoute("/programs/paste");
    const box = await screen.findByLabelText("Pasted program");
    await userEvent.click(box);
    await userEvent.paste("Barbell Squats 5x5");
    await userEvent.click(screen.getByRole("button", { name: "Read it" }));

    expect(screen.getByText("✓ Barbell squat")).toBeInTheDocument();
    expect(screen.getByText("Read “Barbell Squats” as this.")).toBeInTheDocument();
  });

  it("leaves a line out, and puts it back", async () => {
    api();
    renderRoute("/programs/paste");
    await pasteAndRead();

    const wednesday = screen.getByRole("region", { name: "Wed" });
    const dips = within(wednesday).getByText("✕ Dips").closest("li")!;
    await userEvent.click(within(dips).getByRole("button", { name: "LEAVE IT OUT" }));
    expect(within(wednesday).getByText("Left out")).toBeInTheDocument();
    expect(screen.getByText("1 line to pick or leave out.")).toBeInTheDocument();

    await userEvent.click(within(wednesday).getByRole("button", { name: "UNDO" }));
    expect(within(wednesday).getByText("✕ Dips")).toBeInTheDocument();
    expect(screen.getByText("2 lines to pick or leave out.")).toBeInTheDocument();
  });

  it("hands the answered lines to the week sheet, and saves from there", async () => {
    const sent = api();
    renderRoute("/programs/paste");
    await pasteAndRead();

    const monday = screen.getByRole("region", { name: "Mon" });
    const fly = within(monday).getByText("✕ Low Cable Fly").closest("li")!;
    await userEvent.click(within(fly).getByRole("button", { name: "PICK FROM LIBRARY" }));
    const search = within(fly).getByLabelText("Search movements");
    expect(search).toHaveValue("Low Cable Fly");
    await userEvent.clear(search);
    await userEvent.type(search, "crossover");
    await userEvent.click(
      within(fly).getByRole("button", { name: /^Low cable crossover/ }),
    );
    expect(within(monday).getByText("✓ Low cable crossover")).toBeInTheDocument();
    expect(within(monday).getByText("Picked for “Low Cable Fly”.")).toBeInTheDocument();

    const wednesday = screen.getByRole("region", { name: "Wed" });
    const dips = within(wednesday).getByText("✕ Dips").closest("li")!;
    await userEvent.click(within(dips).getByRole("button", { name: "LEAVE IT OUT" }));

    await userEvent.click(screen.getByRole("button", { name: "Open on the week sheet" }));

    expect(
      await screen.findByText("Pasted in. Nothing is saved until you save it."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Name for Mon")).toHaveValue("Legs");
    expect(screen.getByLabelText("Name for Wed")).toHaveValue("");
    await userEvent.type(screen.getByLabelText("Program name"), "Pasted");
    await userEvent.click(screen.getByRole("button", { name: "Save program" }));

    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({
      name: "Pasted",
      scheduleMode: "fixed",
      days: [
        {
          dayOfWeek: 1,
          label: "Legs",
          lines: [
            { exerciseId: "squat", sets: times(5, { reps: 5 }) },
            { exerciseId: "crossover", sets: times(4, { reps: 8, repsMax: 10 }) },
          ],
        },
        {
          dayOfWeek: 3,
          lines: [
            { exerciseId: "floor", sets: times(2, { reps: 10, repsMax: 15 }) },
            { exerciseId: "floor", sets: times(2, { reps: 5, repsMax: 8 }) },
          ],
        },
      ],
    });
  });
});
