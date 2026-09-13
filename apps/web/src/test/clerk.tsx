import type { ReactNode } from "react";

/**
 * The signed-in half of Clerk's gate, which every route sits behind.
 *
 * Its own module, importing nothing from the app: the `vi.mock` factory that
 * returns this runs while `@clerk/clerk-react` is being resolved, so anything
 * here that reached back into `App` would deadlock on the module it is
 * standing in for.
 *
 * Clerk itself is not what these tests are about — DN-72 drives the real
 * sign-in in a browser. Here it is a seam, so that a route test fails for
 * routing reasons only.
 */
export function clerkTestDouble() {
  return {
    SignedIn: ({ children }: { children: ReactNode }) => <>{children}</>,
    SignedOut: () => null,
    SignIn: () => <div data-testid="clerk-sign-in" />,
    UserButton: () => <button type="button">Account</button>,
  };
}
