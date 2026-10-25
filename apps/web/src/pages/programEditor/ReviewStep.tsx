import type { ReactNode } from "react";
import { defaultProgramSummary } from "@regimen-works/shared";
import type { ApiExercise } from "../../lib/api";
import {
  dayProblems,
  lineMovementName,
  pickedDays,
  type ProgramDraft,
} from "../../lib/programDraft";
import { WEEKDAYS } from "../../lib/weekdays";
import { display, mono, type Step } from "./chrome";

/**
 * The last step (DN-193): the whole week, Monday to Sunday, rest days and
 * all. Each training day goes back to its page, and a day still wrong says
 * what is wrong with it. A saved program opens here, so a small change is
 * one tap away rather than five pages.
 */
export function ReviewStep({
  draft,
  library,
  labelOf,
  notes,
  onGo,
}: {
  draft: ProgramDraft;
  library: ApiExercise[];
  /** "Mon", or "Day 2" when the days are trained in order. */
  labelOf: (day: number) => string;
  notes: ReactNode;
  onGo: (step: Step) => void;
}) {
  const days = pickedDays(draft);
  const summary =
    draft.summary.trim() ||
    (days.length > 0 ? defaultProgramSummary(draft.scheduleMode, [...days].sort((a, b) => a - b)) : "");
  const unnamed = draft.name.trim() === "";
  return (
    <>
      <h1
        className="mt-8 text-4xl font-bold"
        style={{ ...display, color: unnamed ? "var(--danger)" : "var(--ink)" }}
      >
        {unnamed ? "No name yet" : draft.name}
      </h1>
      <p className="mt-2 text-[var(--ink-soft)]">
        {[summary, draft.scheduleMode === "fixed" ? "on these weekdays" : "in order, whenever you can"]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <button
        type="button"
        onClick={() => onGo({ kind: "basics" })}
        className="mt-3 text-xs tracking-[0.14em] text-[var(--glow)] underline"
        style={mono}
      >
        EDIT BASICS
      </button>
      {notes}

      <ul className="mt-6 space-y-2" aria-label="The week">
        {WEEKDAYS.map(({ value: day, short }) => {
          if (!days.includes(day)) {
            return (
              <li
                key={day}
                className="flex items-baseline gap-4 border border-dashed border-[var(--border)] px-4 py-3"
              >
                <span className="w-12 text-sm text-[var(--ink-faint)]" style={mono}>
                  {short.toUpperCase()}
                </span>
                <span className="text-[var(--ink-faint)]">Rest</span>
              </li>
            );
          }
          const lines = draft.days[day] ?? [];
          const problems = dayProblems(draft, day);
          const wrong = problems.length > 0;
          const label = labelOf(day);
          return (
            <li key={day}>
              <button
                type="button"
                onClick={() => onGo({ kind: "day", day })}
                className="flex w-full items-center gap-4 border px-4 py-3 text-left"
                style={{
                  borderColor: wrong ? "var(--danger)" : "var(--border)",
                  background: wrong
                    ? "color-mix(in srgb, var(--danger) 12%, var(--bg))"
                    : "var(--panel)",
                }}
              >
                <span
                  className="w-12 shrink-0 text-sm uppercase"
                  style={{ ...mono, color: wrong ? "var(--danger)" : "var(--glow)" }}
                >
                  {label}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-[var(--ink)]">
                    {lines.length === 0
                      ? "No movements yet"
                      : draft.labels[day]?.trim() ||
                        `${lines.length} ${lines.length === 1 ? "movement" : "movements"}`}
                  </span>
                  <span
                    className="block text-sm"
                    style={{ color: wrong ? "var(--danger)" : "var(--ink-soft)" }}
                  >
                    {lines.length === 0
                      ? `Add one, or drop ${label} in Basics`
                      : wrong
                        ? problems[0]
                        : lines.map((l) => lineMovementName(l, library)).join(", ")}
                  </span>
                </span>
                <span
                  className="text-xs tracking-[0.14em]"
                  style={{ ...mono, color: wrong ? "var(--danger)" : "var(--ink-soft)" }}
                >
                  {wrong ? "FIX" : "EDIT"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <p className="mt-4 text-sm text-[var(--ink-faint)]">
        This week repeats. You choose how many weeks when you start it.
      </p>
    </>
  );
}
