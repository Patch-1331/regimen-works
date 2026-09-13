import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderRoute } from "./test/renderRoute";
import { server, http, HttpResponse } from "./test/server";
import * as fixtures from "./test/fixtures";

/**
 * Route-render smoke tests (DN-49).
 *
 * Deliberately thin: each route renders its page without throwing, the tab bar
 * marks the right tab, and a page with data renders it. What they guard is the
 * wiring a dependency upgrade breaks — path matching, `useParams`,
 * `useNavigate`, `NavLink`'s active state, react-query's fetch — which used to
 * be checked by driving the running app by hand after every migration.
 *
 * Behaviour lives in the per-component specs; the real browser lives in DN-72.
 */

vi.mock("@clerk/clerk-react", async () => {
  const { clerkTestDouble } = await import("./test/clerk");
  return clerkTestDouble();
});

const ID = fixtures.ASSIGNMENT_ID;

describe("tabbed routes", () => {
  it("renders Today at /", async () => {
    renderRoute("/");
    // The WOD's name is the heading, so this also proves the /today fetch landed.
    expect(await screen.findByRole("heading", { name: "Fran" })).toBeInTheDocument();
  });

  it("renders Today's rest-day state when there is no assignment", async () => {
    server.use(http.get("/api/today", () => HttpResponse.json(fixtures.restDay())));
    renderRoute("/");
    expect(await screen.findByRole("heading", { name: /rest day/i })).toBeInTheDocument();
  });

  it("renders History at /history", async () => {
    renderRoute("/history");
    expect(await screen.findByRole("heading", { name: /history/i })).toBeInTheDocument();
  });

  it("renders Stats at /stats", async () => {
    renderRoute("/stats");
    expect(await screen.findByRole("heading", { name: /stats/i })).toBeInTheDocument();
  });

  it("renders Settings at /settings", async () => {
    renderRoute("/settings");
    expect(await screen.findByRole("heading", { name: /settings/i })).toBeInTheDocument();
  });
});

describe("full-screen routes", () => {
  it("renders the warm-up checklist at /warmup/:assignmentId", async () => {
    renderRoute(`/warmup/${ID}`);
    expect(await screen.findByRole("heading", { name: /warm-up/i })).toBeInTheDocument();
    expect(screen.getByText("ARM CIRCLES")).toBeInTheDocument();
  });

  it("renders the cool-down checklist at /cooldown/:assignmentId", async () => {
    renderRoute(`/cooldown/${ID}`);
    expect(await screen.findByRole("heading", { name: /cool-down/i })).toBeInTheDocument();
  });

  it("renders the active workout at /workout/:assignmentId", async () => {
    renderRoute(`/workout/${ID}`);
    // The chrome's FINISH is the one control every workout format shows, so it
    // stands for "a workout screen rendered" whichever screen was picked.
    expect(await screen.findByRole("button", { name: "FINISH" })).toBeInTheDocument();
  });

  it("renders the log form at /log/:assignmentId", async () => {
    renderRoute(`/log/${ID}`);
    expect(await screen.findByRole("heading", { name: "Fran" })).toBeInTheDocument();
  });
});

describe("useParams", () => {
  it("hands the page the id from the URL rather than a stale or empty one", async () => {
    const requested: string[] = [];
    server.use(
      http.get("/api/assignments/:assignmentId/log", ({ params }) => {
        requested.push(params.assignmentId as string);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderRoute("/log/assignment-from-the-url");
    await waitFor(() => expect(requested).toContain("assignment-from-the-url"));
  });
});

describe("data rendering", () => {
  it("renders the logs the API returns, so a react-query break surfaces", async () => {
    server.use(
      http.get("/api/logs", () =>
        HttpResponse.json([
          fixtures.workoutLog({ id: "log-1", wodName: "Fran", resultValue: "305" }),
          fixtures.workoutLog({ id: "log-2", wodName: "Cindy", resultType: "rounds_reps", resultValue: "18+7" }),
        ]),
      ),
    );
    renderRoute("/history");
    expect(await screen.findByText("Fran")).toBeInTheDocument();
    expect(screen.getByText("Cindy")).toBeInTheDocument();
    // Rendered through formatResult, not printed raw.
    expect(screen.getByText("5:05")).toBeInTheDocument();
    expect(screen.getByText("18 + 7")).toBeInTheDocument();
  });

  it("shows the API-unreachable message rather than a blank screen when a query fails", async () => {
    server.use(http.get("/api/logs", () => new HttpResponse(null, { status: 500 })));
    renderRoute("/history");
    expect(await screen.findByText(/couldn't reach the api/i)).toBeInTheDocument();
  });

  it("renders the settings toggles from the fetched values", async () => {
    server.use(
      http.get("/api/settings", () =>
        HttpResponse.json(fixtures.settings({ warmupCooldownEnabled: false, autoStopAtCapEnabled: true })),
      ),
    );
    renderRoute("/settings");
    const switches = await screen.findAllByRole("switch");
    expect(switches.map((s) => s.getAttribute("aria-checked"))).toEqual(["false", "true"]);
  });
});

describe("TabBar", () => {
  const tabs = ["TODAY", "HISTORY", "STATS", "SETTINGS"];

  it.each([
    ["/", "TODAY"],
    ["/history", "HISTORY"],
    ["/stats", "STATS"],
    ["/settings", "SETTINGS"],
  ])("marks %s's tab as the current page", async (path, activeLabel) => {
    renderRoute(path);
    const nav = await screen.findByRole("navigation");
    for (const label of tabs) {
      const link = within(nav).getByRole("link", { name: label });
      // NavLink's isActive drives aria-current, and marks only the active
      // link — inactive ones carry no attribute at all. `end` on "/" is what
      // stops Today staying lit on every other tab.
      if (label === activeLabel) expect(link).toHaveAttribute("aria-current", "page");
      else expect(link).not.toHaveAttribute("aria-current");
    }
  });

  it("does not show the tab bar on a full-screen workout route", async () => {
    renderRoute(`/workout/${ID}`);
    await screen.findByRole("button", { name: "FINISH" });
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });
});

describe("navigation", () => {
  it("moves between tabs without a full page load", async () => {
    const user = userEvent.setup();
    renderRoute("/");
    await screen.findByRole("heading", { name: "Fran" });

    await user.click(screen.getByRole("link", { name: "STATS" }));

    expect(await screen.findByRole("heading", { name: /stats/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "STATS" })).toHaveAttribute("aria-current", "page");
  });

  it("opens a history row's log through useNavigate, carrying its assignment id", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("/api/logs", () =>
        HttpResponse.json([fixtures.workoutLog({ assignmentId: ID, wodName: "Cindy" })]),
      ),
    );
    renderRoute("/history");

    await user.click(await screen.findByRole("button", { name: /cindy/i }));

    // The log form's heading is the WOD from /today for that assignment.
    expect(await screen.findByRole("heading", { name: "Fran" })).toBeInTheDocument();
  });
});

describe("WarmupPage redirect", () => {
  it("replaces itself with the workout when there is nothing to warm up", async () => {
    server.use(http.get("/api/today", () => HttpResponse.json(fixtures.today({ warmup: [] }))));
    renderRoute(`/warmup/${ID}`);
    // navigate(..., { replace: true }) on mount — the athlete lands on the
    // timer, and Back does not bounce them off an empty checklist.
    expect(await screen.findByRole("button", { name: "FINISH" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /warm-up/i })).not.toBeInTheDocument();
  });
});
