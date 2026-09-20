import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CommitSetup } from "@regimen-works/shared";
import { addIsoDays } from "@regimen-works/shared";
import { renderRoute } from "../test/renderRoute";
import { server, http, HttpResponse } from "../test/server";
import * as fixtures from "../test/fixtures";
import { localIsoDate } from "../lib/weekdays";

vi.mock("@clerk/clerk-react", async () => {
  const { clerkTestDouble } = await import("../test/clerk");
  return clerkTestDouble();
});

/**
 * The first-run wizard (DN-15).
 *
 * Three questions and then training, which makes this the first screen an
 * athlete ever sees and the one place a wrong answer is expensive: the three
 * it collects decide what every later day of the app is.
 */

// Anchored to the real clock rather than to a fixed date, because the screen
// compares the dates the API offers against the browser's own today -- a
// hard-coded fixture would be "three weeks ago" by the time anyone read it.
const TODAY = localIsoDate();
const RANGE = {
  earliestStartDate: TODAY,
  latestStartDate: addIsoDays(TODAY, 20),
};

/** An athlete who has not finished setup, with the wizard's own answers stubbed. */
function newAthlete(
  options: {
    setup?: Partial<ReturnType<typeof fixtures.setupOptions>>;
    commitFails?: string;
  } = {},
) {
  const sent: CommitSetup[] = [];
  server.use(
    // Answered from what has actually been committed, rather than pinned to
    // null: the wizard invalidates every query on success, so a `/me` frozen
    // at un-onboarded would send the athlete it just onboarded straight back
    // into setup -- and would hide a real regression behind a stub.
    http.get("/api/me", () =>
      HttpResponse.json({
        id: "user_alice",
        isAdmin: false,
        onboardedAt: sent.length > 0 ? "2026-09-16T09:00:00.000Z" : null,
      }),
    ),
    http.get("/api/setup", () =>
      HttpResponse.json(fixtures.setupOptions({ ...RANGE, ...options.setup })),
    ),
    http.post("/api/setup", async ({ request }) => {
      sent.push((await request.json()) as CommitSetup);
      if (options.commitFails) {
        return HttpResponse.json(
          { message: options.commitFails },
          { status: 400 },
        );
      }
      return HttpResponse.json({ onboardedAt: "2026-09-16T09:00:00.000Z" });
    }),
  );
  return sent;
}

/**
 * Clicks a button once it is there.
 *
 * `find` rather than `get` because the gate renders nothing at all while
 * `/me` is in flight -- which is the behaviour the flash test pins, and which
 * every other test here has to wait through.
 */
const click = async (name: string | RegExp) =>
  userEvent.click(await screen.findByRole("button", { name }));

/** Welcome, program, then whichever cadence screen that program has. */
async function walkTo(program: string) {
  await click("Begin");
  await click(new RegExp(program));
}

describe("the setup gate", () => {
  it("sends an athlete who has not finished setup into the wizard", async () => {
    newAthlete();
    renderRoute("/");

    expect(
      await screen.findByRole("heading", { name: "Let's set up your training" }),
    ).toBeInTheDocument();
  });

  it("leaves an athlete who has finished setup where they were", async () => {
    // The default `/me` is onboarded, which is what every other route test in
    // this suite depends on.
    renderRoute("/");

    expect(await screen.findByRole("heading", { name: "Fran" })).toBeInTheDocument();
  });

  it("does not mount the app on the way to the wizard", async () => {
    // Asserted as a request rather than as pixels: Today renders a loading
    // state before it renders a workout, so "no heading yet" would pass even
    // for a Today that had mounted and started fetching. The fetch is the
    // cost, and it is one an athlete who has configured nothing should not
    // be paying on their first screen.
    let askedForToday = 0;
    newAthlete();
    server.use(
      http.get("/api/today", () => {
        askedForToday += 1;
        return HttpResponse.json(fixtures.today());
      }),
    );
    renderRoute("/");

    await screen.findByRole("heading", { name: "Let's set up your training" });
    expect(askedForToday).toBe(0);
  });
});

describe("the three questions", () => {
  it("asks for a program, then days, then a start date", async () => {
    newAthlete();
    renderRoute("/setup");

    await click("Begin");
    expect(
      screen.getByRole("heading", { name: "Pick your program" }),
    ).toBeInTheDocument();

    await click(/Pull-Up Builder/);
    expect(
      screen.getByRole("heading", { name: "Which days do you train?" }),
    ).toBeInTheDocument();

    await click("Continue");
    expect(
      screen.getByRole("heading", { name: "When do you start?" }),
    ).toBeInTheDocument();
  });

  it("starts the day picker from the days the program suggests", async () => {
    newAthlete();
    renderRoute("/setup");
    await walkTo("Pull-Up Builder");

    // Mon/Wed/Fri, which is what `defaultDays` says -- the program's opinion,
    // offered rather than imposed.
    expect(screen.getByRole("button", { name: "Monday" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Tuesday" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("counts the days rather than asking for a number", async () => {
    // Derived exactly as it is on the server: there is no second control that
    // could disagree with the days (DN-12).
    newAthlete();
    renderRoute("/setup");
    await walkTo("Pull-Up Builder");

    await click("Tuesday");

    expect(await screen.findByText("4")).toBeInTheDocument();
  });

  it("commits the three answers together", async () => {
    const sent = newAthlete();
    renderRoute("/setup");
    await walkTo("Pull-Up Builder");
    await click("Continue");
    await click("Continue");
    await click("Go to today");

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({
      planId: "plan-pull-up-builder",
      trainingDays: [1, 3, 5],
      weeks: 6,
      startDate: TODAY,
    });
  });

  it("lands the athlete on today once setup is committed", async () => {
    newAthlete();
    renderRoute("/setup");
    await walkTo("Pull-Up Builder");
    await click("Continue");
    await click("Continue");
    await click("Go to today");

    expect(await screen.findByRole("heading", { name: "Fran" })).toBeInTheDocument();
  });
});

describe("going back", () => {
  it("keeps the days the athlete picked", async () => {
    // The answers live above the steps, so a step is a way of looking at them
    // rather than a place they are kept.
    newAthlete();
    renderRoute("/setup");
    await walkTo("Pull-Up Builder");
    await click("Tuesday");

    await click("Continue");
    await click("Back");

    expect(screen.getByRole("button", { name: "Tuesday" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("keeps the days when the athlete goes back to the program list and forward again", async () => {
    // Re-picking the same program must not re-seed its suggestion over the
    // athlete's own choice -- looking at the list is not changing your mind.
    newAthlete();
    renderRoute("/setup");
    await walkTo("Pull-Up Builder");
    await click("Tuesday");

    await click("Back");
    await click(/Pull-Up Builder/);

    expect(screen.getByRole("button", { name: "Tuesday" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("re-seeds the days when the athlete picks a different program", async () => {
    // A different program's suggestion is a different program's opinion, and
    // carrying four days across to one that allows three would hand them a
    // cadence they never chose.
    newAthlete();
    renderRoute("/setup");
    await walkTo("Pull-Up Builder");
    await click("Tuesday");

    await click("Back");
    await click(/Just WODs/);

    expect(screen.getByRole("button", { name: "Tuesday" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Saturday" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    // Just WODs suggests Mon–Fri, which is five days, not the four that were
    // on screen a moment ago.
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("keeps the start date across the cadence screen", async () => {
    const sent = newAthlete();
    renderRoute("/setup");
    await walkTo("Pull-Up Builder");
    await click("Continue");

    const monday = screen
      .getAllByRole("button")
      .find((b) => b.getAttribute("aria-label")?.startsWith("Monday"))!;
    await userEvent.click(monday);
    const chosen = monday.getAttribute("aria-label")!;

    await click("Back");
    await click("Continue");

    expect(
      screen.getByRole("button", { name: chosen }),
    ).toHaveAttribute("aria-pressed", "true");
    await click("Continue");
    await click("Go to today");
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].startDate).not.toBe(TODAY);
  });
});

describe("a day count the program will not take", () => {
  it("says so in the program's own words", async () => {
    newAthlete();
    renderRoute("/setup");
    await walkTo("Pull-Up Builder");

    await click("Friday");
    await click("Wednesday");

    expect(
      await screen.findByText("Pull-Up Builder needs at least 3 days a week."),
    ).toBeInTheDocument();
  });

  it("will not let the athlete carry it forward", async () => {
    // The alternative is a wizard that accepts the answer and refuses the
    // whole setup two screens later.
    newAthlete();
    renderRoute("/setup");
    await walkTo("Pull-Up Builder");
    await click("Friday");
    await click("Wednesday");

    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("clears once the count is back inside the bounds", async () => {
    newAthlete();
    renderRoute("/setup");
    await walkTo("Pull-Up Builder");
    await click("Friday");
    await click("Wednesday");
    await click("Tuesday");
    await click("Thursday");

    expect(
      screen.queryByText("Pull-Up Builder needs at least 3 days a week."),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
  });
});

describe("a fixed program", () => {
  it("shows its days rather than asking for any", async () => {
    newAthlete();
    renderRoute("/setup");
    await walkTo("Bar Muscle-Up");

    expect(
      screen.getByRole("heading", { name: "Your training week" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Monday" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Monday" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Wednesday" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("names the program as the reason", async () => {
    // "Your schedule is locked" without saying what locked it is not an
    // answer the athlete can act on (DN-118).
    newAthlete();
    renderRoute("/setup");
    await walkTo("Bar Muscle-Up");

    expect(screen.getByText("Set by Bar Muscle-Up")).toBeInTheDocument();
  });

  it("names the days it trains before the athlete agrees to it", async () => {
    // The locked picker shows the days as pressed buttons; this says them in
    // words, on the way in rather than when they bite (DN-124).
    newAthlete();
    renderRoute("/setup");
    await walkTo("Bar Muscle-Up");

    expect(
      screen.getByText(
        /Bar Muscle-Up trains Monday, Tuesday, Thursday and Friday/,
      ),
    ).toBeInTheDocument();
  });

  it("gives the author's own reason for the week's shape", async () => {
    // The difference between a rule and a piece of programming is whether
    // anyone says why. Without this the athlete is told what they cannot do
    // and nothing else.
    newAthlete();
    renderRoute("/setup");
    await walkTo("Bar Muscle-Up");

    expect(
      screen.getByText(/Two heavy pull days, 48 hours apart/),
    ).toBeInTheDocument();
  });

  it("says nothing extra for a program with no reason to give", async () => {
    // Nullable, and most programs are null. An empty panel where the reason
    // would be reads as a program that forgot to explain itself.
    newAthlete({
      setup: {
        programs: [fixtures.fixedProgram({ scheduleNote: null })],
      },
    });
    renderRoute("/setup");
    await walkTo("Bar Muscle-Up");

    expect(screen.queryByText(/48 hours apart/)).not.toBeInTheDocument();
    // Still told which days it trains -- that part is not optional.
    expect(
      screen.getByText(/Bar Muscle-Up trains Monday, Tuesday/),
    ).toBeInTheDocument();
  });

  it("warns that rest days will not offer a makeup, before the commit", async () => {
    // DN-17 suppresses the makeup offer entirely on a fixed program, and
    // until now that was only discoverable by missing a session and finding
    // no way back. The confirm screen is the last place it can be said in
    // time to matter.
    newAthlete();
    renderRoute("/setup");
    await walkTo("Bar Muscle-Up");
    await click("Continue");
    await click("Continue");

    expect(
      screen.getByRole("heading", { name: "While Bar Muscle-Up runs" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/nothing will offer to move a missed session onto one/),
    ).toBeInTheDocument();
  });

  it("promises the athlete's own days back when it finishes", async () => {
    // Set aside for the run, not taken. The day picker in Settings goes back
    // to the athlete's own answer the moment the enrollment completes.
    newAthlete();
    renderRoute("/setup");
    await walkTo("Bar Muscle-Up");
    await click("Continue");
    await click("Continue");

    expect(
      screen.getByText(
        /Your own training days sit out the run and come back when it finishes/,
      ),
    ).toBeInTheDocument();
  });

  it("sends no training days at all", async () => {
    // Null rather than the program's own days echoed back: the API refuses
    // days for a fixed program rather than storing them and overruling them.
    const sent = newAthlete();
    renderRoute("/setup");
    await walkTo("Bar Muscle-Up");
    await click("Continue");
    await click("Continue");
    await click("Go to today");

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].trainingDays).toBeNull();
    expect(sent[0].weeks).toBe(6);
  });
});

describe("a program that leaves the week alone", () => {
  it("says what training fewer days than it was written for costs", async () => {
    // Since DN-128 a short week keeps the highest-ranked sessions rather
    // than whichever ones the calendar left. That is worth knowing while the
    // athlete is still choosing the count.
    newAthlete();
    renderRoute("/setup");
    await walkTo("Pull-Up Builder");

    expect(
      screen.getByText(/At 3 days you get Pull-Up Builder's main sessions/),
    ).toBeInTheDocument();
  });

  it("makes no promises about rest days it does not keep", async () => {
    // A flexible program does offer the makeup and does keep the athlete's
    // days, so every line of the fixed-program panel would be a lie here.
    newAthlete();
    renderRoute("/setup");
    await walkTo("Just WODs");
    await click("Continue");
    await click("Continue");

    // On the confirm screen, so the absences below are absences and not a
    // test that walked off the end of the wizard.
    expect(
      await screen.findByRole("button", { name: "Go to today" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /While Just WODs runs/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/nothing will offer to move a missed session/),
    ).not.toBeInTheDocument();
  });
});

describe("how long to run it", () => {
  it("starts at the length the program was written as", async () => {
    newAthlete();
    renderRoute("/setup");
    await walkTo("Pull-Up Builder");

    expect(screen.getByText("6 weeks")).toBeInTheDocument();
    expect(
      screen.getByText("Pull-Up Builder is written as 6 weeks."),
    ).toBeInTheDocument();
  });

  it("says what a changed length does to the program", async () => {
    newAthlete();
    renderRoute("/setup");
    await walkTo("Pull-Up Builder");

    await click("More weeks");

    expect(screen.getByText("7 weeks")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Pull-Up Builder is written as 6 weeks — 7 repeats or trims the middle block.",
      ),
    ).toBeInTheDocument();
  });

  it("will not step below the program's minimum", async () => {
    newAthlete();
    renderRoute("/setup");
    await walkTo("Pull-Up Builder");

    for (let i = 0; i < 2; i += 1) await click("Fewer weeks");

    expect(screen.getByText("4 weeks")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fewer weeks" })).toBeDisabled();
  });

  it("will not step past the program's maximum", async () => {
    // The other end, and not a mirror of the first: a stepper that stopped at
    // the floor and ran past the ceiling would offer a length the commit
    // refuses, which is the wizard asking a question it will not take the
    // answer to.
    newAthlete();
    renderRoute("/setup");
    await walkTo("Pull-Up Builder");

    for (let i = 0; i < 2; i += 1) await click("More weeks");

    expect(screen.getByText("8 weeks")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "More weeks" })).toBeDisabled();
  });

  it("offers no length for an open-ended program", async () => {
    // Just WODs never finishes, so a stepper would be a completion date for
    // something that never completes.
    newAthlete();
    renderRoute("/setup");
    await walkTo("Just WODs");

    expect(
      screen.queryByRole("button", { name: "More weeks" }),
    ).not.toBeInTheDocument();
  });

  it("sends no length for an open-ended program", async () => {
    const sent = newAthlete();
    renderRoute("/setup");
    await walkTo("Just WODs");
    await click("Continue");
    await click("Continue");
    await click("Go to today");

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].weeks).toBeNull();
  });
});

describe("the start date", () => {
  it("offers today when today has not been trained", async () => {
    newAthlete();
    renderRoute("/setup");
    await walkTo("Pull-Up Builder");
    await click("Continue");

    expect(
      screen.getByText("Start today and this morning's workout becomes day 1."),
    ).toBeInTheDocument();
  });

  it("explains itself when the earliest start is tomorrow", async () => {
    // The API moves the earliest date the moment today has been trained,
    // because committing a start of today discards today's assignment.
    newAthlete({
      setup: {
        earliestStartDate: addIsoDays(TODAY, 1),
        latestStartDate: addIsoDays(TODAY, 21),
      },
    });
    renderRoute("/setup");
    await walkTo("Pull-Up Builder");
    await click("Continue");

    expect(
      screen.getByText(
        "Today's already under way, so the earliest start is tomorrow.",
      ),
    ).toBeInTheDocument();
  });

  it("offers exactly the dates the API allowed", async () => {
    newAthlete();
    renderRoute("/setup");
    await walkTo("Pull-Up Builder");
    await click("Continue");

    // Three weeks, and not a day beyond what the commit would take.
    expect(
      screen
        .getAllByRole("button")
        .filter((b) => /^\w+day \d+ \w+$/.test(b.getAttribute("aria-label") ?? "")),
    ).toHaveLength(21);
  });
});

describe("a commit the API refuses", () => {
  it("shows what it said and leaves the athlete on the wizard", async () => {
    // The API is the authority on every rule here, and its sentences are
    // written to be read -- a refusal reaching the screen as "400" would
    // leave the athlete guessing which of three answers it meant.
    newAthlete({ commitFails: "Pull-Up Builder runs for between 4 and 8 weeks." });
    renderRoute("/setup");
    await walkTo("Pull-Up Builder");
    await click("Continue");
    await click("Continue");
    await click("Go to today");

    expect(
      await screen.findByText("Pull-Up Builder runs for between 4 and 8 weeks."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "You're ready" }),
    ).toBeInTheDocument();
  });
});
