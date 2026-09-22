import type { SubstitutionReason } from "@regimen-works/shared";
import type { SwapOption } from "../lib/swapOptions";

/**
 * The swap control and its panel (WOD-5).
 *
 * The app decides what you do; you decide how hard it is. This is where the
 * second half happens: one tap, against a real workout, on the screen the
 * athlete was already looking at.
 *
 * It is also the only encouragement the app offers towards a harder movement
 * (DN-87). The panel lists the whole group in list order with the current choice
 * marked, so the next movement is visible and one tap away — which is what the
 * deleted advancement rule was reduced to suggesting, without the app having
 * to form a view about who is ready for it.
 *
 * It covers what a fixed progression never could, too — a tweaked shoulder, no bar in
 * the hotel room, dead legs. So it sits on the plate rather than in Settings,
 * and it applies to today only: the athlete is about to train, not configure.
 */

/**
 * The right-hand control on a movement row. Deliberately independent of the
 * instructions disclosure: a movement with no written copy is an inert row,
 * and it still has to be swappable.
 */
export function SwapButton({
  name,
  open,
  panelId,
  onClick,
}: {
  name: string;
  open: boolean;
  panelId: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      aria-controls={panelId}
      aria-label={`Swap ${name.toLowerCase()}`}
      // 44px of target on a 16px glyph — this gets tapped with a thumb, and
      // the negative margin keeps the row's own height unchanged.
      className="-my-3 flex shrink-0 items-center justify-center"
      style={{ width: 44, height: 44 }}
    >
      <SwapIcon lit={open} />
    </button>
  );
}

function SwapIcon({ lit }: { lit: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke={lit ? "var(--glow)" : "var(--ink-faint)"}
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      width={16}
      height={16}
      aria-hidden="true"
      style={{ transition: "stroke 120ms ease-out" }}
    >
      <path d="M16 3l4 4-4 4" />
      <path d="M20 7H4" />
      <path d="M8 21l-4-4 4-4" />
      <path d="M4 17h16" />
    </svg>
  );
}

/**
 * The group, expanded in place under the row. The current choice is marked
 * rather than the list being filtered — seeing where you are on the group is
 * half of what makes the choice meaningful.
 *
 * No confirmation step and no "today or forever?" question. The swap is one
 * tap because the athlete is about to train; the permanent change is offered
 * afterwards, from what they actually did.
 */
export function SwapPanel({
  id,
  options,
  isSwapped,
  prescribedName,
  prescribedReason,
  onPick,
  onRevert,
}: {
  id: string;
  options: SwapOption[];
  isSwapped: boolean;
  /** What the library prescribed, where something other than today's tap replaced it. */
  prescribedName: string | null;
  /** Which of the two automatic substitutions replaced it — they read differently. */
  prescribedReason: SubstitutionReason | null;
  onPick: (exerciseId: string) => void;
  onRevert: () => void;
}) {
  // Derived from the list rather than passed in, so the sentence and the rows
  // can never disagree about whether the prescription is on offer.
  const offersPrescribed = options.some((o) => o.isPrescribed);

  return (
    <div id={id} className="px-4 pb-3.5 pt-1" style={{ background: "var(--panel-2)" }}>
      <p
        className="pb-1.5 text-[10px] font-semibold tracking-[0.14em] text-[var(--ink-faint)]"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        TODAY ONLY
      </p>
      <ul className="flex flex-col">
        {options.map((option) => (
          <li key={option.exerciseId}>
            <button
              type="button"
              onClick={() => onPick(option.exerciseId)}
              aria-current={option.isCurrent}
              className="flex w-full items-center gap-2.5 py-2 text-left"
            >
              <span
                className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                style={{
                  background: option.isCurrent ? "var(--glow)" : "var(--border)",
                  boxShadow: option.isCurrent ? "0 0 5px var(--glow)" : "none",
                }}
              />
              <span
                className="min-w-0 flex-1 truncate text-[13px]"
                style={{
                  fontFamily: "var(--font-mono)",
                  color: option.isCurrent ? "var(--ink)" : "var(--ink-soft)",
                  fontWeight: option.isCurrent ? 700 : 400,
                }}
              >
                {option.name}
              </span>
              {option.isAlternative && (
                <span
                  className="shrink-0 text-[10px] tracking-[0.1em] text-[var(--ink-faint)]"
                  style={{ fontFamily: "var(--font-mono)" }}
                >
                  NO KIT
                </span>
              )}
              {/* The movement the workout named, back on the list where an
                  automatic layer took it off (DN-110). Marked rather than
                  left to the sentence below, because in the off-group case
                  it is one of two near-identical rows and which is which
                  decides the tap. */}
              {option.isPrescribed && (
                <span
                  className="shrink-0 text-[10px] tracking-[0.1em] text-[var(--ink-faint)]"
                  style={{ fontFamily: "var(--font-mono)" }}
                >
                  PRESCRIBED
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {/* Says what was replaced, and by which of the two automatic layers
          (DN-88, DN-79). Never for a swap made today: that needs no
          explanation, and naming what it overrode would argue with a decision
          just made.

          The two readings are not interchangeable. A remembered choice is the
          athlete's own, made once and still honoured; the equipment fallback
          is the app standing down from a movement they have no gear for.
          Calling the second one their pick would be untrue, and would send
          someone looking for a setting they never touched.

          It stops naming the prescribed movement once the list offers it
          (DN-110): saying "the workout says double-unders" above a row that
          reads DOUBLE-UNDERS is the app talking to itself, and the sentence
          as written — a statement of fact about equipment the athlete lacks —
          reads as final next to a control that is now anything but. */}
      {prescribedName && (
        <p
          className="mt-1 text-[11px] text-[var(--ink-faint)]"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {offersPrescribed
            ? prescribedReason === "equipment"
              ? "Not in your equipment — take it anyway if you have one today."
              : "Your standing pick — the workout's own is marked."
            : prescribedReason === "equipment"
              ? `Not in your equipment. The workout says ${prescribedName.toLowerCase()}.`
              : `Your pick. The workout says ${prescribedName.toLowerCase()}.`}
        </p>
      )}
      {isSwapped && (
        <button
          type="button"
          onClick={onRevert}
          className="mt-1 text-[11px] font-semibold tracking-[0.08em] text-[var(--ink-faint)]"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          USE WHAT'S PRESCRIBED
        </button>
      )}
    </div>
  );
}
