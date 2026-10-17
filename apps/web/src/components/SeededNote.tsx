import { SEEDED_SOURCE, type SeededKind } from "@regimen-works/shared";

/**
 * What an admin sees on a seeded library row in place of its controls
 * (DN-151, ADR 0010). Every deploy writes the row from a committed file, so
 * the API refuses to edit or retire it -- and the row says where to go
 * instead, rather than offering buttons that could only answer 409.
 */
export function SeededNote({ kind }: { kind: SeededKind }) {
  return (
    <p className="truncate text-[11px] text-[var(--ink-faint)]">
      Seeded — change it in{" "}
      <code style={{ fontFamily: "var(--font-mono)" }}>
        {SEEDED_SOURCE[kind]}
      </code>
    </p>
  );
}
