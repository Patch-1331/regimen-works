import { useEffect, useState } from "react";
import { Mark } from "./Mark";

/**
 * How long `/me` may take before the screen says it is waiting (DN-197). A
 * faster answer goes straight to where it lands, so the screen never flickers
 * on and off on a good connection.
 */
export const FINDING_SESSION_DELAY_MS = 300;

/**
 * What a signed-in athlete sees while the app works out whether they land on
 * Today or in setup (DN-197): nothing at first, then the mark and a bar that
 * says it is still going.
 */
export function FindingSession() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShown(true), FINDING_SESSION_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  if (!shown) return null;
  return (
    <main
      role="status"
      className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6"
    >
      <Mark scale={1.35} />
      <p
        className="mt-10 text-xs font-semibold tracking-[0.3em] text-[var(--ink-soft)] uppercase"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        Finding today’s session
      </p>
      <div className="mt-5 h-[3px] w-full max-w-[200px] overflow-hidden bg-[var(--border)]">
        <div className="finding-session-bar h-full w-2/5 bg-[var(--glow)]" />
      </div>
    </main>
  );
}
