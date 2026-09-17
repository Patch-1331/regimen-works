import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SwapOption } from "../lib/swapOptions";
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

const options: SwapOption[] = [
  {
    exerciseId: "row",
    name: "Row under table",
    rung: null,
    isCurrent: true,
    isAlternative: true,
    isPrescribed: false,
  },
];

/** The same list with the prescribed movement back on it (DN-110). */
const withPrescribed: SwapOption[] = [
  ...options,
  {
    exerciseId: "pull-up",
    name: "Pull-up",
    rung: null,
    isCurrent: false,
    isAlternative: false,
    isPrescribed: true,
  },
];

function panel(props: Partial<Parameters<typeof SwapPanel>[0]> = {}) {
  return render(
    <SwapPanel
      id="swap-panel"
      options={options}
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
      options: withPrescribed,
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
      options: withPrescribed,
      prescribedName: "Pull-up",
      prescribedReason: "remembered_choice",
    });

    expect(
      screen.getByText("Your standing pick — the workout's own is marked."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/not in your equipment/i)).not.toBeInTheDocument();
  });

  it("marks which row the workout asked for", () => {
    // Off the ladder the two rows are near-identical movements, and which is
    // which decides the tap.
    panel({ options: withPrescribed, prescribedName: "Pull-up", prescribedReason: "equipment" });
    expect(screen.getByText("PRESCRIBED")).toBeInTheDocument();
  });

  it("falls back to the athlete's own wording on a payload with no reason", () => {
    // Older payloads carry the name and no reason. Every one of them predates
    // the equipment layer, so the remembered choice is the honest reading.
    panel({ prescribedName: "Pull-up", prescribedReason: null });
    expect(screen.getByText("Your pick. The workout says pull-up.")).toBeInTheDocument();
  });
});
