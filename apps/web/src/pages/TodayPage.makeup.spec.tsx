import { describe, expect, it, vi } from "vitest";
import type { TodayResponse } from "@regimen-works/shared";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderRoute } from "../test/renderRoute";
import { server, http, HttpResponse } from "../test/server";
import * as fixtures from "../test/fixtures";

/**
 * The makeup offer on a rest day (DN-17).
 *
 * The week is the unit of completion: training days say when the app expects
 * the athlete, not when they are allowed to train. What these tests are
 * really guarding is the copy. The whole feature fails if the screen manages
 * to tell somebody they are behind — that fights the decision that every
 * completed session is what gets celebrated — so "no debt language" is
 * asserted here rather than left to whoever edits the string next.
 */

vi.mock("@clerk/clerk-react", async () => {
  const { clerkTestDouble } = await import("../test/clerk");
  return clerkTestDouble();
});

const SATURDAY = "2026-09-19";

function restDayWith(makeup: TodayResponse["makeup"]) {
  server.use(
    http.get("/api/today", () =>
      HttpResponse.json(
        fixtures.today({
          date: SATURDAY,
          isRestDay: true,
          assignment: null,
          warmup: null,
          cooldown: null,
          makeup,
        }),
      ),
    ),
  );
}

describe("the makeup offer", () => {
  it("offers the session while the week is short", async () => {
    restDayWith({ sessionsThisWeek: 5, completedThisWeek: 4 });
    renderRoute("/");

    expect(
      await screen.findByRole("button", { name: /train anyway/i }),
    ).toBeInTheDocument();
  });

  it("says how short the week is", async () => {
    restDayWith({ sessionsThisWeek: 5, completedThisWeek: 4 });
    renderRoute("/");

    expect(await screen.findByText(/1 session short this week/i)).toBeInTheDocument();
  });

  it("pluralises the count, so nobody reads “2 session short”", async () => {
    restDayWith({ sessionsThisWeek: 5, completedThisWeek: 3 });
    renderRoute("/");

    expect(await screen.findByText(/2 sessions short this week/i)).toBeInTheDocument();
  });

  it("offers nothing when the API offers nothing", async () => {
    // A fixed program, or a week already finished. The screen does not
    // second-guess either — it renders what it is handed.
    restDayWith(null);
    renderRoute("/");

    expect(await screen.findByText(/rest day/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /train anyway/i }),
    ).not.toBeInTheDocument();
  });

  it("never tells the athlete they are behind", async () => {
    // The copy rule, asserted rather than trusted to survive the next edit.
    // "Short" is a fact about the week; "behind", "owed" and "missed" are
    // claims about the person.
    restDayWith({ sessionsThisWeek: 5, completedThisWeek: 0 });
    renderRoute("/");

    await screen.findByRole("button", { name: /train anyway/i });
    const page = document.body.textContent ?? "";
    for (const word of [
      "behind",
      "owed",
      "owe",
      "missed",
      "catch up",
      "caught up",
      "debt",
      "overdue",
      "failed",
    ]) {
      expect(page.toLowerCase()).not.toContain(word);
    }
  });

  it("takes the offer and lands on the session", async () => {
    restDayWith({ sessionsThisWeek: 5, completedThisWeek: 4 });
    let taken = false;
    server.use(
      http.post("/api/today/makeup", () => {
        taken = true;
        return HttpResponse.json(fixtures.today({ date: SATURDAY }));
      }),
      // The refetch after the mutation: the day is a training day now.
      http.get("/api/today", () =>
        HttpResponse.json(
          taken
            ? fixtures.today({ date: SATURDAY })
            : fixtures.today({
                date: SATURDAY,
                isRestDay: true,
                assignment: null,
                warmup: null,
                cooldown: null,
                makeup: { sessionsThisWeek: 5, completedThisWeek: 4 },
              }),
        ),
      ),
    );
    renderRoute("/");

    await userEvent.click(
      await screen.findByRole("button", { name: /train anyway/i }),
    );

    await waitFor(() => expect(taken).toBe(true));
    expect(
      await screen.findByRole("button", { name: /start workout/i }),
    ).toBeInTheDocument();
  });
});
