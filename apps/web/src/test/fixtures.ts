import type {
  ChecklistExercise,
  Settings,
  SkillLevel,
  TodayResponse,
  Wod,
  WodMovement,
  WorkoutLogListItem,
  WorkoutSession,
} from "@regimen-works/shared";
import type { ApiExercise, ApiWod } from "../lib/api";

/**
 * Builders for the API payloads the route smoke tests serve through MSW.
 *
 * Each one returns a valid whole, with overrides merged shallowly on top, so a
 * test names only the field it is about. These are deliberately not parsed
 * through the zod schemas: a fixture that drifts from the schema should fail
 * the test that reads it, not every test in the file.
 */

export const ASSIGNMENT_ID = "assignment-1";

export function movement(overrides: Partial<WodMovement> = {}): WodMovement {
  return {
    id: "wod-movement-1",
    reps: 45,
    order: 0,
    repScheme: [21, 15, 9],
    isSwapped: false,
    prescribedName: null,
    prescribedId: null,
    prescribedReason: null,
    ...overrides,
    exercise: {
      id: "exercise-1",
      name: "Push-up",
      pattern: "push",
      equipment: [],
      unit: "reps",
      instructions: "Hands under the shoulders, body in one line.",
      line: "push_horizontal",
      rung: 2,
      altExerciseId: null,
      ...overrides.exercise,
    },
  };
}

export function wod(overrides: Partial<Wod> = {}): Wod {
  return {
    id: "wod-1",
    name: "Fran",
    type: "for_time",
    timeCapMinutes: 12,
    rounds: 3,
    workSeconds: null,
    restSeconds: null,
    intervalCount: null,
    isNamed: true,
    dominantPattern: "push",
    description: "One pass, for time.",
    movements: [movement()],
    ...overrides,
  };
}

/**
 * A WOD as the library editor reads it (DN-29) — the shared shape plus the
 * two ownership columns. Global and live unless a test says otherwise.
 */
export function apiWod(overrides: Partial<ApiWod> = {}): ApiWod {
  return { ...wod(), ownerId: null, archivedAt: null, ...overrides };
}

export function session(overrides: Partial<WorkoutSession> = {}): WorkoutSession {
  return {
    id: "session-1",
    assignmentId: ASSIGNMENT_ID,
    // Relative to now, not a fixed instant: the runners derive their state
    // from `Date.now() - startedAt`, so a pinned timestamp is a session that
    // silently ages past its own time cap. This one was pinned to
    // 2026-09-16T10:00Z and the round-tap tests passed only while that moment
    // was still in the future — at 10:12Z real time crossed the 12-minute cap
    // and both began rendering the finish view instead (DN-111).
    startedAt: new Date(Date.now() - 5_000).toISOString(),
    capSeconds: 12 * 60,
    roundSplits: [],
    movements: [],
    status: "in_progress",
    finishedAtSeconds: null,
    roundSplitCount: null,
    autoStopAtCap: true,
    warmupCompletedAt: null,
    cooldownCompletedAt: null,
    intervalIndex: null,
    intervalStartedAtSeconds: null,
    ...overrides,
  };
}

export function checklistItem(overrides: Partial<ChecklistExercise> = {}): ChecklistExercise {
  return {
    id: "checklist-1",
    name: "Arm circles",
    instructions: null,
    ...overrides,
  };
}

export function today(overrides: Partial<TodayResponse> = {}): TodayResponse {
  return {
    date: "2026-09-16",
    isRestDay: false,
    assignment: {
      id: ASSIGNMENT_ID,
      date: "2026-09-16",
      status: "scheduled",
      wod: wod(),
      session: null,
    },
    warmupCooldownEnabled: true,
    warmup: [checklistItem()],
    cooldown: [checklistItem({ id: "checklist-2", name: "Hamstring stretch" })],
    // Not on a program. Overridden by the tests that are (DN-10).
    plan: null,
    ...overrides,
  };
}

/** A rest day: today is not one of the athlete's training days, so there is no assignment at all. */
export function restDay(): TodayResponse {
  return today({ isRestDay: true, assignment: null, warmup: null, cooldown: null });
}

export function workoutLog(overrides: Partial<WorkoutLogListItem> = {}): WorkoutLogListItem {
  return {
    id: "log-1",
    assignmentId: ASSIGNMENT_ID,
    date: "2026-09-16",
    wodName: "Fran",
    wodType: "for_time",
    dominantPattern: "push",
    resultType: "time_seconds",
    resultValue: "305",
    rpe: 8,
    notes: null,
    ...overrides,
  };
}

export function skillLevel(overrides: Partial<SkillLevel> = {}): SkillLevel {
  return {
    id: "skill-level-1",
    line: "push_horizontal",
    rung: 2,
    updatedAt: "2026-09-16T10:00:00.000Z",
    ...overrides,
  };
}

export function apiExercise(overrides: Partial<ApiExercise> = {}): ApiExercise {
  return {
    id: "exercise-1",
    name: "Push-up",
    pattern: "push",
    equipment: [],
    scalable: true,
    unit: "reps",
    line: "push_horizontal",
    rung: 2,
    instructions: null,
    altExerciseId: null,
    phase: null,
    ownerId: null,
    archivedAt: null,
    altExercise: null,
    ...overrides,
  };
}

export function settings(overrides: Partial<Settings> = {}): Settings {
  return {
    warmupCooldownEnabled: true,
    autoStopAtCapEnabled: true,
    equipment: ["bar"],
    trainingDays: [1, 2, 3, 4, 5],
    patternCooldownDays: 5,
    ...overrides,
  };
}
