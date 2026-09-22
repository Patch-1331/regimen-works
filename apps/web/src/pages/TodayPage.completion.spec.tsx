import { describe, expect, it, vi } from "vitest";
import type { TodayResponse } from "@regimen-works/shared";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderRoute } from "../test/renderRoute";
import { server, http, HttpResponse } from "../test/server";
import * as fixtures from "../test/fixtures";

/**
 * The completion card above Today (DN-18).
 *
 * The rule the whole feature is built around is the one worth guarding here:
 * **a prompt never blocks a workout.** So most of these assert the card *and*
 * the day underneath it, on every kind of day the screen has -- a WOD, a
 * prescribed day and a rest day -- because a card that renders on two of the
 * three and hides the workout on the last would pass a spec that only ever
 * looked at the card.
 */

vi.mock("@clerk/clerk-react", async () => {
  const { clerkTestDouble } = await import("../test/clerk");
  return clerkTestDouble();
});

function todayIs(overrides: Partial<TodayResponse>) {
  server.use(
    http.get("/api/today", () => HttpResponse.json(fixtures.today(overrides))),
  );
}

/** Records every write the card makes, as `METHOD /path`. */
function recordingWrites() {
  const seen: string[] = [];
  server.use(
    http.post("/api/programs/:id/dismiss", ({ params }) => {
      seen.push(`POST /programs/${String(params.id)}/dismiss`);
      return HttpResponse.json({ dismissed: true });
    }),
    http.post("/api/programs/:id/run-again", ({ params }) => {
      seen.push(`POST /programs/${String(params.id)}/run-again`);
      return HttpResponse.json({ enrollmentId: "enrollment-2" });
    }),
  );
  return seen;
}

describe("the completion card", () => {
  it("names the program and what it came to", async () => {
    todayIs({ completedProgram: fixtures.completedProgram() });

    renderRoute("/");

    expect(
      await screen.findByRole("heading", { name: /pull-up builder complete/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "6 weeks · 24 sessions · pull: Negative chin-up → Chin-up",
      ),
    ).toBeInTheDocument();
  });

  it("leaves the workout on the screen underneath it", async () => {
    // The whole point. The program is over, the card is owed, and the athlete
    // still has something to train today.
    todayIs({ completedProgram: fixtures.completedProgram() });

    renderRoute("/");

    expect(await screen.findByRole("heading", { name: /fran/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start/i })).toBeInTheDocument();
  });

  it("sits above a rest day too", async () => {
    server.use(
      http.get("/api/today", () =>
        HttpResponse.json({
          ...fixtures.restDay(),
          completedProgram: fixtures.completedProgram(),
        }),
      ),
    );

    renderRoute("/");

    expect(await screen.findByRole("heading", { name: /rest day/i })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /pull-up builder complete/i }),
    ).toBeInTheDocument();
  });

  it("shows nothing at all when no program has just ended", async () => {
    // Which is almost always. The card is the exception, not the furniture.
    todayIs({});

    renderRoute("/");

    await screen.findByRole("heading", { name: /fran/i });
    expect(screen.queryByText(/complete$/i)).not.toBeInTheDocument();
  });

  it("reads sensibly for a program nobody trained", async () => {
    // DN-18's last task. No sessions, nothing moved, and still a finished
    // program -- so the line is a short true sentence rather than a gap.
    todayIs({
      completedProgram: fixtures.completedProgram({
        summary: { weeks: 6, sessions: 0, rungChanges: [] },
      }),
    });

    renderRoute("/");

    expect(await screen.findByText("6 weeks · 0 sessions")).toBeInTheDocument();
  });

  it("drops the length for an open-ended run that was ended by hand", async () => {
    todayIs({
      completedProgram: fixtures.completedProgram({
        summary: { weeks: null, sessions: 12, rungChanges: [] },
      }),
    });

    renderRoute("/");

    expect(await screen.findByText("12 sessions")).toBeInTheDocument();
  });

  it("counts a single week and a single session in the singular", async () => {
    todayIs({
      completedProgram: fixtures.completedProgram({
        summary: { weeks: 1, sessions: 1, rungChanges: [] },
      }),
    });

    renderRoute("/");

    expect(await screen.findByText("1 week · 1 session")).toBeInTheDocument();
  });

  it("lists every movementGroup that moved", async () => {
    todayIs({
      completedProgram: fixtures.completedProgram({
        summary: {
          weeks: 6,
          sessions: 24,
          rungChanges: [
            fixtures.rungChange(),
            fixtures.rungChange({
              movementGroup: "push_horizontal",
              fromName: "Knee push-up",
              toName: "Push-up",
            }),
          ],
        },
      }),
    });

    renderRoute("/");

    // The group's own name is readable rather than a column name -- an athlete
    // reads "push horizontal", not "push_horizontal".
    expect(
      await screen.findByText(/push horizontal: Knee push-up → Push-up/),
    ).toBeInTheDocument();
  });

  it("dismisses the card against the enrollment it belongs to", async () => {
    const writes = recordingWrites();
    todayIs({
      completedProgram: fixtures.completedProgram({
        enrollmentId: "enrollment-7",
      }),
    });

    renderRoute("/");
    await userEvent.click(
      await screen.findByRole("button", { name: /dismiss/i }),
    );

    await waitFor(() =>
      expect(writes).toEqual(["POST /programs/enrollment-7/dismiss"]),
    );
  });

  it("runs the same program again without asking anything", async () => {
    // No wizard, no length to re-pick: the athlete has just run this program
    // and is saying they want it again.
    const writes = recordingWrites();
    todayIs({
      completedProgram: fixtures.completedProgram({
        enrollmentId: "enrollment-7",
      }),
    });

    renderRoute("/");
    await userEvent.click(
      await screen.findByRole("button", { name: /run it again/i }),
    );

    await waitFor(() =>
      expect(writes).toEqual(["POST /programs/enrollment-7/run-again"]),
    );
  });

  it("sends the athlete to the wizard to choose something else", async () => {
    const writes = recordingWrites();
    todayIs({ completedProgram: fixtures.completedProgram() });

    renderRoute("/");
    await userEvent.click(
      await screen.findByRole("button", { name: /see what.s next/i }),
    );

    expect(
      await screen.findByRole("heading", {
        name: "Let's set up your training",
      }),
    ).toBeInTheDocument();
    // Browsing is not answering. The card is still owed until the athlete
    // actually starts something, and the wizard is re-runnable by design.
    expect(writes).toEqual([]);
  });

  it("keeps the program finished when the API cannot be reached", async () => {
    server.use(
      http.post("/api/programs/:id/dismiss", () => HttpResponse.error()),
    );
    todayIs({ completedProgram: fixtures.completedProgram() });

    renderRoute("/");
    await userEvent.click(
      await screen.findByRole("button", { name: /dismiss/i }),
    );

    expect(
      await screen.findByText(/your program is still finished/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /pull-up builder complete/i }),
    ).toBeInTheDocument();
  });
});
