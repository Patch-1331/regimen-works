import type {
  AdvanceInterval,
  LogResultRequest,
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const token = await getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} for ${path}`);
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

export type ApiExercise = {
  id: string;
  name: string;
  pattern: string;
  equipment: string[];
  scalable: boolean;
  unit: "reps" | "seconds";
  line: string | null;
  rung: number | null;
  altExercise: { id: string; name: string } | null;
};

export const api = {
  exercises: () => request<ApiExercise[]>("/exercises"),
  today: () => request<TodayResponse>("/today"),
  scheduleRule: () => request<ScheduleCap>("/schedule-rule"),
  skipToday: () => postJson<TodayResponse>("/today/skip"),

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

  skillLevels: () => request<SkillLevel[]>("/skill-levels"),
  setSkillLevel: (line: string, body: SetSkillLevelRequest) =>
    patchJson<SkillLevel>(`/skill-levels/${line}`, body),

  settings: () => request<Settings>("/settings"),
  updateSettings: (body: UpdateSettings) =>
    patchJson<Settings>("/settings", body),
};
