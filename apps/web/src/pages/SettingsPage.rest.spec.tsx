import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RestPace, UpdateRestPace } from "@regimen-works/shared";
import { renderRoute } from "../test/renderRoute";
import { server, http, HttpResponse } from "../test/server";
import * as fixtures from "../test/fixtures";

/**
 * The rest pace in Settings (ADR 0005, DN-143): the wizard's one question,
 * changeable while the run goes on.
 *
 * What leaves the page is the thing to pin -- above all that blank and 0 go
 * out as different values, because they are different instructions.
 */

vi.mock("@clerk/clerk-react", async () => {
  const { clerkTestDouble } = await import("../test/clerk");
  return clerkTestDouble();
});

function pace(overrides: Partial<RestPace> = {}): RestPace {
  return {
    enrollmentId: "enrollment-1",
    planName: "Pull-Up Builder",
    defaultRestSeconds: 90,
    required: false,
    ...overrides,
  };
}

/** Serves settings with this pace and records every rest PATCH sent. */
function running(restPace: RestPace | null) {
  const sent: UpdateRestPace[] = [];
  server.use(
    http.get("/api/settings", () =>
      HttpResponse.json(fixtures.settings({ restPace })),
    ),
    http.patch("/api/programs/active/rest", async ({ request }) => {
      const body = (await request.json()) as UpdateRestPace;
      sent.push(body);
      return HttpResponse.json({ ...restPace!, ...body });
    }),
  );
  return sent;
}

/** Replaces the box's text and commits it the way the athlete would. */
async function enter(text: string) {
  const box = await screen.findByLabelText("Rest between sets");
  await userEvent.clear(box);
  if (text) await userEvent.type(box, text);
  await userEvent.keyboard("{Enter}");
}

describe("the rest pace in Settings", () => {
  it("is not offered with no program to pace", async () => {
    running(null);
    renderRoute("/settings");

    await screen.findByText("Repeat cooldown");
    expect(screen.queryByLabelText("Rest between sets")).not.toBeInTheDocument();
  });

  it("shows the run's pace", async () => {
    running(pace());
    renderRoute("/settings");

    expect(await screen.findByLabelText("Rest between sets")).toHaveValue("90");
  });

  it("shows no pace as blank, not as 0", async () => {
    running(pace({ defaultRestSeconds: null }));
    renderRoute("/settings");

    expect(await screen.findByLabelText("Rest between sets")).toHaveValue("");
    expect(screen.getByText("As Pull-Up Builder is written")).toBeInTheDocument();
  });

  it("sends a new pace", async () => {
    const sent = running(pace());
    renderRoute("/settings");

    await enter("120");

    await waitFor(() => expect(sent).toEqual([{ defaultRestSeconds: 120 }]));
  });

  it("sends 0 as straight through and blank as the program's own, never one for the other", async () => {
    const sent = running(pace());
    renderRoute("/settings");

    await enter("0");
    await waitFor(() => expect(sent).toEqual([{ defaultRestSeconds: 0 }]));
    await enter("");
    await waitFor(() =>
      expect(sent).toEqual([{ defaultRestSeconds: 0 }, { defaultRestSeconds: null }]),
    );
  });

  it("will not clear a pace the program needs, and says why", async () => {
    const sent = running(pace({ required: true }));
    renderRoute("/settings");

    await enter("");

    expect(
      await screen.findByText(/leaves some rests unstated, so this run needs a pace/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Rest between sets")).toHaveValue("90");
    expect(sent).toHaveLength(0);
  });

  it("puts back a rest that is not whole seconds rather than sending it", async () => {
    const sent = running(pace());
    renderRoute("/settings");

    await enter("-5");

    expect(await screen.findByText(/whole number of seconds/)).toBeInTheDocument();
    expect(screen.getByLabelText("Rest between sets")).toHaveValue("90");
    expect(sent).toHaveLength(0);
  });
});
