import { http, HttpResponse } from "msw";
import * as fixtures from "./fixtures";

/**
 * The API, stubbed at the network boundary rather than by mocking
 * `src/lib/api.ts`.
 *
 * Stubbing fetch means `api.ts` itself is under test too — the `/api` base
 * path, the Authorization header, the empty-body-means-absent branch — and the
 * handlers survive a refactor of the `api` object's shape. It is also what the
 * e2e phase will want (DN-72), so the fixtures get a second life there.
 *
 * These are the happy-path defaults every route test starts from. A test that
 * cares about a different response overrides it with `server.use(...)`.
 *
 * Their own module, apart from the node server in `server.ts`, because the
 * browser's mock mode (DN-181, `src/mock/`) serves the same ones, and
 * `msw/node` does not load in a browser.
 */

// Matches API_BASE in src/lib/api.ts: vite proxies "/api" to the local API in
// development, and a deployed build points at the API's own origin.
const api = (path: string) => `/api${path}`;

export const handlers = [
  http.get(api("/today"), () => HttpResponse.json(fixtures.today())),
  http.get(api("/logs"), () => HttpResponse.json([fixtures.workoutLog()])),
  // Nothing finished by default (DN-18) -- the same default as `today()`'s
  // null card, so a spec that is not about program completion never has to
  // say so.
  http.get(api("/programs/completed"), () => HttpResponse.json([])),
  // No run under way and none behind by default (DN-179): a spec about the
  // Programs tab's runs serves the ones it means to show.
  http.get(api("/programs/runs"), () =>
    HttpResponse.json({ current: null, past: [] }),
  ),
  http.post(api("/programs/:enrollmentId/dismiss"), () =>
    HttpResponse.json({ dismissed: true }),
  ),
  http.post(api("/programs/:enrollmentId/run-again"), ({ params }) =>
    HttpResponse.json({ enrollmentId: `re-${String(params.enrollmentId)}` }),
  ),
  http.get(api("/exercises"), ({ request }) => {
    // The library page asks the same endpoint for retired rows too (DN-28).
    // Matched on the query here rather than as a second handler, because msw
    // matches a bare path against both and the first one registered wins.
    const includeArchived =
      new URL(request.url).searchParams.get("includeArchived") === "true";
    return HttpResponse.json(
      includeArchived
        ? [fixtures.apiExercise(), fixtures.apiExercise({ id: "exercise-2", name: "Ring row", ownerId: "user_alice" })]
        : [fixtures.apiExercise()],
    );
  }),
  // The library page's search (DN-171): one page holding the one fixture
  // movement. Registered before `/exercises/:id`, which would otherwise read
  // "search" and "retired" as ids.
  http.get(api("/exercises/search"), () =>
    HttpResponse.json({ items: [fixtures.apiExercise()], total: 1, page: 1, pageSize: 25 }),
  ),
  http.get(api("/exercises/retired"), () => HttpResponse.json([])),
  // One bodyweight suggestion for either tier (DN-205): the fixture movement
  // that the library form's pool also holds, so choosing it saves.
  http.post(api("/exercises/suggest-alternatives"), () =>
    HttpResponse.json([fixtures.apiExercise()]),
  ),
  http.post(api("/admin/exercises/suggest-alternatives"), () =>
    HttpResponse.json([fixtures.apiExercise()]),
  ),
  // Nothing to move to by default (DN-185), like the swap panel's options.
  http.get(api("/exercises/:id/alternatives"), () =>
    HttpResponse.json({ main: [], harder: [], needsEquipment: [] }),
  ),
  http.get(api("/exercises/:id"), () => HttpResponse.json(fixtures.apiExercise())),
  http.get(api("/checklist-entries"), () => HttpResponse.json([])),
  http.get(api("/skill-levels"), () => HttpResponse.json([fixtures.skillLevel()])),
  // The WOD library, empty by default (DN-29): most route tests are about a
  // day rather than about the pool it was planned from.
  http.get(api("/wods"), () => HttpResponse.json([])),
  // Empty by default: a movement history is something an athlete accrues, and
  // most route tests are about a day rather than about months of them.
  http.get(api("/movement-history"), () => HttpResponse.json([])),
  // Empty for the same reason, and for one more: a movement's volume only
  // exists once a prescribed day has been run set by set (DN-22).
  http.get(api("/movement-volume"), () => HttpResponse.json([])),
  http.get(api("/schedule-rule"), () => HttpResponse.json({ maxDaysPerWeek: 5 })),
  http.get(api("/settings"), () => HttpResponse.json(fixtures.settings())),
  // Not an admin by default: the admin is one hand-set flag on one account,
  // so an athlete is what a test should get unless it says otherwise.
  // Not an admin, and onboarded: the route guard (DN-15) sends an athlete
  // with a null `onboardedAt` into the wizard, so a default of null would put
  // every route test in this suite on the setup screen instead of the page it
  // is about. A test about the wizard says so by overriding this.
  http.get(api("/me"), () =>
    HttpResponse.json({
      id: "user_alice",
      isAdmin: false,
      onboardedAt: "2026-09-01T08:00:00.000Z",
    }),
  ),

  // The first-run wizard (DN-15). Registered so a test that lands on the
  // setup route by accident fails on what it rendered rather than on an
  // unhandled request.
  http.get(api("/setup"), () => HttpResponse.json(fixtures.setupOptions())),
  http.post(api("/setup"), () =>
    HttpResponse.json({ onboardedAt: "2026-09-16T09:00:00.000Z" }),
  ),

  // 204 is how the API says "no log yet" — api.ts turns the empty body into null.
  http.get(api(`/assignments/:assignmentId/log`), () => new HttpResponse(null, { status: 204 })),
  http.get(api(`/assignments/:assignmentId/session`), () => new HttpResponse(null, { status: 204 })),
  http.get(api(`/assignments/:assignmentId/substitutions/movement-changes`), () => HttpResponse.json([])),
  // Nothing to swap to by default (DN-170): a test about the panel serves the
  // sections it means to show.
  http.get(api(`/assignments/:assignmentId/substitutions/options`), () =>
    HttpResponse.json({ main: [], harder: [], needsEquipment: [] }),
  ),

  http.post(api(`/assignments/:assignmentId/session`), () => HttpResponse.json(fixtures.session())),
  http.post(api(`/assignments/:assignmentId/session/interval`), () =>
    HttpResponse.json(fixtures.session({ intervalIndex: 0, intervalStartedAtSeconds: 0 })),
  ),
  http.post(api(`/assignments/:assignmentId/session/rounds`), () => HttpResponse.json(fixtures.session())),
  http.post(api(`/assignments/:assignmentId/session/sets`), () =>
    HttpResponse.json(fixtures.session({ setsCompleted: 1, restStartedAtSeconds: 0 })),
  ),
  // Empty by default: most days have no sets recorded, and a test that cares
  // about them says so.
  http.get(api(`/assignments/:assignmentId/session/sets`), () => HttpResponse.json([])),
  http.patch(api(`/assignments/:assignmentId/session/sets`), () => HttpResponse.json([])),
  http.post(api(`/assignments/:assignmentId/session/finish`), () =>
    HttpResponse.json(fixtures.session({ status: 'completed', finishedAtSeconds: 300 })),
  ),
  http.post(api(`/assignments/:assignmentId/session/warmup-complete`), () =>
    HttpResponse.json(fixtures.session({ warmupCompletedAt: "2026-09-16T10:01:00.000Z" })),
  ),
  http.post(api(`/assignments/:assignmentId/session/cooldown-complete`), () =>
    HttpResponse.json(fixtures.session({ cooldownCompletedAt: "2026-09-16T10:30:00.000Z" })),
  ),
];
