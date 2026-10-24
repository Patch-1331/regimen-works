import { EQUIPMENT_CATALOG, type Equipment } from "@regimen-works/shared";

/**
 * Every piece in the catalog as a checkbox, with the catalog's own copy
 * beside it -- the list Settings edits (DN-35) and the setup wizard's kit
 * step asks (DN-195). One list, so the two can never disagree about what a
 * piece is called or what counts as owning it.
 *
 * Says nothing about what a toggle does: Settings saves each one at once,
 * the wizard holds them until its commit.
 */
export function EquipmentChecklist({
  owned,
  pending = false,
  onToggle,
}: {
  owned: readonly Equipment[];
  pending?: boolean;
  onToggle: (piece: Equipment, next: boolean) => void;
}) {
  const ownedSet = new Set(owned);

  return (
    <ul className="mt-3 flex flex-col">
      {EQUIPMENT_CATALOG.map((piece) => {
        const checked = ownedSet.has(piece.value);
        const labelId = `equipment-${piece.value}-label`;
        const descriptionId = `equipment-${piece.value}-description`;
        return (
          <li key={piece.value}>
            <label className="flex cursor-pointer items-start gap-3 py-2.5">
              <input
                type="checkbox"
                checked={checked}
                disabled={pending}
                onChange={(event) => onToggle(piece.value, event.target.checked)}
                // The piece names the control and the copy describes it,
                // rather than the label element naming it with both: read
                // as one string, "Kettlebell ... a dumbbell held by one end
                // substitutes for most of the rest" is a checkbox that
                // announces itself as two pieces of equipment.
                aria-labelledby={labelId}
                aria-describedby={descriptionId}
                // Visually replaced by the box below, but a real checkbox:
                // it carries the keyboard behaviour and the checked state a
                // screen reader reads out.
                className="peer sr-only"
              />
              <span
                aria-hidden="true"
                className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center transition-colors peer-focus-visible:outline peer-focus-visible:outline-2"
                style={{
                  background: checked ? "var(--glow)" : "var(--panel-2)",
                  border: "1px solid var(--border)",
                  boxShadow: checked ? "0 0 8px var(--glow-tint)" : "none",
                  opacity: pending ? 0.5 : 1,
                  outlineColor: "var(--glow)",
                }}
              >
                {checked && (
                  <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="var(--panel)" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                )}
              </span>
              <span className="min-w-0">
                <span
                  id={labelId}
                  className="block text-[13px] font-semibold tracking-wide"
                  style={{ fontFamily: "var(--font-mono)", color: checked ? "var(--ink)" : "var(--ink-soft)" }}
                >
                  {piece.label}
                </span>
                <span id={descriptionId} className="mt-0.5 block text-[11px] leading-snug text-[var(--ink-faint)]">
                  {piece.description}
                </span>
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}
