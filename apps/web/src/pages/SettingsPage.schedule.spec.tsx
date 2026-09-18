import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Settings } from "@regimen-works/shared";
import { renderRoute } from "../test/renderRoute";
import { server, http, HttpResponse } from "../test/server";
import * as fixtures from "../test/fixtures";

/**
 * The schedule controls on the Settings screen (DN-30).
 *
 * Driven through the real route rather than the components, because most of
 * what is worth pinning is what leaves the page: `trainingDays` is a whole-set
 * replacement, so a PATCH carrying one day is not "add Tuesday", it is "this
 * is the whole week" — and the cooldown must not be written on every keystroke
 * on the way to a two-digit number.
 */

vi.mock("@clerk/clerk-react", async () => {
  const { clerkTestDouble } = await import("../test/clerk");
  return clerkTestDouble();
});

/** Serves settings and records every PATCH body sent. */
function settingsWith(overrides: Partial<Settings>) {
  const patches: Partial<Settings>[] = [];
  let current = fixtures.settings(overrides);

  server.use(
    http.get("/api/settings", () => HttpResponse.json(current)),
    http.patch("/api/settings", async ({ request }) => {
      const body = (await request.json()) as Partial<Settings>;
      patches.push(body);
      // The server sorts trainingDays on the way in (trainingDaysSchema), so
      // a fake that echoed tap order would let a test pass against behaviour
      // the real API does not have.
      const merged = { ...current, ...body };
      current = {
        ...merged,
        trainingDays: [...merged.trainingDays].sort((a, b) => a - b),
      };
      return HttpResponse.json(current);
    }),
  );

  return patches;
}

function week() {
  return within(screen.getByRole("group", { name: /training days/i }));
}

describe("training days in Settings", () => {
  it("shows the week Monday first, though the numbering starts at Sunday", async () => {
    settingsWith({ trainingDays: [1, 2, 3, 4, 5] });
    renderRoute("/settings");

    await screen.findByRole("checkbox", { name: /monday/i });
    const labels = week()
      .getAllByRole("checkbox")
      .map((box) => box.getAttribute("aria-label"));

    // 0 = Sunday in the stored value; Sunday renders last all the same.
    expect(labels).toEqual([
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ]);
  });

  it("ticks the days that are stored and leaves the rest alone", async () => {
    settingsWith({ trainingDays: [0, 3] });
    renderRoute("/settings");

    expect(await screen.findByRole("checkbox", { name: /sunday/i })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /wednesday/i })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /monday/i })).not.toBeChecked();
  });

  it("sends the whole week when a day is ticked, not just the day", async () => {
    const patches = settingsWith({ trainingDays: [1, 3, 5] });
    renderRoute("/settings");

    await userEvent.click(await screen.findByRole("checkbox", { name: /saturday/i }));

    // Sending `[6]` here would take the athlete's other three days away.
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0].trainingDays).toEqual([1, 3, 5, 6]);
  });

  it("drops only the day unticked", async () => {
    const patches = settingsWith({ trainingDays: [1, 3, 5] });
    renderRoute("/settings");

    await userEvent.click(await screen.findByRole("checkbox", { name: /wednesday/i }));

    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0].trainingDays).toEqual([1, 5]);
  });

  it("derives the count from the days rather than offering it as a control", async () => {
    settingsWith({ trainingDays: [1, 3, 5] });
    renderRoute("/settings");

    expect(await screen.findByText(/3 days a week/i)).toBeInTheDocument();
    // There is no second control stating the same fact (DN-12).
    expect(screen.queryByRole("spinbutton", { name: /days per week/i })).not.toBeInTheDocument();
  });

  it("recounts after a write rather than holding the old number", async () => {
    settingsWith({ trainingDays: [1, 3, 5] });
    renderRoute("/settings");

    await userEvent.click(await screen.findByRole("checkbox", { name: /saturday/i }));

    expect(await screen.findByText(/4 days a week/i)).toBeInTheDocument();
  });

  it("freezes the last remaining day rather than letting it be unticked", async () => {
    // trainingDaysSchema refuses an empty week, so a checkbox that could empty
    // it is a control whose only outcome is a rejected write.
    const patches = settingsWith({ trainingDays: [2] });
    renderRoute("/settings");

    const tuesday = await screen.findByRole("checkbox", { name: /tuesday/i });
    expect(tuesday).toBeDisabled();

    await userEvent.click(tuesday);
    expect(patches).toHaveLength(0);
  });

  it("says why the last day is frozen instead of leaving it to be discovered", async () => {
    settingsWith({ trainingDays: [2] });
    renderRoute("/settings");

    expect(await screen.findByText(/keep at least one/i)).toBeInTheDocument();
  });

  it("leaves the other days tickable while one is frozen", async () => {
    // Only the last *checked* box is frozen — the unchecked ones are how you
    // get back above one day.
    settingsWith({ trainingDays: [2] });
    renderRoute("/settings");

    await screen.findByRole("checkbox", { name: /tuesday/i });
    expect(screen.getByRole("checkbox", { name: /friday/i })).toBeEnabled();
  });
});

describe("the repeat cooldown in Settings", () => {
  const field = () => screen.findByRole("spinbutton", { name: /repeat cooldown/i });

  it("shows what is stored", async () => {
    settingsWith({ patternCooldownDays: 7 });
    renderRoute("/settings");

    expect(await field()).toHaveValue(7);
  });

  it("writes once when the number is finished, not once per keystroke", async () => {
    const patches = settingsWith({ patternCooldownDays: 5 });
    renderRoute("/settings");

    const input = await field();
    await userEvent.clear(input);
    await userEvent.type(input, "12");
    // A live field would have written 1 on the way to 12.
    expect(patches).toHaveLength(0);

    await userEvent.tab();

    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0].patternCooldownDays).toBe(12);
  });

  it("commits on Enter, which is also when a number is finished", async () => {
    const patches = settingsWith({ patternCooldownDays: 5 });
    renderRoute("/settings");

    const input = await field();
    await userEvent.clear(input);
    await userEvent.type(input, "9{Enter}");

    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0].patternCooldownDays).toBe(9);
  });

  it("takes 0 as the answer it is rather than an empty box", async () => {
    const patches = settingsWith({ patternCooldownDays: 5 });
    renderRoute("/settings");

    const input = await field();
    await userEvent.clear(input);
    await userEvent.type(input, "0{Enter}");

    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0].patternCooldownDays).toBe(0);
    expect(await screen.findByText(/off — a workout can come round the next day/i)).toBeInTheDocument();
  });

  it("clamps past the ceiling here rather than sending it to be refused", async () => {
    // 30 is what the scheduler can honour: it reads this rule's history with
    // `take: 30`. A screen that knows the bound should apply it.
    const patches = settingsWith({ patternCooldownDays: 5 });
    renderRoute("/settings");

    const input = await field();
    await userEvent.clear(input);
    await userEvent.type(input, "99{Enter}");

    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0].patternCooldownDays).toBe(30);
  });

  it("falls back to what is stored when the box is left empty", async () => {
    // An unreadable box is not a value, and guessing at 0 would be guessing at
    // a real setting of its own.
    const patches = settingsWith({ patternCooldownDays: 5 });
    renderRoute("/settings");

    const input = await field();
    await userEvent.clear(input);
    await userEvent.tab();

    expect(patches).toHaveLength(0);
    expect(await field()).toHaveValue(5);
  });

  it("writes nothing when the number is retyped unchanged", async () => {
    const patches = settingsWith({ patternCooldownDays: 5 });
    renderRoute("/settings");

    const input = await field();
    await userEvent.clear(input);
    await userEvent.type(input, "5{Enter}");

    expect(patches).toHaveLength(0);
  });
});

describe("what a schedule write refreshes", () => {
  it("marks the cap Stats draws for refetch — the same fact under another key", async () => {
    // GET /schedule-rule is `trainingDays.length` derived server-side (DN-12),
    // so a settings write changes it without touching its cache entry. Stats
    // is not mounted here, and an invalidation with no subscriber does not
    // fetch — it flags the entry, which is what makes Stats refetch on the
    // next visit instead of drawing the old cap.
    settingsWith({ trainingDays: [1, 3, 5] });
    const { queryClient } = renderRoute("/settings");
    queryClient.setQueryData(["scheduleRule"], { maxDaysPerWeek: 3 });

    await userEvent.click(await screen.findByRole("checkbox", { name: /saturday/i }));

    await waitFor(() =>
      expect(queryClient.getQueryState(["scheduleRule"])?.isInvalidated).toBe(true),
    );
  });
});
