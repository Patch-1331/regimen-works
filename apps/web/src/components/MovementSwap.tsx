import type { SwapOption } from "../lib/swapOptions";

/**
 * The swap control and its panel (WOD-5).
 *
 * The app decides what you do; you decide how hard it is. Every user is
 * provisioned at rung 0 on all eight lines, so someone who can already do ten
 * pull-ups would otherwise grind up through the advancement rule to escape
 * knee push-ups. This is the escape: one tap, against a real workout, on the
 * screen they were already looking at.
 *
 * It covers what the ladder never could, too — a tweaked shoulder, no bar in
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
 * The ladder, expanded in place under the row. The current rung is marked
 * rather than the list being filtered — seeing where you are on the line is
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
  onPick,
  onRevert,
}: {
  id: string;
  options: SwapOption[];
  isSwapped: boolean;
  /** What the library prescribed, where the athlete's remembered choice replaced it. */
  prescribedName: string | null;
  onPick: (exerciseId: string) => void;
  onRevert: () => void;
}) {
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
            </button>
          </li>
        ))}
      </ul>
      {/* Says what the athlete's standing choice replaced (DN-88). Only for a
          remembered choice: a swap made today needs no explanation, and naming
          what it overrode would argue with a decision just made. */}
      {prescribedName && (
        <p
          className="mt-1 text-[11px] text-[var(--ink-faint)]"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          Your pick. The workout says {prescribedName.toLowerCase()}.
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
