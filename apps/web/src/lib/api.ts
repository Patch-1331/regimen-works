import type {
  AdvanceInterval,
  AthleteChecklistEntry,
  CreateChecklistEntry,
  ReorderChecklistEntries,
  ExerciseCategory,
  ExerciseForce,
  ExerciseLevel,
  ExerciseMechanic,
  Muscle,
  CreateExercise,
  ExerciseSearchPage,
  EditSetLogs,
  UpdateExercise,
  LogResultRequest,
  LogSet,
  CommitSetup,
  CompletedProgram,
  ProgramRuns,
  Me,
  MovementHistory,
  MovementVolume,
  RestPace,
  RoundSplit,
  ScheduleCap,
  SetRoundSplitRequest,
  SetSkillLevelRequest,
  ProposedMovementChange,
  SetSubstitutionRequest,
  SwapOptionsQuery,
  SwapOptionsResponse,
  Settings,
  UpdateRestPace,
  SetupOptions,
  SkillLevel,
  TodayResponse,
  UpdateSettings,
  CreateWod,
  UpdateWod,
  Wod,
  WorkoutLog,
  WorkoutLogListItem,
  WorkoutSession,
  WorkoutSetLog,
  CreateProgram,
  EditableProgram,
  GlobalProgramSummary,
  ProgramArchiveResult,
  ProgramSaveResult,
  ProgramExport,
  ProgramSummary,
} from "@regimen-works/shared";

// Defaults to the "/api" prefix that vite.config.ts proxies to the local API,
// stripping the prefix on the way. There is no proxy in a deployed build, so
// production sets this to the API's own origin — and the API serves its routes
// at the root, which is why the deployed value carries no path.
const API_BASE =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) || "/api";

// Set once by ApiAuthBridge, which has access to Clerk's hooks. Calling this
// per request (rather than caching a token here) lets Clerk hand back a fresh
// one as the short-lived session token rotates.
type TokenGetter = () => Promise<string | null>;
let getToken: TokenGetter = () => Promise.resolve(null);

export function setTokenGetter(fn: TokenGetter): void {
  getToken = fn;
}

/**
 * A request the API refused, carrying what it said.
 *
 * The library write endpoints refuse for reasons an author can act on — a
 * name already taken, a fallback that needs equipment of its own — and those
 * sentences are written to be read. Thrown as a bare status, they would reach
 * the screen as "400 Bad Request" and the author would be left guessing which
 * of eight fields it meant.
 */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/**
 * What the API said went wrong, or null if it did not say.
 *
 * Nest sends a string for the exceptions raised with one message and an array
 * for a validation failure with several, so both shapes are read here rather
 * than at each call site.
 */
function messageFrom(body: string): string | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { message } = parsed as { message?: unknown };
    if (typeof message === "string") return message;
    if (Array.isArray(message))
      return message.filter((m) => typeof m === "string").join("; ") || null;
    return null;
  } catch {
    // A proxy error page, a gateway timeout — anything not from the API.
    return null;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const token = await getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    const said = messageFrom(await res.text().catch(() => ""));
    throw new ApiError(
      res.status,
      said ?? `${res.status} ${res.statusText} for ${path}`,
    );
  }
  // Endpoints that model "absent" as an empty response (a log or session that
  // doesn't exist yet) send no body at all, so don't hand that to JSON.parse.
  const text = await res.text();
  if (text === "") return undefined as T;
  return JSON.parse(text) as T;
}

/**
 * GET for a resource the API reports as absent with `204 No Content`. Resolves
 * to `null` rather than `undefined`, which React Query rejects as query data.
 */
async function requestOptional<T>(path: string): Promise<T | null> {
  return (await request<T | null>(path)) ?? null;
}

function postJson<T>(path: string, body?: unknown) {
  return request<T>(path, {
    method: "POST",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function putJson<T>(path: string, body: unknown) {
  return request<T>(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function patchJson<T>(path: string, body: unknown) {
  return request<T>(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * An exercise as `GET /exercises` returns it: every field of the shared
 * `Exercise` shape, plus the alternative resolved into an object by the
 * endpoint's own `include`.
 *
 * The fields are restated rather than spread from `Exercise` because the
 * swap and progression logic (`lib/swapOptions.ts`, `lib/progressions.ts`) is
 * written against `pattern: string` and a nested `fallbackExercise`; adopting the
 * shared type wholesale is a refactor of that logic, not of this type. What
 * changed for DN-28 is that the fields the shared schema grew — `ownerId`,
 * `archivedAt`, `instructions`, `fallbackExerciseId` — stopped being missing
 * here, because the library page needs all four. DN-165 added the
 * dataset's description of the exercise the same way: the swap panel (DN-170)
 * and the library page (DN-171) both read it.
 */
export type ApiExercise = {
  id: string;
  name: string;
  pattern: string;
  equipment: string[];
  scalable: boolean;
  unit: "reps" | "seconds";
  /** Numbered steps; empty where the exercise has no written copy. */
  instructions: string[];
  movementGroup: string | null;
  fallbackExerciseId: string | null;
  /** The dataset's id for a global exercise; always null on the athlete's own. */
  key: string | null;
  primaryMuscles: Muscle[];
  secondaryMuscles: Muscle[];
  force: ExerciseForce | null;
  mechanic: ExerciseMechanic | null;
  /** How demanding the exercise is — never a statement about the athlete. */
  level: ExerciseLevel | null;
  category: ExerciseCategory | null;
  /** Null for global library content, set for the reading athlete's own. */
  ownerId: string | null;
  /** When it was retired, or null while it is live. */
  archivedAt: string | null;
  fallbackExercise: { id: string; name: string } | null;
};

/**
 * Which half of the library a write is aimed at (DN-93).
 *
 * The API decides the tier from the route, so the client's only job is to
 * call the right one — `/admin/exercises` writes global content and is
 * refused to anyone who is not an admin, `/exercises` writes the caller's
 * own. Naming it here rather than passing paths around keeps the two from
 * being confused at a call site.
 */
export type LibraryTier = "own" | "global";

const exercisesBase = (tier: LibraryTier) =>
  tier === "global" ? "/admin/exercises" : "/exercises";

const wodsBase = (tier: LibraryTier) =>
  tier === "global" ? "/admin/wods" : "/wods";

const programsBase = (tier: LibraryTier) =>
  tier === "global" ? "/admin/programs" : "/programs";

const programPath = (tier: LibraryTier, id: string) =>
  `${programsBase(tier)}/${encodeURIComponent(id)}`;

/**
 * A WOD as `GET /wods` returns it (DN-29).
 *
 * The shared `Wod` unchanged, plus the columns the read schema does not
 * declare because no screen but the editor has any use for them. Extended
 * rather than restated — unlike `ApiExercise`, nothing in the web app reads a
 * WOD through a looser shape, so there is no divergence to preserve.
 */
export type ApiWod = Wod & {
  /** Null for global library content, set for the reading athlete's own. */
  ownerId: string | null;
  /**
   * Set on a WOD seeded from `wod-seed.ts`, null on any other (DN-151). The
   * deploy owns a row that carries one, so the library shows it read-only.
   */
  key: string | null;
  /** When it was retired, or null while it is live. */
  archivedAt: string | null;
};

export const api = {
  exercises: () => request<ApiExercise[]>("/exercises"),

  /**
   * The same list with retired movements in it, for the WOD editor's
   * movement picker (DN-28).
   *
   * A separate method rather than an argument on `exercises()`, so a pool
   * cannot acquire retired movements by someone passing a flag through.
   */
  libraryExercises: () =>
    request<ApiExercise[]>("/exercises?includeArchived=true"),
  /**
   * One page of the library page's search (DN-171). `query` is built by
   * `searchQuery` in lib/libraryFilters.ts.
   */
  searchExercises: (query: string) =>
    request<ExerciseSearchPage<ApiExercise>>(`/exercises/search?${query}`),
  /**
   * The retired movements, for the library page to offer back (DN-28,
   * DN-171). Its own endpoint rather than a flag on the search, so no pool
   * can acquire retired movements by someone passing a flag through.
   */
  retiredExercises: () => request<ApiExercise[]>("/exercises/retired"),
  /** One movement, for the library's detail view (DN-171). */
  exercise: (id: string) =>
    request<ApiExercise>(`/exercises/${encodeURIComponent(id)}`),
  /**
   * A movement's alternatives away from any day (DN-185): the swap panel's
   * sections, for the program editor's swap control.
   */
  exerciseAlternatives: (id: string) =>
    request<SwapOptionsResponse>(`/exercises/${encodeURIComponent(id)}/alternatives`),
  /** The athlete's own warm-up and cool-down entries, each list in its set order (DN-173). */
  checklistEntries: () => request<AthleteChecklistEntry[]>("/checklist-entries"),
  addChecklistEntry: (body: CreateChecklistEntry) =>
    postJson<AthleteChecklistEntry>("/checklist-entries", body),
  removeChecklistEntry: (id: string) =>
    request<void>(`/checklist-entries/${encodeURIComponent(id)}`, { method: "DELETE" }),
  /** Every one of the athlete's entries of `kind`, in the new order. */
  reorderChecklistEntries: (body: ReorderChecklistEntries) =>
    putJson<AthleteChecklistEntry[]>("/checklist-entries/order", body),
  createExercise: (tier: LibraryTier, body: CreateExercise) =>
    postJson<ApiExercise>(exercisesBase(tier), body),
  updateExercise: (tier: LibraryTier, id: string, body: UpdateExercise) =>
    patchJson<ApiExercise>(`${exercisesBase(tier)}/${id}`, body),
  archiveExercise: (tier: LibraryTier, id: string) =>
    postJson<ApiExercise>(`${exercisesBase(tier)}/${id}/archive`),
  unarchiveExercise: (tier: LibraryTier, id: string) =>
    postJson<ApiExercise>(`${exercisesBase(tier)}/${id}/unarchive`),
  /**
   * Every WOD the editor may show, retired ones included (DN-29).
   *
   * A separate method rather than an argument, for the reason
   * `libraryExercises` is one: the pool a day is planned from must not be
   * able to acquire retired workouts by someone passing a flag through.
   */
  libraryWods: () => request<ApiWod[]>("/wods?includeArchived=true"),
  createWod: (tier: LibraryTier, body: CreateWod) =>
    postJson<ApiWod>(wodsBase(tier), body),
  updateWod: (tier: LibraryTier, id: string, body: UpdateWod) =>
    patchJson<ApiWod>(`${wodsBase(tier)}/${id}`, body),
  archiveWod: (tier: LibraryTier, id: string) =>
    postJson<ApiWod>(`${wodsBase(tier)}/${id}/archive`),
  unarchiveWod: (tier: LibraryTier, id: string) =>
    postJson<ApiWod>(`${wodsBase(tier)}/${id}/unarchive`),

  today: () => request<TodayResponse>("/today"),
  scheduleRule: () => request<ScheduleCap>("/schedule-rule"),
  skipToday: () => postJson<TodayResponse>("/today/skip"),
  /** Take the makeup offer: train on a rest day while the week is short (DN-17). */
  trainMakeup: () => postJson<TodayResponse>("/today/makeup"),

  startSession: (assignmentId: string) =>
    postJson<WorkoutSession>(`/assignments/${assignmentId}/session`),
  getSession: (assignmentId: string) =>
    requestOptional<WorkoutSession>(`/assignments/${assignmentId}/session`),
  logRound: (assignmentId: string, round: RoundSplit) =>
    postJson<WorkoutSession>(
      `/assignments/${assignmentId}/session/rounds`,
      round,
    ),
  /** Posted on every completed set, so a refresh resumes where it was (DN-20). */
  logSet: (assignmentId: string, body: LogSet) =>
    postJson<WorkoutSession>(`/assignments/${assignmentId}/session/sets`, body),
  /** The sets the runner recorded, read by the log screen (DN-21). */
  setLogs: (assignmentId: string) =>
    request<WorkoutSetLog[]>(`/assignments/${assignmentId}/session/sets`),
  /** Corrections to sets already recorded. Never creates one. */
  editSetLogs: (assignmentId: string, body: EditSetLogs) =>
    patchJson<WorkoutSetLog[]>(
      `/assignments/${assignmentId}/session/sets`,
      body,
    ),
  advanceInterval: (assignmentId: string, body: AdvanceInterval) =>
    postJson<WorkoutSession>(
      `/assignments/${assignmentId}/session/interval`,
      body,
    ),
  finishSession: (assignmentId: string) =>
    postJson<WorkoutSession>(`/assignments/${assignmentId}/session/finish`),
  completeWarmup: (assignmentId: string) =>
    postJson<WorkoutSession>(
      `/assignments/${assignmentId}/session/warmup-complete`,
    ),
  completeCooldown: (assignmentId: string) =>
    postJson<WorkoutSession>(
      `/assignments/${assignmentId}/session/cooldown-complete`,
    ),
  cancelSession: (assignmentId: string) =>
    request<void>(`/assignments/${assignmentId}/session`, { method: "DELETE" }),
  setRoundSplit: (assignmentId: string, body: SetRoundSplitRequest) =>
    postJson<WorkoutSession>(
      `/assignments/${assignmentId}/session/split`,
      body,
    ),

  proposedMovementChanges: (assignmentId: string) =>
    request<ProposedMovementChange[]>(
      `/assignments/${assignmentId}/substitutions/movement-changes`,
    ),
  /**
   * The swap panel's options for one movement (DN-170), read when the panel
   * opens. Exactly one of the two ids, the same either-or a swap names.
   */
  swapOptions: (assignmentId: string, key: SwapOptionsQuery) => {
    const query = key.wodMovementId
      ? `wodMovementId=${encodeURIComponent(key.wodMovementId)}`
      : `programSlotMovementId=${encodeURIComponent(key.programSlotMovementId ?? "")}`;
    return request<SwapOptionsResponse>(
      `/assignments/${assignmentId}/substitutions/options?${query}`,
    );
  },
  setSubstitution: (assignmentId: string, body: SetSubstitutionRequest) =>
    postJson<void>(`/assignments/${assignmentId}/substitutions`, body),
  clearSubstitution: (assignmentId: string, wodMovementId: string) =>
    request<void>(
      `/assignments/${assignmentId}/substitutions/${wodMovementId}`,
      { method: "DELETE" },
    ),
  /**
   * Undoing a swap on a prescribed day (DN-125). Its own path rather than the
   * one above, because a bare id in the URL cannot say which kind of movement
   * it is — see the controller.
   */
  clearPrescribedSubstitution: (
    assignmentId: string,
    programSlotMovementId: string,
  ) =>
    request<void>(
      `/assignments/${assignmentId}/substitutions/prescribed/${programSlotMovementId}`,
      { method: "DELETE" },
    ),

  saveLog: (assignmentId: string, body: LogResultRequest) =>
    postJson<WorkoutLog>(`/assignments/${assignmentId}/log`, body),
  getLog: (assignmentId: string) =>
    requestOptional<WorkoutLog>(`/assignments/${assignmentId}/log`),
  logs: () => request<WorkoutLogListItem[]>("/logs"),
  /** What has actually been trained, movement by movement (DN-89). */
  movementHistory: () => request<MovementHistory[]>("/movement-history"),
  /** What each movement has actually been trained at, set by set (DN-22). */
  movementVolume: () => request<MovementVolume[]>("/movement-volume"),

  skillLevels: () => request<SkillLevel[]>("/skill-levels"),
  setSkillLevel: (movementGroup: string, body: SetSkillLevelRequest) =>
    patchJson<SkillLevel>(`/skill-levels/${movementGroup}`, body),

  /**
   * Who the API thinks the caller is (DN-92). Read for `isAdmin`, which says
   * whether to render an admin surface at all — never as the access check
   * itself, which the API makes on its own for every admin route.
   */
  me: () => request<Me>("/me"),

  /**
   * What the first-run wizard asks (DN-15) — the programs, the athlete's
   * current days, and the dates they may start on.
   *
   * One call rather than three, because the wizard is the first screen an
   * athlete ever sees and every question depends on the answer before it: the
   * day picker is bounded by the program, and the date grid starts where the
   * API says it may.
   */
  setup: () => request<SetupOptions>("/setup"),
  /**
   * The three answers, committed together. Returns when the athlete
   * onboarded, which is the field the route guard reads — so the client can
   * write it straight into the `me` cache rather than refetching to find out
   * whether it is allowed to leave the screen it is on.
   */
  commitSetup: (body: CommitSetup) =>
    postJson<{ onboardedAt: string }>("/setup", body),

  /**
   * The Programs tab's runs (DN-179): the one under way, if any, and every
   * one finished or ended, newest first. Just WODs is never a past run.
   */
  programRuns: () => request<ProgramRuns>("/programs/runs"),
  /** The programs this athlete wrote (DN-145), live first, archived marked. */
  programs: () => request<ProgramSummary[]>("/programs"),
  /**
   * The global library as an admin manages it (DN-148): live and archived,
   * Just WODs first and marked built in. Refused to anyone else.
   */
  globalPrograms: () => request<GlobalProgramSummary[]>("/admin/programs"),
  /**
   * The global programs any athlete may copy into their own (DN-149): live
   * ones only, Just WODs aside.
   */
  copyablePrograms: () => request<ProgramSummary[]>("/programs/library"),
  /** One of those, as the editor prefills a copy from it. */
  copyableProgram: (id: string) =>
    request<CreateProgram>(`/programs/library/${encodeURIComponent(id)}`),
  /** The tier is the route's, never the body's: `global` is admin-only. */
  createProgram: (tier: LibraryTier, body: CreateProgram) =>
    postJson<ProgramSummary>(programsBase(tier), body),
  /** A program as the editor loads it (DN-146). */
  program: (tier: LibraryTier, id: string) =>
    request<EditableProgram>(programPath(tier, id)),
  /**
   * Saves the whole program. `forked` in the result means the edit became a
   * new program under a new id, because someone had already started this one.
   */
  updateProgram: (tier: LibraryTier, id: string, body: CreateProgram) =>
    putJson<ProgramSaveResult>(programPath(tier, id), body),
  /**
   * "Remove" (DN-147): archives, never deletes. `running` in the result means
   * the caller's own run is on it and carries on to its end.
   */
  archiveProgram: (tier: LibraryTier, id: string) =>
    postJson<ProgramArchiveResult>(`${programPath(tier, id)}/archive`),
  /** Refused with the editor's "name taken" if a live program holds the name. */
  restoreProgram: (tier: LibraryTier, id: string) =>
    postJson<ProgramSummary>(`${programPath(tier, id)}/unarchive`),
  /**
   * Publishes one of the admin's own programs to everyone (DN-148), in place
   * and for good: there is no way back to personal.
   */
  /**
   * The ticked global programs as one export file (DN-150). Admin-only; a
   * POST because the ticks are its body, though it changes nothing.
   */
  exportPrograms: (ids: string[]) =>
    postJson<ProgramExport>("/admin/programs/export", { ids }),
  promoteProgram: (id: string) =>
    postJson<ProgramSummary>(`${programPath("global", id)}/promote`),

  /**
   * Every program the athlete has finished (DN-18), most recent first.
   *
   * The completion *card* is not fetched here -- it rides on `GET /today`, so
   * a finished program and the day that follows it arrive together. This is
   * the list on History, which is a different question asked at a different
   * time.
   */
  completedPrograms: () => request<CompletedProgram[]>("/programs/completed"),
  /** Puts the completion card away. Idempotent. */
  dismissCompletedProgram: (enrollmentId: string) =>
    postJson<{ dismissed: true }>(`/programs/${enrollmentId}/dismiss`),
  /** Starts the same program over: same program, same length, from today. */
  runProgramAgain: (enrollmentId: string) =>
    postJson<{ enrollmentId: string }>(`/programs/${enrollmentId}/run-again`),

  /**
   * Changes the rest pace of the program being run (DN-143). Its own route
   * rather than a Settings field: it belongs to the run, and ends with it.
   */
  updateRestPace: (body: UpdateRestPace) =>
    patchJson<RestPace>("/programs/active/rest", body),

  settings: () => request<Settings>("/settings"),
  updateSettings: (body: UpdateSettings) =>
    patchJson<Settings>("/settings", body),
};
