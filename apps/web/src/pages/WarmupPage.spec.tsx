import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderRoute } from "../test/renderRoute";
import * as fixtures from "../test/fixtures";

/**
 * A ticked warm-up item is struck through (DN-184).
 *
 * Asserted on the style itself because that is what broke: the DN-134 rename
 * turned "line-through" into "movementGroup-through", which the browser drops
 * without a word, so a ticked item looked exactly like an unticked one.
 */

vi.mock("@clerk/clerk-react", async () => {
  const { clerkTestDouble } = await import("../test/clerk");
  return clerkTestDouble();
});

describe("WarmupPage", () => {
  it("strikes through an item once it is ticked, and only then", async () => {
    renderRoute(`/warmup/${fixtures.ASSIGNMENT_ID}`);
    const name = await screen.findByText("ARM CIRCLES");
    expect(name.style.textDecoration).toBe("none");

    await userEvent.click(name);
    expect(name.style.textDecoration).toBe("line-through");

    await userEvent.click(name);
    expect(name.style.textDecoration).toBe("none");
  });
});
