import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { renderRoute } from "../test/renderRoute";

/**
 * The signed-out page (DN-196), rendered through the real `App` at a deep
 * link, so it covers the gate as well as the page.
 *
 * Clerk is the shared double turned inside out: signed out, and a `SignIn`
 * that keeps the props it was given. Clerk's form itself is Clerk's — what is
 * ours is that it is asked for with hash routing and our appearance.
 */

const signInProps = vi.hoisted(() => ({ current: undefined as unknown }));

vi.mock("@clerk/clerk-react", async () => {
  const { clerkTestDouble } = await import("../test/clerk");
  return {
    ...clerkTestDouble(),
    SignedIn: () => null,
    SignedOut: ({ children }: { children: ReactNode }) => <>{children}</>,
    SignIn: (props: unknown) => {
      signInProps.current = props;
      return <div data-testid="clerk-sign-in" />;
    },
  };
});

describe("signed out", () => {
  it("shows the Regimen Works page around Clerk's sign-in, wherever the link pointed", () => {
    renderRoute("/history");

    expect(screen.getByText("REGIMEN WORKS")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Today's training is already decided." }),
    ).toBeInTheDocument();
    expect(screen.getByText("Sign in and it's waiting for you.")).toBeInTheDocument();
    expect(screen.getByTestId("clerk-sign-in")).toBeInTheDocument();
    // Nothing of the app behind the gate.
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it("tells someone new how to get in, and offers no way to sign up", () => {
    renderRoute("/");

    expect(screen.getByText("INVITE ONLY")).toBeInTheDocument();
    expect(screen.getByText(/open the link in your invite email/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /sign up|create account/i })).not.toBeInTheDocument();
  });

  it("hides Clerk's own sign-up link and header, and keeps hash routing", () => {
    renderRoute("/");

    expect(signInProps.current).toMatchObject({
      routing: "hash",
      appearance: {
        elements: {
          footerAction: { display: "none" },
          header: { display: "none" },
        },
      },
    });
  });

  it("sends the athlete back to the link they opened once they have signed in", () => {
    // Clerk's default after sign-in is `/`, Today, whichever method is used;
    // the link only survives if it is handed over (DN-199).
    renderRoute("/log/assignment-123?from=share");

    expect(signInProps.current).toMatchObject({
      fallbackRedirectUrl: "/log/assignment-123?from=share",
    });
  });

  it("sends a plain visit back to Today", () => {
    renderRoute("/");

    expect(signInProps.current).toMatchObject({ fallbackRedirectUrl: "/" });
  });
});
