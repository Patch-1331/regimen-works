import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SwapRow, SwapRows } from "../lib/swapOptions";
import { SwapPanel } from "./MovementSwap";

/**
 * What the panel says about a movement the athlete did not choose.
 *
 * Two different things can put a movement on the plate that the library never
 * prescribed: a standing choice the athlete made once (DN-88), and the app
 * dropping a movement they own no equipment for (DN-79). They arrive through
 * the same field and they must not read the same — "your pick" about a
 * substitution the app made is untrue, and sends someone hunting for a
 * setting they never touched.
 *
 * Asserted on the rendered copy rather than a prop, because the copy is the
 * whole point: the reason field exists to be read by an athlete.
 */

const row = (overrides: Partial<SwapRow> & { exerciseId: string; name: string }): SwapRow => ({
  isCurrent: false,
  isAlternative: false,
  isPrescribed: false,
  ...overrides,
});

const current = row({
  exerciseId: "row",
  name: "Row under table",
  isCurrent: true,
  isAlternative: true,
});

const options: SwapRows = { main: [current], harder: [], needsEquipment: [] };

/** The same list with the prescribed movement back on it (DN-110). */
const withPrescribed: SwapRows = {
  ...options,
  main: [current, row({ exerciseId: "pull-up", name: "Pull-up", isPrescribed: true })],
};

function panel(props: Partial<Parameters<typeof SwapPanel>[0]> = {}) {
  return render(
    <SwapPanel
      id="swap-panel"
      rows={options}
      isSwapped={false}
      prescribedName={null}
      prescribedReason={null}
      onPick={() => {}}
      onRevert={() => {}}
      {...props}
    />,
  );
}

describe("SwapPanel prescription note", () => {
  it("says nothing when the movement is the one prescribed", () => {
    panel();
    expect(screen.queryByText(/the workout says/i)).not.toBeInTheDocument();
  });

  it("calls a remembered choice the athlete's own", () => {
    panel({
      prescribedName: "Pull-up",
      prescribedReason: "remembered_choice",
    });
    expect(screen.getByText("Your pick. The workout says pull-up.")).toBeInTheDocument();
  });

  it("does not call an equipment substitution the athlete's pick", () => {
    panel({ prescribedName: "Pull-up", prescribedReason: "equipment" });

    expect(
      screen.getByText("Not in your equipment. The workout says pull-up."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/your pick/i)).not.toBeInTheDocument();
  });

  it("stops naming the prescribed movement once it is on the list", () => {
    // The note exists because the movement was unreachable. Once it is a row
    // in the list above, repeating its name is the app talking to itself —
    // and the sentence's flat statement of fact reads as final next to a
    // control that now offers a way out of it.
    panel({
      rows: withPrescribed,
      prescribedName: "Pull-up",
      prescribedReason: "equipment",
    });

    expect(screen.queryByText(/the workout says/i)).not.toBeInTheDocument();
    expect(
      screen.getByText("Not in your equipment — take it anyway if you have one today."),
    ).toBeInTheDocument();
  });

  it("still tells a remembered choice apart from an equipment fallback when both are offered", () => {
    // The shorter wording must not collapse the two readings the note exists
    // to keep apart: a standing choice is the athlete's own.
    panel({
      rows: withPrescribed,
      prescribedName: "Pull-up",
      prescribedReason: "remembered_choice",
    });

    expect(
      screen.getByText("Your standing pick — the workout's own is marked."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/not in your equipment/i)).not.toBeInTheDocument();
  });

  it("marks which row the workout asked for", () => {
    // Outside a group the two rows are near-identical movements, and which is
    // which decides the tap.
    panel({ rows: withPrescribed, prescribedName: "Pull-up", prescribedReason: "equipment" });
    expect(screen.getByText("PRESCRIBED")).toBeInTheDocument();
  });

  it("falls back to the athlete's own wording on a payload with no reason", () => {
    // Older payloads carry the name and no reason. Every one of them predates
    // the equipment layer, so the remembered choice is the honest reading.
    panel({ prescribedName: "Pull-up", prescribedReason: null });
    expect(screen.getByText("Your pick. The workout says pull-up.")).toBeInTheDocument();
  });
});

/**
 * The three sections (DN-170): what the athlete can do, what is harder, and
 * what needs kit they haven't listed. The headings describe the exercise,
 * never the athlete (ADR-0004, ADR-0007).
 */
describe("SwapPanel sections", () => {
  const sections: SwapRows = {
    main: [current, row({ exerciseId: "negative", name: "Negative chin-up" })],
    harder: [row({ exerciseId: "pull-up", name: "Pull-up" })],
    needsEquipment: [row({ exerciseId: "ring-row", name: "Ring row" })],
  };

  it("lists the main section, then the harder ones under their own heading", () => {
    panel({ rows: sections });
    const names = screen.getAllByRole("button").map((b) => b.textContent);
    expect(names.slice(0, 3)).toEqual([
      "Row under tableNO KIT",
      "Negative chin-up",
      "Pull-up",
    ]);
    expect(screen.getByText("HARDER OPTIONS")).toBeInTheDocument();
  });

  it("keeps what needs unlisted equipment collapsed until asked", async () => {
    panel({ rows: sections });
    const toggle = screen.getByRole("button", { name: /needs equipment you haven't listed/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Ring row")).not.toBeInTheDocument();

    await userEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const list = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    expect(within(list).getByRole("button", { name: "Ring row" })).toBeInTheDocument();
  });

  it("picks from the collapsed section like any other", async () => {
    const onPick = vi.fn();
    panel({ rows: sections, onPick });
    await userEvent.click(
      screen.getByRole("button", { name: /needs equipment you haven't listed/i }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Ring row" }));
    expect(onPick).toHaveBeenCalledWith("ring-row");
  });

  it("leaves out a heading with nothing under it", () => {
    panel({ rows: { ...sections, harder: [], needsEquipment: [] } });
    expect(screen.queryByText("HARDER OPTIONS")).not.toBeInTheDocument();
    expect(screen.queryByText(/needs equipment/i)).not.toBeInTheDocument();
  });

  it("says so when the library has nothing to move to", () => {
    panel({ rows: options });
    expect(screen.getByText("Nothing in the library matches this movement.")).toBeInTheDocument();
  });

  it("says it is looking while the options load", () => {
    panel({ rows: null });
    expect(screen.getByText("Finding matches…")).toBeInTheDocument();
  });

  it("says when they could not be loaded", () => {
    panel({ rows: null, failed: true });
    expect(screen.getByText("Couldn't load the options. Close and try again.")).toBeInTheDocument();
  });
});
