// Stands in for a whole library module, so it exports what that module does:
// components beside a hook. Fast refresh of a stand-in is not worth splitting it.
/* oxlint-disable react/only-export-components */
import type { ReactNode } from "react";
import { clerkTestDouble } from "../test/clerk";

/**
 * `@clerk/clerk-react` in mock mode (DN-181), swapped in by the alias in
 * vite.config.ts and never in any other mode.
 *
 * Signed in, always, as the fixture athlete: mock mode exists so a browser
 * with no Clerk key and no way to sign in can still see the app. The token is
 * a placeholder msw never checks.
 *
 * Except with `?signed-out` in the URL (DN-196), which shows the sign-in page
 * instead. There is no Clerk to draw its form, so a placeholder of the same
 * width marks where it goes; real mode shows the form itself.
 */
const signedOut = new URLSearchParams(window.location.search).has("signed-out");

const { UserButton } = clerkTestDouble();
export { UserButton };

export function SignedIn({ children }: { children: ReactNode }) {
  return signedOut ? null : <>{children}</>;
}

export function SignedOut({ children }: { children: ReactNode }) {
  return signedOut ? <>{children}</> : null;
}

export function SignIn() {
  return (
    <div
      className="border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--ink-faint)]"
      style={{ fontFamily: "var(--font-mono)" }}
    >
      CLERK'S SIGN-IN FORM — REAL MODE ONLY
    </div>
  );
}

export function ClerkProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function useAuth() {
  return { getToken: async () => "mock-token" };
}
