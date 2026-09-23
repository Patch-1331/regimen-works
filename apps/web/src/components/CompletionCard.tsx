/**
 * The moment the app marks a finished workout (DN-8).
 *
 * It replaced a Stats banner that fired on `lastChange === "advanced"` — the
 * app announcing it had promoted you. That was a verdict, it needed the app to
 * hold a view about your ability, and it fired on the rare session that
 * crossed a threshold. This fires on every session, and it is a record: you
 * trained, here is where it sits in your week.
 *
 * Deliberately not a modal and not dismissible. It makes no request of the
 * athlete, so there is nothing to accept or decline and nothing to get past —
 * which is what keeps it clear of the movement-change offer below, the one thing
 * on this screen that does ask a question.
 *
 * On a prescribed day it now says something sharper — "8, 8, 8, up from
 * 8, 8, 6 last time" (DN-22) — without changing what this is. Both sets of
 * numbers happened, and the phrase between them reports which way the total
 * moved. It is not a grade: "down from" on the day after a hard one is a fact
 * about the week, and the app has no view about what it means (DN-88).
 */

import type { SessionComparison } from "../lib/stats";

const ORDINALS = [
  "First",
  "Second",
  "Third",
  "Fourth",
  "Fifth",
  "Sixth",
  "Seventh",
];

/** "3, 3, 2" — the sets as they were done, in the order they were done. */
function setsLabel(sets: number[]): string {
  return sets.join(", ");
}

function comparisonLine(comparison: SessionComparison): string {
  const today = `${comparison.name} — ${setsLabel(comparison.sets)}`;
  if (comparison.previous === null) return `${today}.`;
  const last = setsLabel(comparison.previous);
  // Keyed off the total, which is the only thing two different-shaped
  // sessions can be compared on at all.
  if (comparison.direction === "up")
    return `${today}, up from ${last} last time.`;
  if (comparison.direction === "down")
    return `${today}, down from ${last} last time.`;
  return `${today}, the same total as ${last} last time.`;
}

export function CompletionCard({
  wodName,
  trainingDaysThisWeek,
  fromTimer,
  comparisons = [],
}: {
  wodName: string;
  /** Counting today — see `trainingDaysThisWeek` in lib/stats. */
  trainingDaysThisWeek: number;
  /** True when the numbers below were filled in from the live timer. */
  fromTimer: boolean;
  /**
   * What each movement was just done at, beside last time (DN-22). Empty on a
   * WOD day, and on the first prescribed day of a movement there is simply no
   * "last time" to quote.
   */
  comparisons?: SessionComparison[];
}) {
  // Beyond seven the ordinal stops being a word anyone says, and a week with
  // more training days than it has days is not worth a special case.
  const ordinal = ORDINALS[trainingDaysThisWeek - 1];

  return (
    <div
      className="mt-4 p-4"
      style={{
        border: "1px solid var(--glow)",
        background: "var(--glow-tint)",
      }}
    >
      <p
        className="text-[10px] font-semibold tracking-[0.14em]"
        style={{ fontFamily: "var(--font-mono)", color: "var(--glow)" }}
      >
        WORKOUT DONE
      </p>

      <p className="mt-1.5 text-sm leading-relaxed text-[var(--ink)]">
        You finished <strong>{wodName}</strong>.
      </p>

      {ordinal && (
        <p className="mt-1 text-[13px] text-[var(--ink-soft)]">
          {ordinal} day you've trained this week.
        </p>
      )}

      {comparisons.length > 0 && (
        <ul className="mt-2 space-y-1">
          {comparisons.map((comparison) => (
            <li
              key={comparison.exerciseId}
              className="text-[13px] text-[var(--ink-soft)]"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {comparisonLine(comparison)}
            </li>
          ))}
        </ul>
      )}

      {fromTimer && (
        <p
          className="mt-2.5 text-[11px] tracking-[0.04em] text-[var(--ink-faint)]"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          Numbers below came from your timer — review and save.
        </p>
      )}
    </div>
  );
}
