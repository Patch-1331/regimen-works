import type {
  AdvanceInterval,
  CreateExercise,
  UpdateExercise,
  LogResultRequest,
  Me,
  MovementHistory,
  RoundSplit,
  ScheduleCap,
  SetRoundSplitRequest,
  SetSkillLevelRequest,
  ProposedRungChange,
  SetSubstitutionRequest,
  Settings,
  SkillLevel,
  TodayResponse,
  UpdateSettings,
  CreateWod,
  UpdateWod,
  Wod,
  WorkoutLog,
  WorkoutLogListItem,
  WorkoutSession,
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
 * written against `pattern: string` and a nested `altExercise`; adopting the
 * shared type wholesale is a refactor of that logic, not of this type. What
 * changed for DN-28 is that the fields the shared schema grew — `ownerId`,
 * `archivedAt`, `instructions`, `phase`, `altExerciseId` — stopped being
 * missing here, because the library page needs all five.
 */
export type ApiExercise = {
  id: string;
  name: string;
  pattern: string;
  equipment: string[];
  scalable: boolean;
  unit: "reps" | "seconds";
  instructions: string | null;
  line: string | null;
  rung: number | null;
  altExerciseId: string | null;
  phase: string | null;
  /** Null for global library content, set for the reading athlete's own. */
  ownerId: string | null;
  /** When it was retired, or null while it is live. */
  archivedAt: string | null;
  altExercise: { id: string; name: string } | null;
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

/**
 * A WOD as `GET /wods` returns it (DN-29).
 *
 * The shared `Wod` unchanged, plus the two columns the read schema does not
 * declare because no screen but the editor has any use for them. Extended
 * rather than restated — unlike `ApiExercise`, nothing in the web app reads a
 * WOD through a looser shape, so there is no divergence to preserve.
 */
export type ApiWod = Wod & {
  /** Null for global library content, set for the reading athlete's own. */
  ownerId: string | null;
  /** When it was retired, or null while it is live. */
  archivedAt: string | null;
};

export const api = {
  exercises: () => request<ApiExercise[]>("/exercises"),

  /**
   * The same list with retired movements in it, for the library page (DN-28).
   *
   * A separate method rather than an argument on `exercises()`, so a pool
   * cannot acquire retired movements by someone passing a flag through.
   */
  libraryExercises: () =>
    request<ApiExercise[]>("/exercises?includeArchived=true"),
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

  proposedRungChanges: (assignmentId: string) =>
    request<ProposedRungChange[]>(
      `/assignments/${assignmentId}/substitutions/rung-changes`,
    ),
  setSubstitution: (assignmentId: string, body: SetSubstitutionRequest) =>
    postJson<void>(`/assignments/${assignmentId}/substitutions`, body),
  clearSubstitution: (assignmentId: string, wodMovementId: string) =>
    request<void>(
      `/assignments/${assignmentId}/substitutions/${wodMovementId}`,
      { method: "DELETE" },
    ),

  saveLog: (assignmentId: string, body: LogResultRequest) =>
    postJson<WorkoutLog>(`/assignments/${assignmentId}/log`, body),
  getLog: (assignmentId: string) =>
    requestOptional<WorkoutLog>(`/assignments/${assignmentId}/log`),
  logs: () => request<WorkoutLogListItem[]>("/logs"),
  /** What has actually been trained, movement by movement (DN-89). */
  movementHistory: () => request<MovementHistory[]>("/movement-history"),

  skillLevels: () => request<SkillLevel[]>("/skill-levels"),
  setSkillLevel: (line: string, body: SetSkillLevelRequest) =>
    patchJson<SkillLevel>(`/skill-levels/${line}`, body),

  /**
   * Who the API thinks the caller is (DN-92). Read for `isAdmin`, which says
   * whether to render an admin surface at all — never as the access check
   * itself, which the API makes on its own for every admin route.
   */
  me: () => request<Me>("/me"),

  settings: () => request<Settings>("/settings"),
  updateSettings: (body: UpdateSettings) =>
    patchJson<Settings>("/settings", body),
};
