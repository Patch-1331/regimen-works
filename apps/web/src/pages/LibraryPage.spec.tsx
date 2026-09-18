import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderRoute } from "../test/renderRoute";
import { server, http, HttpResponse } from "../test/server";
import * as fixtures from "../test/fixtures";

/**
 * The movement library, driven through the real route (DN-28).
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
  line: null,
  rung: null,
  unit: "seconds",
});
const RETIRED = fixtures.apiExercise({
  id: "o2",
  name: "Burpee",
  ownerId: "user_alice",
  line: null,
  rung: null,
  archivedAt: "2026-09-01T00:00:00.000Z",
});

/**
 * Serves the library and records every write, as `METHOD /path`.
 *
 * The path is the assertion: `/exercises` is the caller's own half and
 * `/admin/exercises` is everyone's, and nothing else in the request says which
 * was meant.
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

  server.use(
    http.get("/api/me", () =>
      HttpResponse.json({ id: "user_alice", isAdmin }),
    ),
    http.get("/api/exercises", () => HttpResponse.json(rows)),
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

/** One of the two lists, so "which section is this row in" is askable. */
async function section(name: RegExp) {
  return within(await screen.findByRole("list", { name }));
}

describe("the movement library", () => {
  it("asks for retired movements too, so they can be brought back", async () => {
    const urls: string[] = [];
    server.use(
      http.get("/api/exercises", ({ request }) => {
        urls.push(new URL(request.url).search);
        return HttpResponse.json([PUSHUP]);
      }),
    );

    renderRoute("/library");

    await screen.findByText("Push-up");
    expect(urls).toContain("?includeArchived=true");
  });

  it("puts a movement in the section that matches who owns it", async () => {
    library();
    renderRoute("/library");

    const mine = await section(/your movements/i);
    expect(mine.getByText("Sandbag carry")).toBeInTheDocument();
    expect(mine.queryByText("Push-up")).not.toBeInTheDocument();

    const shared = await section(/shared library/i);
    expect(shared.getByText("Push-up")).toBeInTheDocument();
    expect(shared.queryByText("Sandbag carry")).not.toBeInTheDocument();
  });

  it("says a movement is retired in words rather than by styling alone", async () => {
    library();
    renderRoute("/library");

    await screen.findByText("Burpee");
    expect(screen.getByText(/retired/i)).toBeInTheDocument();
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
    await userEvent.type(screen.getByLabelText(/^name$/i), "Wall walk");
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
      http.post("/api/exercises", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(PUSHUP);
      }),
    );
    renderRoute("/library");

    await userEvent.click(
      await screen.findByRole("button", { name: /add your own movement/i }),
    );
    await userEvent.type(screen.getByLabelText(/^name$/i), "Ring row");
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
        altExerciseId: "g1",
        line: null,
        rung: null,
      }),
    );
  });

  it("holds back a movement that needs equipment and names no alternative", async () => {
    const writes = library();
    renderRoute("/library");

    await userEvent.click(
      await screen.findByRole("button", { name: /add your own movement/i }),
    );
    await userEvent.type(screen.getByLabelText(/^name$/i), "Deadlift");
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
    await userEvent.type(screen.getByLabelText(/^name$/i), "Ring row");
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

    expect(screen.getByLabelText(/^name$/i)).toHaveValue("Sandbag carry");
    expect(screen.getByLabelText(/counted in/i)).toHaveValue("seconds");
  });

  it("does not offer a movement itself as its own alternative", async () => {
    library(undefined, { isAdmin: true });
    renderRoute("/library");

    await userEvent.click(
      await screen.findByRole("button", { name: /edit push-up/i }),
    );

    const options = within(screen.getByLabelText(/alternative/i))
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
