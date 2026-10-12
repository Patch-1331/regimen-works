import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderRoute } from "../test/renderRoute";
import { server, http, HttpResponse } from "../test/server";
import * as fixtures from "../test/fixtures";

/**
 * The movement library, driven through the real route (DN-28, DN-171).
 *
 * The thing worth guarding here is the tier: which half of the library a row
 * belongs to decides both whether it can be edited and which endpoint the edit
 * goes to, and getting that wrong is a 403 at best and an athlete quietly
 * rewriting everyone's library at worst. So the assertions are mostly about
 * the URL a write reaches, which is why these run through msw rather than
 * against a mocked `api` object — a mock would happily agree with itself.
 */

vi.mock("@clerk/clerk-react", async () => {
  const { clerkTestDouble } = await import("../test/clerk");
  return clerkTestDouble();
});

const PUSHUP = fixtures.apiExercise({
  id: "g1",
  name: "Push-up",
  ownerId: null,
});
const SANDBAG = fixtures.apiExercise({
  id: "o1",
  name: "Sandbag carry",
  ownerId: "user_alice",
  movementGroup: null,
  sortOrder: null,
  unit: "seconds",
});
const RETIRED = fixtures.apiExercise({
  id: "o2",
  name: "Burpee",
  ownerId: "user_alice",
  movementGroup: null,
  sortOrder: null,
  archivedAt: "2026-09-01T00:00:00.000Z",
});

/**
 * Serves the library and records every write, as `METHOD /path`.
 *
 * The path is the assertion: `/exercises` is the caller's own half and
 * `/admin/exercises` is everyone's, and nothing else in the request says which
 * was meant.
 *
 * Live rows come back from the search as one page and retired ones from
 * their own endpoint, the way the API splits them (DN-171). The whole pool is
 * served too, for the form's alternative picker.
 */
function library(
  rows = [PUSHUP, SANDBAG, RETIRED],
  { isAdmin = false } = {},
) {
  const writes: string[] = [];
  const record = async ({ request }: { request: Request }) => {
    const { pathname } = new URL(request.url);
    writes.push(`${request.method} ${pathname.replace("/api", "")}`);
    return HttpResponse.json(rows[0]);
  };
  const live = rows.filter((e) => e.archivedAt === null);

  server.use(
    http.get("/api/me", () =>
      HttpResponse.json({ id: "user_alice", isAdmin }),
    ),
    http.get("/api/exercises/search", () =>
      HttpResponse.json({ items: live, total: live.length, page: 1, pageSize: 25 }),
    ),
    http.get("/api/exercises/retired", () =>
      HttpResponse.json(rows.filter((e) => e.archivedAt !== null)),
    ),
    http.get("/api/exercises", () => HttpResponse.json(live)),
    http.post("/api/exercises", record),
    http.patch("/api/exercises/:id", record),
    http.post("/api/exercises/:id/archive", record),
    http.post("/api/exercises/:id/unarchive", record),
    http.post("/api/admin/exercises", record),
    http.patch("/api/admin/exercises/:id", record),
    http.post("/api/admin/exercises/:id/archive", record),
    http.post("/api/admin/exercises/:id/unarchive", record),
  );

  return writes;
}

/**
 * Records the query string of every search the page sends, which is what
 * the URL's filters became.
 */
function searches(page: Partial<{ total: number; page: number }> = {}) {
  const queries: URLSearchParams[] = [];
  server.use(
    http.get("/api/exercises/search", ({ request }) => {
      const params = new URL(request.url).searchParams;
      queries.push(params);
      return HttpResponse.json({
        items: [PUSHUP],
        total: page.total ?? 1,
        page: Number(params.get("page")),
        pageSize: 25,
      });
    }),
  );
  return {
    queries,
    last: () => Object.fromEntries(queries[queries.length - 1]!),
  };
}

/** One of the lists, so "which list is this row in" is askable. */
async function section(name: RegExp) {
  return within(await screen.findByRole("list", { name }));
}

describe("the movement library", () => {
  it("lists both tiers together, the athlete's own marked as theirs", async () => {
    library();
    renderRoute("/library");

    const list = await section(/^movements$/i);
    expect(list.getByText("Push-up")).toBeInTheDocument();
    expect(list.getByText("Sandbag carry")).toBeInTheDocument();
    expect(list.getAllByText("YOURS")).toHaveLength(1);
    expect(
      within(list.getByText("Sandbag carry").closest("li")!).getByText("YOURS"),
    ).toBeInTheDocument();
  });

  it("lists retired movements apart, so they can be brought back", async () => {
    library();
    renderRoute("/library");

    const retired = await section(/retired movements/i);
    expect(retired.getByText("Burpee")).toBeInTheDocument();
    expect((await section(/^movements$/i)).queryByText("Burpee")).not.toBeInTheDocument();
  });

  it("says a movement is retired in words rather than by styling alone", async () => {
    library();
    renderRoute("/library");

    const row = (await screen.findByText("Burpee")).closest("li")!;
    expect(within(row).getByText(/retired/i)).toBeInTheDocument();
    // And it offers the way back, not a second Retire.
    expect(
      screen.getByRole("button", { name: /bring back burpee/i }),
    ).toBeInTheDocument();
  });

  it("offers an athlete no way to edit the shared library", async () => {
    library();
    renderRoute("/library");

    await screen.findByText("Push-up");
    expect(
      screen.queryByRole("button", { name: /edit push-up/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /retire push-up/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /add a shared movement/i }),
    ).not.toBeInTheDocument();
    // Their own half stays theirs.
    expect(
      screen.getByRole("button", { name: /edit sandbag carry/i }),
    ).toBeInTheDocument();
  });

  it("offers an admin the shared library as well as their own", async () => {
    library(undefined, { isAdmin: true });
    renderRoute("/library");

    expect(
      await screen.findByRole("button", { name: /edit push-up/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /add a shared movement/i }),
    ).toBeInTheDocument();
  });

  it("retires the athlete's own movement on their own route", async () => {
    const writes = library();
    renderRoute("/library");

    await userEvent.click(
      await screen.findByRole("button", { name: /retire sandbag carry/i }),
    );

    await waitFor(() =>
      expect(writes).toEqual(["POST /exercises/o1/archive"]),
    );
  });

  it("brings a retired movement back", async () => {
    const writes = library();
    renderRoute("/library");

    await userEvent.click(
      await screen.findByRole("button", { name: /bring back burpee/i }),
    );

    await waitFor(() =>
      expect(writes).toEqual(["POST /exercises/o2/unarchive"]),
    );
  });

  it("sends an admin's edit of a shared movement to the admin route", async () => {
    // The case the tier exists for: the same form, the same fields, and the
    // only difference is the half of the library it lands in.
    const writes = library(undefined, { isAdmin: true });
    renderRoute("/library");

    await userEvent.click(
      await screen.findByRole("button", { name: /edit push-up/i }),
    );
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(writes).toEqual(["PATCH /admin/exercises/g1"]),
    );
  });

  it("adds a movement to the athlete's own half", async () => {
    const writes = library();
    renderRoute("/library");

    await userEvent.click(
      await screen.findByRole("button", { name: /add your own movement/i }),
    );
    await userEvent.type(await screen.findByLabelText(/^name$/i), "Wall walk");
    await userEvent.click(
      screen.getByRole("button", { name: /add movement/i }),
    );

    await waitFor(() => expect(writes).toEqual(["POST /exercises"]));
  });

  it("carries the whole form through to the request", async () => {
    let body: unknown;
    server.use(
      http.get("/api/me", () =>
        HttpResponse.json({ id: "user_alice", isAdmin: false }),
      ),
      http.get("/api/exercises", () => HttpResponse.json([PUSHUP])),
      http.get("/api/exercises/search", () =>
        HttpResponse.json({ items: [PUSHUP], total: 1, page: 1, pageSize: 25 }),
      ),
      http.post("/api/exercises", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(PUSHUP);
      }),
    );
    renderRoute("/library");

    await userEvent.click(
      await screen.findByRole("button", { name: /add your own movement/i }),
    );
    await userEvent.type(await screen.findByLabelText(/^name$/i), "Ring row");
    await userEvent.selectOptions(screen.getByLabelText(/pattern/i), "pull");
    await userEvent.click(
      screen.getByRole("checkbox", { name: /pull-up bar/i }),
    );
    await userEvent.selectOptions(
      screen.getByLabelText(/alternative/i),
      "g1",
    );
    await userEvent.click(
      screen.getByRole("button", { name: /add movement/i }),
    );

    await waitFor(() =>
      expect(body).toMatchObject({
        name: "Ring row",
        pattern: "pull",
        equipment: ["bar"],
        fallbackExerciseId: "g1",
        movementGroup: null,
        sortOrder: null,
      }),
    );
  });

  it("holds back a movement that needs equipment and names no alternative", async () => {
    const writes = library();
    renderRoute("/library");

    await userEvent.click(
      await screen.findByRole("button", { name: /add your own movement/i }),
    );
    await userEvent.type(await screen.findByLabelText(/^name$/i), "Deadlift");
    await userEvent.click(
      screen.getByRole("checkbox", { name: /pull-up bar/i }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /add movement/i }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /has to name an alternative/i,
    );
    // Not sent, rather than sent and refused.
    expect(writes).toEqual([]);
  });

  it("says nothing about a form nobody has tried to submit yet", async () => {
    library();
    renderRoute("/library");

    await userEvent.click(
      await screen.findByRole("button", { name: /add your own movement/i }),
    );
    // The name is empty and therefore invalid, but the author is on their way
    // to typing it — a form that turns red first is reporting a state they
    // are passing through.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("repeats what the API said when it refuses anyway", async () => {
    // The client's rules are a restatement, not the authority: a name already
    // taken is a refusal only the API can make.
    server.use(
      http.get("/api/me", () =>
        HttpResponse.json({ id: "user_alice", isAdmin: false }),
      ),
      http.get("/api/exercises", () => HttpResponse.json([PUSHUP])),
      http.get("/api/exercises/search", () =>
        HttpResponse.json({ items: [PUSHUP], total: 1, page: 1, pageSize: 25 }),
      ),
      http.post("/api/exercises", () =>
        HttpResponse.json(
          { message: 'You already have a movement called "Ring row".' },
          { status: 409 },
        ),
      ),
    );
    renderRoute("/library");

    await userEvent.click(
      await screen.findByRole("button", { name: /add your own movement/i }),
    );
    await userEvent.type(await screen.findByLabelText(/^name$/i), "Ring row");
    await userEvent.click(
      screen.getByRole("button", { name: /add movement/i }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /you already have a movement called/i,
    );
  });

  it("opens an existing movement with its values already in the form", async () => {
    library();
    renderRoute("/library");

    await userEvent.click(
      await screen.findByRole("button", { name: /edit sandbag carry/i }),
    );

    expect(await screen.findByLabelText(/^name$/i)).toHaveValue("Sandbag carry");
    expect(screen.getByLabelText(/counted in/i)).toHaveValue("seconds");
  });

  it("does not offer a movement itself as its own alternative", async () => {
    library(undefined, { isAdmin: true });
    renderRoute("/library");

    await userEvent.click(
      await screen.findByRole("button", { name: /edit push-up/i }),
    );

    const options = within(await screen.findByLabelText(/alternative/i))
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(options).not.toContain("Push-up");
    // And a global movement is not offered one athlete's own.
    expect(options).not.toContain("Sandbag carry");
  });

  it("is reachable from the tab bar", async () => {
    library();
    renderRoute("/library");

    const tab = await screen.findByRole("link", { name: "LIBRARY" });
    expect(tab).toHaveAttribute("href", "/library");
  });
});

/**
 * Search, filters and paging (DN-171). Asserted on the query the page sends,
 * because the API does the filtering: what the page owes it is the URL's
 * filters, faithfully, and nothing over the whole library in the browser.
 */
describe("finding a movement", () => {
  it("searches with only what the athlete owns by default", async () => {
    const search = searches();
    renderRoute("/library");

    await screen.findByText("Push-up");
    expect(search.last()).toEqual({ owned: "true", page: "1" });
    expect(screen.getByRole("checkbox", { name: /only what i own/i })).toBeChecked();
  });

  it("reads the filters from the URL, so a link opens the same view", async () => {
    const search = searches();
    renderRoute("/library?q=push&muscle=chest&level=beginner&kit=all&page=2");

    await screen.findByText("Push-up");
    expect(search.last()).toEqual({
      q: "push",
      muscle: "chest",
      level: "beginner",
      owned: "false",
      page: "2",
    });
    expect(screen.getByRole("searchbox", { name: /search movements/i })).toHaveValue("push");
    expect(screen.getByRole("checkbox", { name: /only what i own/i })).not.toBeChecked();
    // A filter in the URL opens the panel, so the athlete can see what is
    // narrowing the list.
    expect(screen.getByLabelText(/^muscle$/i)).toHaveValue("chest");
  });

  it("drops a value the URL got wrong rather than emptying the page", async () => {
    const search = searches();
    renderRoute("/library?muscle=pecs&page=zero");

    await screen.findByText("Push-up");
    expect(search.last()).toEqual({ owned: "true", page: "1" });
  });

  it("searches as the athlete types, from the first page", async () => {
    const search = searches({ total: 60 });
    renderRoute("/library?page=2");

    await userEvent.type(
      await screen.findByRole("searchbox", { name: /search movements/i }),
      "row",
    );

    await waitFor(() => expect(search.last()).toMatchObject({ q: "row", page: "1" }));
  });

  it("narrows by a filter the athlete picks", async () => {
    const search = searches();
    renderRoute("/library");

    await userEvent.click(await screen.findByRole("button", { name: /filters/i }));
    await userEvent.selectOptions(screen.getByLabelText(/^equipment$/i), "kettlebell");

    await waitFor(() => expect(search.last()).toMatchObject({ equipment: "kettlebell" }));
    expect(screen.getByRole("button", { name: /filters \(1\)/i })).toBeInTheDocument();
  });

  it("shows the whole library once the kit switch is off", async () => {
    const search = searches();
    renderRoute("/library");

    await userEvent.click(
      await screen.findByRole("checkbox", { name: /only what i own/i }),
    );

    await waitFor(() => expect(search.last()).toMatchObject({ owned: "false" }));
  });

  it("clears every filter at once", async () => {
    const search = searches();
    renderRoute("/library?q=push&category=strength");

    await userEvent.click(await screen.findByRole("button", { name: /clear filters/i }));

    await waitFor(() => expect(search.last()).toEqual({ owned: "true", page: "1" }));
  });

  it("pages through the matches", async () => {
    const search = searches({ total: 60 });
    renderRoute("/library");

    expect(await screen.findByText("1–1 of 60")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /previous/i })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: /next/i }));

    await waitFor(() => expect(search.last()).toMatchObject({ page: "2" }));
  });

  it("says when nothing matches, and how to see more", async () => {
    server.use(
      http.get("/api/exercises/search", () =>
        HttpResponse.json({ items: [], total: 0, page: 1, pageSize: 25 }),
      ),
    );
    renderRoute("/library?q=zzz");

    expect(
      await screen.findByText(/no movements match with the equipment you own/i),
    ).toBeInTheDocument();
  });

  it("opens a movement's detail view, keeping the filters for the way back", async () => {
    searches();
    renderRoute("/library?q=push");

    await userEvent.click(await screen.findByRole("link", { name: "Push-up" }));

    expect(
      await screen.findByRole("link", { name: /← movements/i }),
    ).toHaveAttribute("href", "/library?q=push");
  });

  it("credits the dataset the shared library comes from", async () => {
    library();
    renderRoute("/library");

    expect(await screen.findByText(/free-exercise-db/i)).toBeInTheDocument();
    expect(screen.getByText(/public domain/i)).toBeInTheDocument();
  });
});
