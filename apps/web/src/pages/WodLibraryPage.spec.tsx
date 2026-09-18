import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderRoute } from "../test/renderRoute";
import { server, http, HttpResponse } from "../test/server";
import * as fixtures from "../test/fixtures";

/**
 * The WOD editor, driven through the real route (DN-29).
 *
 * Two things are worth guarding here that the movement library did not have.
 * The tier, as before — which half of the library a write lands in decides
 * both whether it can be edited and which endpoint it goes to. And the shape
 * of a movement's count: `reps = sum(repScheme)` is a CHECK constraint in
 * Postgres, so a form that let the author state both would fail as an opaque
 * constraint violation. These run through msw so the assertions can be about
 * the body that actually leaves.
 */

vi.mock("@clerk/clerk-react", async () => {
  const { clerkTestDouble } = await import("../test/clerk");
  return clerkTestDouble();
});

const PUSHUP = fixtures.apiExercise({ id: "e1", name: "Push-up" });
const SQUAT = fixtures.apiExercise({ id: "e2", name: "Air squat" });
const MINE = fixtures.apiExercise({
  id: "e3",
  name: "Sandbag carry",
  ownerId: "user_alice",
});

/**
 * Every fixture WOD names a movement the pool actually offers.
 *
 * A WOD whose movement is not in the served pool is one the form is right to
 * refuse — `problemsWith` reports it and holds the write back — so a fixture
 * pointing at an exercise that isn't there tests the refusal, not the edit.
 */
const onPushup = (overrides: Partial<ReturnType<typeof fixtures.movement>> = {}) =>
  fixtures.movement({
    ...overrides,
    exercise: { ...fixtures.movement().exercise, id: "e1", name: "Push-up" },
  });

const FRAN = fixtures.apiWod({
  id: "w1",
  name: "Fran",
  ownerId: null,
  movements: [onPushup()],
});
const MY_WOD = fixtures.apiWod({
  id: "w2",
  name: "Garage Chipper",
  ownerId: "user_alice",
  movements: [onPushup({ reps: 20, repScheme: [] })],
});
const RETIRED = fixtures.apiWod({
  id: "w3",
  name: "Old Fran",
  ownerId: "user_alice",
  archivedAt: "2026-09-01T00:00:00.000Z",
  movements: [onPushup()],
});

/**
 * Serves the library and records every write as `METHOD /path`.
 *
 * The path is the assertion: `/wods` is the caller's own half and
 * `/admin/wods` is everyone's, and nothing else in the request says which was
 * meant.
 */
function library(rows = [FRAN, MY_WOD, RETIRED], { isAdmin = false } = {}) {
  const writes: string[] = [];
  const record = async ({ request }: { request: Request }) => {
    const { pathname } = new URL(request.url);
    writes.push(`${request.method} ${pathname.replace("/api", "")}`);
    return HttpResponse.json(rows[0]);
  };

  server.use(
    http.get("/api/me", () => HttpResponse.json({ id: "user_alice", isAdmin })),
    http.get("/api/exercises", () =>
      HttpResponse.json([PUSHUP, SQUAT, MINE]),
    ),
    http.get("/api/wods", () => HttpResponse.json(rows)),
    http.post("/api/wods", record),
    http.patch("/api/wods/:id", record),
    http.post("/api/wods/:id/archive", record),
    http.post("/api/wods/:id/unarchive", record),
    http.post("/api/admin/wods", record),
    http.patch("/api/admin/wods/:id", record),
    http.post("/api/admin/wods/:id/archive", record),
    http.post("/api/admin/wods/:id/unarchive", record),
  );

  return writes;
}

/** Captures the body of the next POST /wods. */
function captureCreate() {
  const sent: { body?: unknown } = {};
  server.use(
    http.post("/api/wods", async ({ request }) => {
      sent.body = await request.json();
      return HttpResponse.json(FRAN);
    }),
  );
  return sent;
}

async function section(name: RegExp) {
  return within(await screen.findByRole("list", { name }));
}

/** Opens the "add your own workout" form and names the workout. */
async function startNewWorkout(name: string) {
  await userEvent.click(
    await screen.findByRole("button", { name: /add your own workout/i }),
  );
  await userEvent.type(screen.getByLabelText(/^name$/i), name);
}

describe("the workout library", () => {
  it("asks for retired workouts too, so they can be brought back", async () => {
    const urls: string[] = [];
    server.use(
      http.get("/api/wods", ({ request }) => {
        urls.push(new URL(request.url).search);
        return HttpResponse.json([FRAN]);
      }),
    );

    renderRoute("/library/wods");

    await screen.findByText("Fran");
    expect(urls).toContain("?includeArchived=true");
  });

  it("puts a workout in the section that matches who owns it", async () => {
    library();
    renderRoute("/library/wods");

    const mine = await section(/your workouts/i);
    expect(mine.getByText("Garage Chipper")).toBeInTheDocument();
    expect(mine.queryByText("Fran")).not.toBeInTheDocument();

    const shared = await section(/shared library/i);
    expect(shared.getByText("Fran")).toBeInTheDocument();
  });

  it("says what a workout is without opening it", async () => {
    library();
    renderRoute("/library/wods");

    // Format, cap and shape, so a list of a dozen is scannable. Scoped to the
    // section, because a retired copy of the same workout summarises the same
    // way — which is the point of the summary, not a collision to design out.
    const shared = await section(/shared library/i);
    expect(
      shared.getByText(/^For time — 12 min cap — Push — 21-15-9 — 1 movement$/),
    ).toBeInTheDocument();
  });

  it("says a workout is retired in words rather than by styling alone", async () => {
    library();
    renderRoute("/library/wods");

    await screen.findByText("Old Fran");
    expect(screen.getByText(/retired/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /bring back old fran/i }),
    ).toBeInTheDocument();
  });

  it("offers an athlete no way to edit the shared library", async () => {
    library();
    renderRoute("/library/wods");

    await screen.findByText("Fran");
    expect(
      screen.queryByRole("button", { name: /edit fran/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /add a shared workout/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /edit garage chipper/i }),
    ).toBeInTheDocument();
  });

  it("offers an admin the shared library as well as their own", async () => {
    library(undefined, { isAdmin: true });
    renderRoute("/library/wods");

    expect(
      await screen.findByRole("button", { name: /edit fran/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /add a shared workout/i }),
    ).toBeInTheDocument();
  });

  it("retires and brings back on the athlete's own route", async () => {
    const writes = library();
    renderRoute("/library/wods");

    await userEvent.click(
      await screen.findByRole("button", { name: /retire garage chipper/i }),
    );
    await waitFor(() => expect(writes).toEqual(["POST /wods/w2/archive"]));

    await userEvent.click(
      screen.getByRole("button", { name: /bring back old fran/i }),
    );
    await waitFor(() =>
      expect(writes).toEqual([
        "POST /wods/w2/archive",
        "POST /wods/w3/unarchive",
      ]),
    );
  });

  it("sends an admin's edit of a shared workout to the admin route", async () => {
    const writes = library(undefined, { isAdmin: true });
    renderRoute("/library/wods");

    await userEvent.click(
      await screen.findByRole("button", { name: /edit fran/i }),
    );
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(writes).toEqual(["PATCH /admin/wods/w1"]));
  });
});

describe("stating how many reps", () => {
  it("sends a flat movement as reps, with no scheme", async () => {
    library();
    const sent = captureCreate();
    renderRoute("/library/wods");

    await startNewWorkout("Cindy");
    await userEvent.selectOptions(screen.getByLabelText(/^movement$/i), "e1");
    await userEvent.type(screen.getByLabelText(/reps per round/i), "15");
    await userEvent.click(screen.getByRole("button", { name: /add workout/i }));

    await waitFor(() =>
      expect(sent.body).toMatchObject({
        name: "Cindy",
        movements: [{ exerciseId: "e1", reps: 15, repScheme: [] }],
      }),
    );
  });

  it("sends a ladder as a scheme and lets the API total it", async () => {
    // The CHECK constraint `reps = sum(repScheme)` cannot be violated by a
    // body that never states the total.
    library();
    const sent = captureCreate();
    renderRoute("/library/wods");

    await startNewWorkout("Fran");
    await userEvent.selectOptions(screen.getByLabelText(/^movement$/i), "e1");
    await userEvent.click(screen.getByRole("radio", { name: /ladder/i }));
    await userEvent.type(screen.getByLabelText(/reps by round/i), "21-15-9");
    await userEvent.click(screen.getByRole("button", { name: /add workout/i }));

    await waitFor(() =>
      expect(sent.body).toMatchObject({
        movements: [{ exerciseId: "e1", reps: null, repScheme: [21, 15, 9] }],
      }),
    );
  });

  it("shows what a ladder adds up to rather than asking for it", async () => {
    library();
    renderRoute("/library/wods");

    await startNewWorkout("Fran");
    await userEvent.click(screen.getByRole("radio", { name: /ladder/i }));
    await userEvent.type(screen.getByLabelText(/reps by round/i), "21-15-9");

    expect(screen.getByText(/3 rounds, 45 reps in total/i)).toBeInTheDocument();
    // And there is no field to disagree with it.
    expect(screen.queryByLabelText(/reps per round/i)).not.toBeInTheDocument();
  });

  it("holds back ladders of different lengths", async () => {
    const writes = library();
    renderRoute("/library/wods");

    await startNewWorkout("Mixed");
    await userEvent.selectOptions(screen.getByLabelText(/^movement$/i), "e1");
    await userEvent.click(screen.getByRole("radio", { name: /ladder/i }));
    await userEvent.type(screen.getByLabelText(/reps by round/i), "21-15-9");

    await userEvent.click(screen.getByRole("button", { name: /add a movement/i }));
    const second = within(
      within(screen.getByRole("list", { name: /movements in this workout/i }))
        .getAllByRole("listitem")[1],
    );
    await userEvent.selectOptions(second.getByLabelText(/^movement$/i), "e2");
    await userEvent.click(second.getByRole("radio", { name: /ladder/i }));
    await userEvent.type(second.getByLabelText(/reps by round/i), "10-10");

    await userEvent.click(screen.getByRole("button", { name: /add workout/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /same number of rounds/i,
    );
    expect(writes).toEqual([]);
  });

  it("keeps the last movement, since a workout needs one", async () => {
    library();
    renderRoute("/library/wods");

    await startNewWorkout("Cindy");
    expect(
      screen.queryByRole("button", { name: /remove movement 1/i }),
    ).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /add a movement/i }));
    expect(
      screen.getByRole("button", { name: /remove movement 1/i }),
    ).toBeInTheDocument();
  });
});

describe("interval structure", () => {
  it("is hidden on a format that runs no timer", async () => {
    library();
    renderRoute("/library/wods");

    await startNewWorkout("Fran");
    expect(screen.queryByLabelText(/work \(s\)/i)).not.toBeInTheDocument();
  });

  it("appears on EMOM, saying what it falls back to", async () => {
    library();
    renderRoute("/library/wods");

    await startNewWorkout("Chipper");
    await userEvent.selectOptions(screen.getByLabelText(/format/i), "emom");

    expect(screen.getByLabelText(/work \(s\)/i)).toBeInTheDocument();
    // Shown rather than written into the row, so the workout keeps following
    // `resolveIntervalConfig` rather than freezing today's defaults.
    expect(screen.getByText(/60s on, 0s off, ×12/i)).toBeInTheDocument();
  });

  it("drops interval values when the format is switched away from one", async () => {
    // Typed as an EMOM, saved as For Time: the service refuses values it
    // would never read, so they never leave.
    library();
    const sent = captureCreate();
    renderRoute("/library/wods");

    await startNewWorkout("Chipper");
    await userEvent.selectOptions(screen.getByLabelText(/format/i), "emom");
    await userEvent.type(screen.getByLabelText(/work \(s\)/i), "45");
    await userEvent.selectOptions(screen.getByLabelText(/format/i), "for_time");
    await userEvent.selectOptions(screen.getByLabelText(/^movement$/i), "e1");
    await userEvent.type(screen.getByLabelText(/reps per round/i), "10");
    await userEvent.click(screen.getByRole("button", { name: /add workout/i }));

    await waitFor(() =>
      expect(sent.body).toMatchObject({
        type: "for_time",
        workSeconds: null,
      }),
    );
  });
});

describe("the movement pool a workout may draw on", () => {
  it("offers an athlete both tiers", async () => {
    library();
    renderRoute("/library/wods");

    await startNewWorkout("Cindy");
    const options = within(screen.getByLabelText(/^movement$/i))
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(options).toContain("Push-up");
    expect(options).toContain("Sandbag carry");
  });

  it("offers a shared workout only shared movements", async () => {
    // A global WOD is the scheduler's pool for everyone: naming one athlete's
    // own movement would break every athlete's scheduler the day they retired
    // it, and the API refuses it.
    library(undefined, { isAdmin: true });
    renderRoute("/library/wods");

    await userEvent.click(
      await screen.findByRole("button", { name: /add a shared workout/i }),
    );
    const options = within(screen.getByLabelText(/^movement$/i))
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(options).toContain("Push-up");
    expect(options).not.toContain("Sandbag carry");
  });
});

describe("what the API said", () => {
  it("says nothing about a form nobody has tried to submit yet", async () => {
    library();
    renderRoute("/library/wods");

    await userEvent.click(
      await screen.findByRole("button", { name: /add your own workout/i }),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("repeats a refusal the client did not anticipate", async () => {
    library();
    server.use(
      http.post("/api/wods", () =>
        HttpResponse.json(
          { message: 'A WOD is already called "Fran"' },
          { status: 409 },
        ),
      ),
    );
    renderRoute("/library/wods");

    await startNewWorkout("Fran");
    await userEvent.selectOptions(screen.getByLabelText(/^movement$/i), "e1");
    await userEvent.type(screen.getByLabelText(/reps per round/i), "21");
    await userEvent.click(screen.getByRole("button", { name: /add workout/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /already called "Fran"/i,
    );
  });

  it("opens an existing workout with its values already in the form", async () => {
    library();
    renderRoute("/library/wods");

    await userEvent.click(
      await screen.findByRole("button", { name: /edit garage chipper/i }),
    );

    expect(screen.getByLabelText(/^name$/i)).toHaveValue("Garage Chipper");
    expect(screen.getByLabelText(/reps per round/i)).toHaveValue(20);
  });
});

describe("finding the two halves of the library", () => {
  it("links each library screen to the other", async () => {
    library();
    renderRoute("/library/wods");

    const nav = within(await screen.findByRole("navigation", { name: /library sections/i }));
    expect(nav.getByRole("link", { name: "Movements" })).toHaveAttribute(
      "href",
      "/library",
    );
    expect(nav.getByRole("link", { name: "Workouts" })).toHaveAttribute(
      "href",
      "/library/wods",
    );
  });

  it("is reachable from the movement library", async () => {
    library();
    renderRoute("/library");

    await userEvent.click(await screen.findByRole("link", { name: "Workouts" }));

    expect(await screen.findByText(/every workout the app can schedule/i)).toBeInTheDocument();
  });
});
