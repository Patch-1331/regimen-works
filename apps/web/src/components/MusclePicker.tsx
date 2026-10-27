import { muscle, type Muscle } from "@regimen-works/shared";
import { MUSCLE_LABEL } from "../lib/movementPicker";

/**
 * What a movement works, picked from the dataset's seventeen (DN-205).
 *
 * Kept in the order the muscles were picked rather than the list's, because
 * the first primary muscle is the prime mover, and that is what the muscle
 * match weighs most. `exclude` hides the ones already chosen elsewhere — a
 * muscle is primary or secondary, never both.
 */
export function MusclePicker({
  legend,
  hint,
  value,
  onChange,
  exclude = [],
}: {
  legend: string;
  hint?: string;
  value: Muscle[];
  onChange: (next: Muscle[]) => void;
  exclude?: readonly Muscle[];
}) {
  return (
    <fieldset>
      <legend
        className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-faint)]"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {legend}
      </legend>
      {hint && <p className="mt-1 text-[11px] text-[var(--ink-faint)]">{hint}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        {muscle.options
          .filter((m) => !exclude.includes(m))
          .map((m) => {
            const picked = value.includes(m);
            return (
              <button
                key={m}
                type="button"
                aria-pressed={picked}
                onClick={() => onChange(picked ? value.filter((v) => v !== m) : [...value, m])}
                className="min-h-9 border px-3 text-[13px]"
                style={{
                  borderColor: picked ? "var(--glow)" : "var(--border)",
                  background: picked ? "var(--glow-tint)" : "transparent",
                  color: picked ? "var(--glow)" : "var(--ink-soft)",
                }}
              >
                {MUSCLE_LABEL[m]}
              </button>
            );
          })}
      </div>
    </fieldset>
  );
}
