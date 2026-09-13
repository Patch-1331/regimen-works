import type { ReactNode } from "react";

/**
 * The two wrappers the Stats screen is built out of. They lived in
 * `StatsPage.tsx` until the movement panel moved out of it (DN-95) and needed
 * them from a second file.
 */

export function SectionLabel({ children }: { children: string }) {
  return (
    <p className="mt-8 text-xs font-semibold tracking-[0.14em] text-[var(--ink-faint)]" style={{ fontFamily: "var(--font-mono)" }}>
      {children}
    </p>
  );
}

export function Panel({ children }: { children: ReactNode }) {
  return (
    <div className="mt-3 p-4" style={{ background: "var(--panel)", border: "1px solid var(--border)" }}>
      {children}
    </div>
  );
}
