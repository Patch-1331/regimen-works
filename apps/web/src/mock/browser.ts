import { setupWorker } from "msw/browser";
import { delay, http, HttpResponse } from "msw";
import { addIsoDays, type ProgramSummary, type SwapOption } from "@regimen-works/shared";
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

// The workout library, so a row has movements to open onto: the default
// Fran-shaped ladder, and a flat chipper on movements `pushFamily` holds.
const libraryWods = [
  fixtures.apiWod({ id: "wod-fran", name: "Fran" }),
  fixtures.apiWod({
    id: "wod-chipper",
    name: "Push Chipper",
    type: "amrap",
    timeCapMinutes: 15,
    description: "As many rounds as possible.",
    movements: [
      fixtures.movement({ id: "wm-1", order: 0, reps: 10, repScheme: [] }),
      fixtures.movement({
        id: "wm-2",
        order: 1,
        reps: 30,
        repScheme: [],
        exercise: {
          ...fixtures.movement().exercise,
          id: "exercise-plank",
          name: "High plank hold",
          unit: "seconds",
        },
      }),
    ],
  }),
];

const yours: ProgramSummary = {
  id: "program-pull-days",
  name: "Pull days",
  summary: "Your own program, three days a week.",
  scheduleMode: "flexible",
  days: [1, 3, 5],
  archived: false,
};

// The athlete's own warm-up and cool-down (DN-173), so Settings has lists to
// order and the default movement page (Push-up) shows an entry of its own.
const ownChecklistEntries = [
  fixtures.checklistEntry({ id: "entry-1", kind: "warmup", pattern: "push", sortOrder: 0 }),
  fixtures.checklistEntry({
    id: "entry-2",
    kind: "warmup",
    pattern: null,
    sortOrder: 1,
    exercise: { id: "exercise-band", name: "Band pull-apart" },
  }),
  fixtures.checklistEntry({
    id: "entry-3",
    kind: "cooldown",
    pattern: null,
    sortOrder: 0,
    exercise: { id: "exercise-pigeon", name: "Pigeon stretch" },
  }),
];

// A push family around the default Push-up (DN-185), so a program line naming
// it has alternatives to show: easier, harder, a hold, and one needing kit.
const pushFamily = [
  fixtures.apiExercise({ id: "exercise-knee", name: "Knee push-up" }),
  fixtures.apiExercise({ id: "exercise-archer", name: "Archer push-up", level: "expert" }),
  fixtures.apiExercise({ id: "exercise-plank", name: "High plank hold", unit: "seconds", movementGroup: null }),
  fixtures.apiExercise({ id: "exercise-ring", name: "Ring push-up", equipment: ["suspension_trainer"] }),
];
const asOption = (e: (typeof pushFamily)[number]) =>
  fixtures.swapOption({ exerciseId: e.id, name: e.name, equipment: e.equipment as SwapOption["equipment"] });

// A strength day mixing per-set lines with a uniform one (ADR 0011): RPT,
// a drop set and a plain 3 × 8. Served by `/today` when the page's URL has
// `?mock=strength`; `&set=N` serves it mid-session, N sets done, so the
// runner can be looked at on any set.
const rpt = [
  { reps: 6, repsMax: 8, toFailure: false, loadStepPercent: null, restSeconds: 180 },
  { reps: 8, repsMax: 10, toFailure: false, loadStepPercent: -10, restSeconds: 180 },
  { reps: 10, repsMax: 12, toFailure: false, loadStepPercent: -10, restSeconds: 180 },
];
const drop = [
  { reps: null, repsMax: null, toFailure: true, loadStepPercent: null, restSeconds: 0 },
  { reps: null, repsMax: null, toFailure: true, loadStepPercent: -20, restSeconds: 0 },
  { reps: null, repsMax: null, toFailure: true, loadStepPercent: -20, restSeconds: 90 },
];
const strengthDay = [
  fixtures.prescribedMovement({ sets: rpt }),
  fixtures.prescribedMovement({
    id: "program-slot-movement-2",
    order: 1,
    sets: drop,
    movementGroup: "push_horizontal",
    exercise: { id: "exercise-push-up", name: "Push-up", movementGroup: "push_horizontal" },
  }),
  fixtures.prescribedMovement({
    id: "program-slot-movement-3",
    order: 2,
    sets: fixtures.prescribedSets(3, { reps: 8, restSeconds: 60 }),
    movementGroup: "squat",
    exercise: { id: "exercise-squat", name: "Air squat", movementGroup: "squat" },
  }),
];

function strengthToday(setsDone: number | null) {
  const day = fixtures.today();
  return {
    ...day,
    assignment: {
      ...day.assignment!,
      wod: null,
      prescription: { movements: strengthDay },
      status: setsDone === null ? "scheduled" : "in_progress",
      session:
        setsDone === null
          ? null
          : fixtures.session({
              capSeconds: null,
              autoStopAtCap: false,
              setsCompleted: setsDone,
              restStartedAtSeconds: null,
              movements: strengthDay.map((m) =>
                fixtures.sessionMovement({
                  programSlotMovementId: m.id,
                  order: m.order,
                  sets: m.sets.length,
                  reps: m.sets[0].reps,
                  repsMax: m.sets[0].repsMax,
                  toFailure: m.sets[0].toFailure,
                  restSeconds: m.sets[0].restSeconds,
                  prescribedSets: m.sets,
                  exercise: m.exercise,
                }),
              ),
            }),
    },
  };
}

// The default movement page's history (DN-192): a reverse-pyramid day, a
// uniform one and a WOD, newest first, so its PRESCRIBED section has all three
// shapes to show.
const pushUpHistory = fixtures.movementHistory({
  days: [
    fixtures.movementHistoryDay({
      date: "2026-10-20",
      name: "Strength",
      reps: 6,
      repsMax: 8,
      sets: [
        fixtures.movementHistorySet({ reps: 6, repsMax: 8 }),
        fixtures.movementHistorySet({ reps: 8, repsMax: 10, loadStepPercent: -10 }),
        fixtures.movementHistorySet({ reps: 10, repsMax: 12, loadStepPercent: -10 }),
      ],
    }),
    fixtures.movementHistoryDay({
      date: "2026-10-13",
      name: "Strength",
      reps: 5,
      sets: Array.from({ length: 5 }, () => fixtures.movementHistorySet()),
    }),
    fixtures.movementHistoryDay({ date: "2026-09-14", name: "Cindy", reps: 30 }),
  ],
});

// Today before the program's start date (DN-200), served by `/today` when the
// page's URL has `?mock=not-started`: Foundations, starting two days from now.
// Starting it today answers with day one, which the next read forgets.
function notStartedToday() {
  const today = localIsoDate();
  const startDate = addIsoDays(today, 2);
  return fixtures.today({
    date: today,
    isRestDay: true,
    assignment: null,
    warmup: null,
    cooldown: null,
    program: fixtures.notStartedProgram({
      startDate,
      firstSession: { ...fixtures.notStartedProgram().firstSession!, date: startDate },
    }),
  });
}

const extras = [
  // `?mock=finding` holds `/me` open, to look at the loading screen that
  // stands in while the gate decides where to land (DN-197).
  http.get(api("/me"), async () => {
    if (new URLSearchParams(window.location.search).get("mock") === "finding") {
      await delay("infinite");
    }
  }),
  http.get(api("/today"), () => {
    const page = new URLSearchParams(window.location.search);
    if (page.get("mock") === "not-started") return HttpResponse.json(notStartedToday());
    if (page.get("mock") !== "strength") return;
    const set = page.get("set");
    return HttpResponse.json(strengthToday(set === null ? null : Number(set)));
  }),
  http.post(api("/today/start-program"), () =>
    HttpResponse.json(
      fixtures.today({
        date: localIsoDate(),
        program: fixtures.todayProgram({ name: "Foundations", week: 1, totalWeeks: 6 }),
      }),
    ),
  ),
  // The active library only; retired rows fall through to the default.
  http.get(api("/wods"), () => HttpResponse.json(libraryWods)),
  // Doing one today (DN-201) answers with today as that workout. Stateless
  // like the rest: the next read of /today is the default day again.
  http.post(api("/today/choose"), async ({ request }) => {
    const { wodId } = (await request.json()) as { wodId: string };
    const chosen = libraryWods.find((w) => w.id === wodId);
    if (!chosen)
      return HttpResponse.json(
        { message: "There is no such workout to choose." },
        { status: 404 },
      );
    const day = fixtures.today({ date: localIsoDate() });
    return HttpResponse.json({
      ...day,
      assignment: {
        ...day.assignment!,
        wod: fixtures.wod({ id: chosen.id, name: chosen.name }),
      },
    });
  }),
  http.get(api("/exercises"), ({ request }) => {
    if (new URL(request.url).searchParams.get("includeArchived") === "true") return;
    return HttpResponse.json([fixtures.apiExercise(), ...pushFamily, ...fixtures.pickerLibrary()]);
  }),
  // The movement picker's example kit (DN-194): no barbell, no machines, so
  // "press" finds some to fold away and "barbell bench press" has an answer.
  http.get(api("/settings"), () =>
    HttpResponse.json(fixtures.settings({ equipment: fixtures.PICKER_KIT })),
  ),
  // "You use these most", when the picker opens.
  http.get(api("/movement-volume"), () =>
    HttpResponse.json(
      ["db-bench", "goblet", "pull-up", "db-row"].map((exerciseId, i) =>
        fixtures.movementVolume({
          exerciseId,
          name: fixtures.pickerLibrary().find((e) => e.id === exerciseId)!.name,
          sessions: Array.from({ length: 6 - i }, (_, d) => ({
            date: addIsoDays("2026-10-01", d * 2),
            assignmentId: `${exerciseId}-${d}`,
            sets: [8, 8, 8],
          })),
        }),
      ),
    ),
  ),
  http.get(api("/exercises/:id/alternatives"), () =>
    HttpResponse.json({
      main: [asOption(pushFamily[0]), asOption(pushFamily[2])],
      harder: [asOption(pushFamily[1])],
      needsEquipment: [asOption(pushFamily[3])],
    }),
  ),
  http.get(api("/movement-history"), () => HttpResponse.json([pushUpHistory])),
  http.get(api("/checklist-entries"), () => HttpResponse.json(ownChecklistEntries)),
  http.post(api("/checklist-entries"), () =>
    HttpResponse.json(ownChecklistEntries[0], { status: 201 }),
  ),
  http.put(api("/checklist-entries/order"), () => HttpResponse.json(ownChecklistEntries)),
  http.delete(api("/checklist-entries/:id"), () => new HttpResponse(null, { status: 204 })),
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
          // As `ProgramsService.create` stores every authored program: a
          // length within wide bounds, or no end (DN-154).
          minWeeks: 1,
          maxWeeks: 52,
          defaultWeeks: 8,
          allowsNoEnd: true,
          hasStraightSets: true,
        }),
      ],
      earliestStartDate: localIsoDate(),
      latestStartDate: addIsoDays(localIsoDate(), 20),
    });
  }),
  // Settings and the setup wizard's kit (DN-195) both write here. Answered
  // with the patch applied, and forgotten on the next read.
  http.patch(api("/settings"), async ({ request }) =>
    HttpResponse.json({
      ...fixtures.settings(),
      ...((await request.json()) as object),
    }),
  ),
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
