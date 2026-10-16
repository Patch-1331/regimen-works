import { setupWorker } from "msw/browser";
import { http, HttpResponse } from "msw";
import { addIsoDays, type ProgramSummary } from "@regimen-works/shared";
import { handlers } from "../test/handlers";
import * as fixtures from "../test/fixtures";
import { localIsoDate } from "../lib/weekdays";

/**
 * The API in mock mode (DN-181): the vitest suite's own default handlers,
 * served by msw's service worker, so the browser shows what the specs assert
 * against and needs no API, database or Clerk.
 *
 * A few extras ahead of them, for screens the specs fill per test and which
 * would otherwise be empty or reach for a real API that is not there.
 * Stateless, like the specs: a write answers, and the next read is as it was.
 */

const api = (path: string) => `/api${path}`;

const yours: ProgramSummary = {
  id: "program-pull-days",
  name: "Pull days",
  summary: "Your own program, three days a week.",
  scheduleMode: "flexible",
  days: [1, 3, 5],
  archived: false,
};

const extras = [
  http.get(api("/programs/runs"), () =>
    HttpResponse.json({
      current: fixtures.programRun({ week: 2 }),
      past: [
        fixtures.programRun({
          enrollmentId: "enrollment-0",
          programName: "Pull-Up Builder",
          status: "ended",
          week: 3,
          finishedAt: "2026-08-20T09:00:00.000Z",
        }),
      ],
    }),
  ),
  http.get(api("/programs/library"), () =>
    HttpResponse.json([
      {
        ...yours,
        id: fixtures.boundedProgram().id,
        name: "Pull-Up Builder",
        summary: "Your first chin-up, six weeks.",
      },
    ]),
  ),
  http.get(api("/programs"), () => HttpResponse.json([yours])),
  // Everything above startable, and dates from the real clock rather than
  // the specs' fixed Wednesday, which would offer start dates in the past.
  http.get(api("/setup"), () => {
    const defaults = fixtures.setupOptions();
    return HttpResponse.json({
      ...defaults,
      programs: [
        ...defaults.programs,
        fixtures.setupProgram({
          id: yours.id,
          name: yours.name,
          summary: yours.summary,
          minDaysPerWeek: 3,
          maxDaysPerWeek: 3,
          defaultDays: yours.days,
        }),
      ],
      earliestStartDate: localIsoDate(),
      latestStartDate: addIsoDays(localIsoDate(), 20),
    });
  }),
];

export async function startMockApi() {
  await setupWorker(...extras, ...handlers).start({
    // Said once in the console rather than on every request.
    quiet: true,
    // A request nothing here answers is a gap in the mocks, and saying so
    // beats a proxy error to an API that is not running.
    // Typed loosely because a frame may be a WebSocket one, with no request.
    onUnhandledFrame: ({ frame, defaults }) => {
      const request = (frame.data as { request?: Request }).request;
      if (request && new URL(request.url).pathname.startsWith("/api/")) {
        defaults.warn();
      }
    },
  });
}
