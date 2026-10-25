import type { ReactNode } from "react";
import { Link } from "react-router-dom";

/**
 * What every page of the program wizard shares (DN-193): the way out, the
 * step bar, and the footer its buttons sit in.
 */

export const mono = { fontFamily: "var(--font-mono)" } as const;
export const display = { fontFamily: "var(--font-display)" } as const;
export const caption = "text-[11px] font-semibold tracking-[0.14em] text-[var(--ink-faint)]";
export const primaryButton =
  "w-full py-3 text-sm font-semibold uppercase tracking-[0.1em] disabled:opacity-40";
export const primaryStyle = { ...mono, background: "var(--glow)", color: "var(--bg)" } as const;
export const secondaryButton =
  "py-3 text-sm font-semibold uppercase tracking-[0.1em] border border-[var(--border)] text-[var(--ink-soft)]";

export type Step = { kind: "basics" } | { kind: "day"; day: number } | { kind: "review" };

export const stepKey = (step: Step) =>
  step.kind === "day" ? `day-${step.day}` : step.kind;

/** One step in the bar: what it is called there and on a Next button, and how it stands. */
export type StepEntry = {
  step: Step;
  /** In the bar: "Basics", "Mon", "Day 2", "Review". */
  label: string;
  /** On the Next button: "Monday", "Day 2", "Review". */
  name: string;
  /** Done and right, still wrong, or not looked at yet. */
  state: "ok" | "wrong" | "open";
};

export function WizardHeader({
  cancelTo,
  cancelState,
  right,
  back,
}: {
  cancelTo: string;
  cancelState: unknown;
  right: string;
  /** A sub-page's way back up, in place of Cancel. */
  back?: { label: string; onClick: () => void };
}) {
  return (
    <header className="flex items-baseline justify-between text-xs" style={mono}>
      {back ? (
        <button type="button" onClick={back.onClick} className="text-[var(--ink-faint)]">
          ← {back.label.toUpperCase()}
        </button>
      ) : (
        <Link to={cancelTo} state={cancelState} className="text-[var(--ink-faint)]">
          ← CANCEL
        </Link>
      )}
      <span className="tracking-[0.14em] text-[var(--ink-faint)]">{right}</span>
    </header>
  );
}

/**
 * Every step, the current one lit. Any step can be gone to from here; a step
 * that is still wrong is marked once the athlete has been to it, so a day not
 * reached yet is not called wrong for being empty.
 */
export function StepBar({
  steps,
  current,
  onGo,
}: {
  steps: StepEntry[];
  current: string;
  onGo: (step: Step) => void;
}) {
  return (
    <nav aria-label="Steps" className="mt-5">
      <ol className="flex gap-1.5">
        {steps.map((entry) => {
          const key = stepKey(entry.step);
          const here = key === current;
          // The step being shown is lit, not judged: it is still being written.
          const state = here && entry.state === "wrong" ? "open" : entry.state;
          const colour = here
            ? "var(--glow)"
            : state === "wrong"
              ? "var(--danger)"
              : state === "ok"
                ? "color-mix(in srgb, var(--glow) 45%, var(--border))"
                : "var(--border)";
          return (
            <li key={key} className="min-w-0 flex-1">
              <button
                type="button"
                onClick={() => onGo(entry.step)}
                aria-current={here ? "step" : undefined}
                className="block w-full text-left"
              >
                <span className="block h-[3px]" style={{ background: colour }} aria-hidden />
                <span
                  className="mt-2 block truncate text-[10px] uppercase tracking-[0.12em]"
                  style={{
                    ...mono,
                    color: here
                      ? "var(--glow)"
                      : state === "wrong"
                        ? "var(--danger)"
                        : "var(--ink-soft)",
                  }}
                >
                  {entry.label}
                  {state === "ok" && !here && (
                    <>
                      <span aria-hidden> ✓</span>
                      <span className="sr-only">, done</span>
                    </>
                  )}
                  {state === "wrong" && (
                    <>
                      <span aria-hidden> !</span>
                      <span className="sr-only">, needs fixing</span>
                    </>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function WizardFooter({ children }: { children: ReactNode }) {
  return (
    <footer
      className="fixed inset-x-0 bottom-0 border-t border-[var(--border)] p-4"
      style={{ background: "var(--bg)" }}
    >
      <div className="mx-auto max-w-md">{children}</div>
    </footer>
  );
}

/** Back beside Next, Next the wider. */
export function BackNext({
  onBack,
  next,
  onNext,
  quiet = false,
}: {
  onBack?: () => void;
  next: string;
  onNext: () => void;
  /** Outlined rather than filled: the page has a louder button of its own. */
  quiet?: boolean;
}) {
  return (
    <div className="flex gap-3">
      {onBack && (
        <button type="button" onClick={onBack} className={`${secondaryButton} w-1/3`} style={mono}>
          Back
        </button>
      )}
      <button
        type="button"
        onClick={onNext}
        className={`${primaryButton} flex-1`}
        style={
          quiet
            ? { ...mono, border: "1px solid var(--glow)", color: "var(--glow)" }
            : primaryStyle
        }
      >
        Next: {next} →
      </button>
    </div>
  );
}
