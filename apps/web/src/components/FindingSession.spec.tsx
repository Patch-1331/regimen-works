import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { delay } from "msw";
import { renderRoute } from "../test/renderRoute";
import { server, http, HttpResponse } from "../test/server";
import { FINDING_SESSION_DELAY_MS } from "./FindingSession";

/**
 * The loading screen the setup gate shows while `/me` is in flight (DN-197),
 * through the real `App`: what matters is what the athlete sees between
 * signing in and landing, and that Today is never part of it.
 */

vi.mock("@clerk/clerk-react", async () => {
  const { clerkTestDouble } = await import("../test/clerk");
  return clerkTestDouble();
});

const finding = () => screen.queryByText(/finding today’s session/i);
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("while /me is pending", () => {
  it("shows nothing at first, then the loading screen once the delay has passed", async () => {
    server.use(http.get("/api/me", () => delay("infinite")));
    renderRoute("/");

    expect(finding()).not.toBeInTheDocument();

    const status = await screen.findByRole("status", {}, { timeout: FINDING_SESSION_DELAY_MS + 500 });
    expect(status).toHaveTextContent(/finding today’s session/i);
    // Today has not rendered behind it, and has not asked for a workout.
    expect(screen.queryByRole("heading", { name: "Fran" })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it("never shows the loading screen when /me answers inside the delay", async () => {
    server.use(
      http.get("/api/me", async () => {
        await delay(FINDING_SESSION_DELAY_MS / 3);
        return HttpResponse.json({ id: "user_alice", isAdmin: false, onboardedAt: "2026-09-01T08:00:00.000Z" });
      }),
    );
    renderRoute("/");

    expect(finding()).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Fran" })).toBeInTheDocument();
    expect(finding()).not.toBeInTheDocument();

    // Past the delay, its timer must have gone with it rather than firing late.
    await wait(FINDING_SESSION_DELAY_MS + 100);
    expect(finding()).not.toBeInTheDocument();
  });

  it("goes from the loading screen to setup, never through Today, for an athlete not yet onboarded", async () => {
    let askedForToday = 0;
    server.use(
      http.get("/api/me", async () => {
        await delay(FINDING_SESSION_DELAY_MS + 200);
        return HttpResponse.json({ id: "user_alice", isAdmin: false, onboardedAt: null });
      }),
      http.get("/api/today", () => {
        askedForToday++;
        return HttpResponse.json({});
      }),
    );
    renderRoute("/");

    await screen.findByRole("status", {}, { timeout: FINDING_SESSION_DELAY_MS + 500 });
    expect(
      await screen.findByRole("heading", { name: "Let's set up your training" }),
    ).toBeInTheDocument();
    expect(finding()).not.toBeInTheDocument();
    expect(askedForToday).toBe(0);
  });
});
