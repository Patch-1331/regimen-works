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
 * which is what keeps it clear of the rung-change offer below, the one thing
 * on this screen that does ask a question.
 *
 * With per-set logging the second line can eventually say something sharper —
 * "8, 8, 8 — up from 8, 8, 6 last week" — without changing what this is.
 */

const ORDINALS = [
  "First",
  "Second",
  "Third",
  "Fourth",
  "Fifth",
  "Sixth",
  "Seventh",
];

export function CompletionCard({
  wodName,
  trainingDaysThisWeek,
  fromTimer,
}: {
  wodName: string;
  /** Counting today — see `trainingDaysThisWeek` in lib/stats. */
  trainingDaysThisWeek: number;
  /** True when the numbers below were filled in from the live timer. */
  fromTimer: boolean;
}) {
  // Beyond seven the ordinal stops being a word anyone says, and a week with
  // more training days than it has days is not worth a special case.
  const ordinal = ORDINALS[trainingDaysThisWeek - 1];

  return (
    <div
      className="mt-4 p-4"
      style={{ border: "1px solid var(--glow)", background: "var(--glow-tint)" }}
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
