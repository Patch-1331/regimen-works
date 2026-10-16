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
 */
export const { SignedIn, SignedOut, SignIn, UserButton } = clerkTestDouble();

export function ClerkProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function useAuth() {
  return { getToken: async () => "mock-token" };
}
