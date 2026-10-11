import { useEffect } from "react";

/**
 * The disclosure for a movement's instructions (Exercise.instructions).
 *
 * Pieces rather than one row component, because the surfaces that show a
 * movement don't share a row: Today lists name + count, the warm-up and
 * cool-down screens list a checkbox that has to keep toggling on tap. Each
 * owns its row and its open/closed state; these just keep the caret and the
 * prose looking the same wherever they land.
 *
 * Two shapes, chosen by what the screen can afford. Off the clock the steps
 * expand in place (`InstructionsPanel`). On a live timer nothing may move —
 * the round button has to stay exactly where the thumb last found it — so
 * the same steps arrive as an overlay instead (`InstructionsPeek`).
 */


/**
 * The steps themselves, in whichever frame holds them. One step is a
 * paragraph, because a numbered list of one reads as a list with the rest
 * missing — and every row from before the import is exactly one step, its
 * old prose whole. Two or more are numbered, in the dataset's order.
 */
function Steps({ steps, className }: { steps: readonly string[]; className: string }) {
  const style = { borderColor: "var(--glow-dim)", color: "var(--ink-soft)" };
  if (steps.length === 1) {
    return (
      <p className={className} style={style}>
        {steps[0]}
      </p>
    );
  }
  return (
    <ol className={`${className} list-inside list-decimal space-y-1.5`} style={style}>
      {steps.map((step, i) => (
        <li key={i}>{step}</li>
      ))}
    </ol>
  );
}

/** Caret for a row that can expand — points right when closed, down when open. */
export function InstructionsCaret({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--ink-faint)"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      width={12}
      height={12}
      aria-hidden="true"
      style={{
        transform: open ? "rotate(90deg)" : "none",
        transition: "transform 120ms ease-out",
        flexShrink: 0,
      }}
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

/**
 * The steps, in place. Rendered only when a row is open, and only ever for a
 * movement that has copy — no steps means the row doesn't expand at all
 * rather than opening onto an empty panel.
 */
export function InstructionsPanel({ id, steps }: { id: string; steps: readonly string[] }) {
  return (
    <div
      id={id}
      className="px-4 pb-3.5 pt-0.5"
      style={{ background: "var(--panel-2)" }}
    >
      <Steps steps={steps} className="border-l-2 pl-3 text-[13px] leading-relaxed" />
    </div>
  );
}

/**
 * The live-timer form: the same steps over the top of the screen instead of
 * inside it, so a mid-workout read costs no layout shift — the clock, the
 * round count and the round button are all exactly where they were when it
 * closes.
 *
 * Dismissal is deliberately over-served, because this opens while someone is
 * out of breath and against a clock: the backdrop, the button, and Escape all
 * close it, and every one of them is a plain close with nothing else attached.
 * Centred rather than sitting on the bottom edge, which is where the cancel-
 * workout sheet lives — a panel that appears where the destructive one does
 * would be read as that one.
 */
export function InstructionsPeek({
  name,
  steps,
  onDismiss,
  // Default suits the case this exists for — a clock already running, where
  // saying so is half the reassurance. The interval screen overrides it
  // before the sequence starts, when there is no clock to go back to.
  dismissLabel = "BACK TO THE CLOCK",
}: {
  name: string;
  steps: readonly string[];
  onDismiss: () => void;
  dismissLabel?: string;
}) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onDismiss();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onDismiss]);

  return (
    <div
      className="fixed inset-0 z-10 flex items-center justify-center p-5"
      style={{ background: "rgba(13, 9, 6, 0.82)" }}
      onClick={onDismiss}
      role="dialog"
      aria-modal="true"
      aria-label={`How to do ${name}`}
    >
      <div
        className="w-full max-w-md p-5"
        style={{ background: "var(--panel)", border: "1px solid var(--border)" }}
        // The card is the one place a tap isn't a dismissal — otherwise
        // selecting a word to re-read closes what you're reading.
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="text-[10px] font-semibold tracking-[0.14em]"
          style={{ color: "var(--ink-faint)", fontFamily: "var(--font-mono)" }}
        >
          HOW TO
        </div>
        <h2
          className="mt-1 text-2xl font-extrabold uppercase leading-tight"
          style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}
        >
          {name}
        </h2>
        <Steps steps={steps} className="mt-3 border-l-2 pl-3 text-sm leading-relaxed" />
        <button
          onClick={onDismiss}
          className="mt-5 w-full py-3.5 text-xs font-bold tracking-[0.14em]"
          style={{
            fontFamily: "var(--font-mono)",
            background: "var(--panel-2)",
            border: "1px solid var(--border)",
            color: "var(--ink)",
          }}
        >
          {dismissLabel}
        </button>
      </div>
    </div>
  );
}
