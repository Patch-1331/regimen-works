import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SkillLevel } from "@regimen-works/shared";
import type { ApiExercise } from "../lib/api";
import { api } from "../lib/api";
import { MovementChoicesPanel } from "./MovementChoicesPanel";

/**
 * The first component test in the repo (DN-95). Until now `apps/web` ran
 * Vitest with no DOM, so everything that renders shipped on typecheck, lint
 * and a green build — this panel included, and it was rewritten wholesale in
 * DN-91 without a single assertion on what it puts on screen.
 *
 * Queried through the accessibility tree on purpose. The expander carries
 * `aria-expanded` / `aria-controls` and the chosen movement is marked with
 * `aria-current` as well as by colour; asserting on those is what keeps them
 * from quietly rotting, since nothing else checks them.
 */

vi.mock("../lib/api", () => ({
  api: { setSkillLevel: vi.fn() },
}));

const setSkillLevel = vi.mocked(api.setSkillLevel);

function exercise(partial: Partial<ApiExercise> & { id: string }): ApiExercise {
  return {
    name: partial.id,
    pattern: "pull",
    equipment: [],
    scalable: true,
    unit: "reps",
    movementGroup: "pull",
    sortOrder: 0,
    instructions: null,
    fallbackExerciseId: null,
    phase: null,
    ownerId: null,
    archivedAt: null,
    fallbackExercise: null,
    ...partial,
  };
}

function skill(
  movementGroup: string,
  chosen: { id: string; name: string },
): SkillLevel {
  return {
    id: `sl-${movementGroup}`,
    movementGroup: movementGroup as SkillLevel["movementGroup"],
    exerciseId: chosen.id,
    exerciseName: chosen.name,
    updatedAt: "2026-09-13T10:00:00.000Z",
  };
}

const CHIN_UP = { id: "chin-up", name: "Chin-up" };
const PULL_UP = { id: "pull-up", name: "Pull-up" };

const PULL_LINE = [
  exercise({ id: "negative", name: "Negative chin-up", sortOrder: 0 }),
  exercise({ id: "chin-up", name: "Chin-up", sortOrder: 1 }),
  exercise({ id: "pull-up", name: "Pull-up", sortOrder: 2 }),
];

function renderPanel(skillLevels: SkillLevel[], exercises = PULL_LINE) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MovementChoicesPanel exercises={exercises} skillLevels={skillLevels} />
    </QueryClientProvider>,
  );
}

/**
 * The expander for one line. Found through `aria-controls`, which also checks
 * that the button and the list it opens are actually wired to each other —
 * "Pull" as an accessible name would match the Pull-up option too.
 */
function expander(movementGroup: string) {
  return screen.getByRole("button", {
    name: (_name, element) =>
      element.getAttribute("aria-controls") ===
      `movement-choice-${movementGroup}`,
  });
}

beforeEach(() => {
  setSkillLevel.mockReset();
  setSkillLevel.mockResolvedValue(skill("pull", PULL_UP));
});

describe("MovementChoicesPanel", () => {
  it("explains itself when the athlete has chosen nothing", () => {
    // DN-86 stopped provisioning everyone onto a movement, so this is what a new
    // athlete sees. A bare heading over nothing would read like a failure.
    renderPanel([]);
    expect(
      screen.getByText(/your workouts come exactly as written/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("names the chosen movement under its movementGroup, and hides the rest until asked", () => {
    renderPanel([skill("pull", CHIN_UP)]);

    expect(screen.getByText("Pull")).toBeInTheDocument();
    expect(screen.getByText("Chin-up")).toBeInTheDocument();
    expect(expander("pull")).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Pull-up")).not.toBeInTheDocument();
  });

  it("offers the whole movementGroup in order once expanded, marking only the chosen one", async () => {
    const user = userEvent.setup();
    renderPanel([skill("pull", CHIN_UP)]);

    await user.click(expander("pull"));
    expect(expander("pull")).toHaveAttribute("aria-expanded", "true");

    const options = within(screen.getByRole("list")).getAllByRole("button");
    expect(options.map((o) => o.textContent)).toEqual([
      "Negative chin-up",
      "Chin-up",
      "Pull-up",
    ]);
    // Nothing is cleared or locked — a movement below the choice and one above
    // it are indistinguishable (DN-91).
    expect(options.map((o) => o.getAttribute("aria-current"))).toEqual([
      "false",
      "true",
      "false",
    ]);
  });

  it("saves the picked movement against its movementGroup and closes the list", async () => {
    const user = userEvent.setup();
    renderPanel([skill("pull", CHIN_UP)]);

    await user.click(expander("pull"));
    await user.click(screen.getByRole("button", { name: "Pull-up" }));

    expect(setSkillLevel).toHaveBeenCalledWith("pull", {
      exerciseId: "pull-up",
    });
    await waitFor(() =>
      expect(expander("pull")).toHaveAttribute("aria-expanded", "false"),
    );
  });

  it("does not let the athlete re-pick what is already chosen", async () => {
    const user = userEvent.setup();
    renderPanel([skill("pull", CHIN_UP)]);

    await user.click(expander("pull"));
    await user.click(screen.getByRole("button", { name: "Chin-up" }));

    expect(setSkillLevel).not.toHaveBeenCalled();
  });

  it("says nothing rather than the wrong thing when the choice is not in the library", () => {
    // Their movement has been archived out from under them. The group is
    // still offered in full, so the athlete can pick their way out of the gap.
    renderPanel([skill("pull", { id: "retired", name: "Retired" })]);
    expect(screen.getByText(/not on the current library/i)).toBeInTheDocument();
  });
});
