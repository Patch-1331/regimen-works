import type {
  ChecklistExercise,
  Settings,
  SkillLevel,
  PrescribedMovement,
  SessionMovement,
  TodayPlan,
  TodayResponse,
  Wod,
  WodMovement,
  WorkoutLogListItem,
  WorkoutSession,
  MovementVolume,
  SetupOptions,
  SetupProgram,
  WorkoutSetLog,
  CompletedProgram,
  MovementChange,
} from "@regimen-works/shared";
import { DEFAULT_PLAN_ID } from "@regimen-works/shared";
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
      movementGroup: "push_horizontal",
      sortOrder: 2,
      fallbackExerciseId: null,
      ...overrides.exercise,
    },
  };
}

/**
 * One movement of a prescribed day (DN-125) — the resolved shape the athlete
 * is handed, not the authored one. `id` is a PlanSlotMovement's.
 */
export function prescribedMovement(
  // `exercise` partial rather than whole, because the body below spreads it
  // over a complete default: a spec that wants a hold in seconds should not
  // have to restate the group, the position and the kit to say so.
  overrides: Partial<Omit<PrescribedMovement, "exercise">> & {
    exercise?: Partial<PrescribedMovement["exercise"]>;
  } = {},
): PrescribedMovement {
  return {
    id: "plan-slot-movement-1",
    order: 0,
    sets: 5,
    reps: 3,
    repsMax: null,
    toFailure: false,
    restSeconds: 90,
    movementGroup: "pull",
    isSwapped: false,
    prescribedName: null,
    prescribedId: null,
    prescribedReason: null,
    ...overrides,
    exercise: {
      id: "exercise-chin-up",
      name: "Chin-up",
      pattern: "pull",
      equipment: [],
      unit: "reps",
      instructions: null,
      movementGroup: "pull",
      sortOrder: 1,
      fallbackExerciseId: null,
      ...overrides.exercise,
    },
  };
}

/**
 * One movement as a session snapshotted it (DN-90) — here, the prescribed
 * kind: it joins back to a PlanSlotMovement rather than a WodMovement, and
 * carries the sets and rest a straight-sets day is run from (DN-20). `reps` is
 * one set's count, not the day's total.
 */
export function sessionMovement(
  overrides: Partial<Omit<SessionMovement, "exercise">> & {
    exercise?: Partial<SessionMovement["exercise"]>;
  } = {},
): SessionMovement {
  return {
    wodMovementId: null,
    planSlotMovementId: "plan-slot-movement-1",
    sets: 5,
    restSeconds: 90,
    order: 0,
    reps: 3,
    repsMax: null,
    toFailure: false,
    repScheme: [],
    isSwapped: false,
    prescribedName: null,
    prescribedReason: null,
    ...overrides,
    exercise: {
      id: "exercise-chin-up",
      name: "Chin-up",
      unit: "reps",
      movementGroup: "pull",
      sortOrder: 1,
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

export function session(
  overrides: Partial<WorkoutSession> = {},
): WorkoutSession {
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
    setsCompleted: null,
    restStartedAtSeconds: null,
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

/** One set as the runner recorded it (DN-21): the first set of the first movement, as prescribed. */
export function workoutSetLog(
  overrides: Partial<WorkoutSetLog> = {},
): WorkoutSetLog {
  return {
    id: "set-log-1",
    movementOrder: 0,
    setNumber: 1,
    exerciseId: "exercise-1",
    prescribedReps: 3,
    prescribedRepsMax: null,
    prescribedToFailure: false,
    actualReps: 3,
    ...overrides,
  };
}

export function checklistItem(
  overrides: Partial<ChecklistExercise> = {},
): ChecklistExercise {
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
      // A WOD day. `prescribing()` in the prescribed specs builds the other
      // kind, which carries a prescription and no WOD.
      prescription: null,
      session: null,
    },
    warmupCooldownEnabled: true,
    warmup: [checklistItem()],
    cooldown: [checklistItem({ id: "checklist-2", name: "Hamstring stretch" })],
    // Not on a program. Overridden by the tests that are (DN-10).
    plan: null,
    // No program has just ended, which is almost always true (DN-18).
    completedProgram: null,
    // No makeup offered: a training day has a session already (DN-17).
    makeup: null,
    ...overrides,
  };
}

/**
 * A program the athlete just finished (DN-18), as the card and the Completed
 * list both read it.
 *
 * One movement change by default, because a card with nothing to say about the
 * group is the exception rather than the shape most specs want -- pass
 * `{ movementChanges: [] }` through `summary` for the program nobody trained.
 */
export function completedProgram(
  overrides: Partial<CompletedProgram> = {},
): CompletedProgram {
  return {
    enrollmentId: "enrollment-done-1",
    planId: "plan-1",
    planName: "Pull-Up Builder",
    completedAt: "2026-09-15T09:00:00.000Z",
    ...overrides,
    summary: {
      weeks: 6,
      sessions: 24,
      movementChanges: [movementChange()],
      ...overrides.summary,
    },
  };
}

export function movementChange(
  overrides: Partial<MovementChange> = {},
): MovementChange {
  return {
    movementGroup: "pull",
    fromExerciseId: "ex-negative-chin-up",
    fromName: "Negative chin-up",
    toExerciseId: "ex-chin-up",
    toName: "Chin-up",
    ...overrides,
  };
}

/** A rest day: today is not one of the athlete's training days, so there is no assignment at all. */
export function restDay(): TodayResponse {
  return today({
    isRestDay: true,
    assignment: null,
    warmup: null,
    cooldown: null,
  });
}

/**
 * The program block for an athlete part-way through a real program (DN-16).
 *
 * Deliberately not Just WODs: that plan is the absence of programming, and
 * every screen that reads this block treats it as "no program to name".
 */
export function todayPlan(overrides: Partial<TodayPlan> = {}): TodayPlan {
  return {
    enrollmentId: "enrollment-1",
    planId: "plan-pull-up-builder",
    name: "Pull-Up Builder",
    week: 2,
    totalWeeks: 6,
    weekLabel: null,
    slotKind: "wod_generated",
    ...overrides,
  };
}

export function workoutLog(
  overrides: Partial<WorkoutLogListItem> = {},
): WorkoutLogListItem {
  return {
    id: "log-1",
    assignmentId: ASSIGNMENT_ID,
    date: "2026-09-16",
    name: "Fran",
    wod: { type: "for_time", dominantPattern: "push" },
    resultType: "time_seconds",
    resultValue: "305",
    rpe: 8,
    notes: null,
    ...overrides,
  };
}

/**
 * A finished prescribed day, as History reads it back (DN-126).
 *
 * Its own fixture rather than an override list, because the interesting thing
 * about this row is the combination — a name, no `wod`, and a result counted
 * in sets — and spelling that out at each call site invites two of the three.
 */
export function strengthLog(
  overrides: Partial<WorkoutLogListItem> = {},
): WorkoutLogListItem {
  return {
    id: "log-strength-1",
    assignmentId: ASSIGNMENT_ID,
    date: "2026-09-16",
    name: "Strength",
    wod: null,
    resultType: "sets_completed",
    resultValue: "6/8",
    rpe: 7,
    notes: null,
    ...overrides,
  };
}

export function skillLevel(overrides: Partial<SkillLevel> = {}): SkillLevel {
  return {
    id: "skill-level-1",
    movementGroup: "push_horizontal",
    exerciseId: "exercise-1",
    exerciseName: "Push-up",
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
    movementGroup: "push_horizontal",
    sortOrder: 2,
    instructions: null,
    fallbackExerciseId: null,
    phase: null,
    ownerId: null,
    archivedAt: null,
    fallbackExercise: null,
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
    // No program is driving this athlete's week, which is the ordinary case:
    // Just WODs is flexible, so it defers to the days above (DN-118).
    scheduleLock: null,
    // Nothing to pace: Just WODs has no straight sets (DN-143).
    restPace: null,
    ...overrides,
  };
}

/**
 * Just WODs, as the first-run picker shows it (DN-15): flexible, open-ended,
 * and the program every athlete is already on.
 */
export function setupProgram(
  overrides: Partial<SetupProgram> = {},
): SetupProgram {
  return {
    id: DEFAULT_PLAN_ID,
    name: "Just WODs",
    summary: "A workout a day, picked for you.",
    goal: null,
    scheduleNote: null,
    scheduleMode: "flexible",
    minDaysPerWeek: 1,
    maxDaysPerWeek: 7,
    defaultDays: [1, 2, 3, 4, 5],
    minWeeks: null,
    maxWeeks: null,
    defaultWeeks: null,
    fixedDays: [],
    // Just WODs has no rest between sets, so the wizard asks nothing about it.
    hasStraightSets: false,
    restPaceRequired: false,
    ...overrides,
  };
}

/**
 * A program with both a length and day bounds worth bumping into -- the
 * shape the cadence and length screens have anything to say about.
 */
export function boundedProgram(
  overrides: Partial<SetupProgram> = {},
): SetupProgram {
  return setupProgram({
    id: "plan-pull-up-builder",
    name: "Pull-Up Builder",
    summary: "Your first chin-up, six weeks.",
    goal: "Your first unassisted chin-up",
    minDaysPerWeek: 3,
    maxDaysPerWeek: 5,
    defaultDays: [1, 3, 5],
    minWeeks: 4,
    maxWeeks: 8,
    defaultWeeks: 6,
    // Straight sets, every rest stated: the pace is on offer, not asked for.
    hasStraightSets: true,
    ...overrides,
  });
}

/** A program whose slots are its schedule: no day picker, a readout instead. */
export function fixedProgram(
  overrides: Partial<SetupProgram> = {},
): SetupProgram {
  return setupProgram({
    id: "plan-bar-muscle-up",
    name: "Bar Muscle-Up",
    summary: "Four days a week, spaced on purpose.",
    goal: "A bar muscle-up",
    scheduleNote:
      "Two heavy pull days, 48 hours apart. The gap is what makes the second one heavy.",
    scheduleMode: "fixed",
    minDaysPerWeek: null,
    maxDaysPerWeek: null,
    defaultDays: [],
    minWeeks: 6,
    maxWeeks: 6,
    defaultWeeks: 6,
    fixedDays: [1, 2, 4, 5],
    hasStraightSets: true,
    ...overrides,
  });
}

/**
 * The wizard's questions. TODAY is a Wednesday, and nothing has been trained
 * on it -- the case where the athlete may start this morning.
 */
export function setupOptions(
  overrides: Partial<SetupOptions> = {},
): SetupOptions {
  return {
    programs: [setupProgram(), boundedProgram(), fixedProgram()],
    trainingDays: [1, 2, 3, 4, 5],
    earliestStartDate: "2026-09-16",
    latestStartDate: "2026-10-06",
    lastRestSeconds: null,
    ...overrides,
  };
}

/** One movement's recorded volume (DN-22), newest session first. */
export function movementVolume(
  overrides: Partial<MovementVolume> = {},
): MovementVolume {
  return {
    exerciseId: "exercise-1",
    name: "Chin-up",
    unit: "reps",
    sessions: [
      { date: "2026-09-16", assignmentId: "assignment-1", sets: [3, 3, 3] },
    ],
    ...overrides,
  };
}
