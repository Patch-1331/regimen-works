import type {
  AthleteChecklistEntry,
  ChecklistExercise,
  Equipment,
  Muscle,
  Settings,
  SkillLevel,
  PrescribedMovement,
  PrescribedSet,
  SwapOption,
  SessionMovement,
  TodayProgram,
  TodayResponse,
  Wod,
  WodMovement,
  WorkoutLogListItem,
  WorkoutSession,
  MovementVolume,
  MovementHistory,
  MovementHistoryDay,
  MovementHistorySet,
  SetupOptions,
  SetupProgram,
  WorkoutSetLog,
  CompletedProgram,
  MovementChange,
  ProgramRun,
} from "@regimen-works/shared";
import { DEFAULT_PROGRAM_ID } from "@regimen-works/shared";
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
      instructions: ["Hands under the shoulders, body in one line."],
      movementGroup: "push_horizontal",
      fallbackExerciseId: null,
      primaryMuscles: ["chest"],
      ...overrides.exercise,
    },
  };
}

/**
 * `count` alike sets for a prescribed movement or a session snapshot: 5 × 3,
 * rest 90s unless told otherwise. An RPT line is a hand-written list.
 */
export function prescribedSets(
  count: number,
  set: Partial<PrescribedSet> = {},
): PrescribedSet[] {
  return Array.from({ length: count }, () => ({
    reps: 3,
    repsMax: null,
    toFailure: false,
    loadStepPercent: null,
    restSeconds: 90,
    ...set,
  }));
}

/**
 * One movement of a prescribed day (DN-125) — the resolved shape the athlete
 * is handed, not the authored one. `id` is a ProgramSlotMovement's.
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
    id: "program-slot-movement-1",
    order: 0,
    sets: prescribedSets(5),
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
      instructions: [],
      movementGroup: "pull",
      fallbackExerciseId: null,
      primaryMuscles: ["lats"],
      ...overrides.exercise,
    },
  };
}

/**
 * One movement as a session snapshotted it (DN-90) — here, the prescribed
 * kind: it joins back to a ProgramSlotMovement rather than a WodMovement, and
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
    programSlotMovementId: "program-slot-movement-1",
    sets: 5,
    prescribedSets: null,
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
 * ownership columns. Global, live and admin-authored (no seed key, DN-151)
 * unless a test says otherwise.
 */
export function apiWod(overrides: Partial<ApiWod> = {}): ApiWod {
  return { ...wod(), ownerId: null, key: null, archivedAt: null, ...overrides };
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
    instructions: [],
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
    program: null,
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
    programId: "program-1",
    programName: "Pull-Up Builder",
    completedAt: "2026-09-15T09:00:00.000Z",
    canRunAgain: true,
    ...overrides,
    summary: {
      weeks: 6,
      sessions: 24,
      movementChanges: [movementChange()],
      ...overrides.summary,
    },
  };
}

/**
 * A run as the Programs tab lists it (DN-179): Foundations, under way and in
 * its third week of six. A past run says so through `status` and
 * `finishedAt`.
 */
export function programRun(overrides: Partial<ProgramRun> = {}): ProgramRun {
  return {
    enrollmentId: "enrollment-1",
    programId: "program-foundations",
    programName: "Foundations",
    programSummary: "Six weeks of the basics.",
    status: "active",
    startDate: "2026-09-01",
    totalWeeks: 6,
    week: 3,
    finishedAt: null,
    ...overrides,
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
 * Deliberately not Just WODs: that program is the absence of programming, and
 * every screen that reads this block treats it as "no program to name".
 */
export function todayProgram(overrides: Partial<TodayProgram> = {}): TodayProgram {
  return {
    enrollmentId: "enrollment-1",
    programId: "program-pull-up-builder",
    name: "Pull-Up Builder",
    week: 2,
    totalWeeks: 6,
    weekLabel: null,
    dayLabel: null,
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

/** One set of a past straight-sets day (DN-191): fixed, no load step. */
export function movementHistorySet(
  overrides: Partial<MovementHistorySet> = {},
): MovementHistorySet {
  return { reps: 5, repsMax: null, toFailure: false, loadStepPercent: null, ...overrides };
}

/** One past day of a movement: a WOD's whole count, with no sets. */
export function movementHistoryDay(
  overrides: Partial<MovementHistoryDay> = {},
): MovementHistoryDay {
  return {
    date: "2026-09-14",
    name: "Cindy",
    reps: 30,
    repsMax: null,
    toFailure: false,
    sets: null,
    isSwapped: false,
    prescribedName: null,
    prescribedReason: null,
    ...overrides,
  };
}

/** Every day one movement was trained -- the default Push-up, on one WOD day. */
export function movementHistory(
  overrides: Partial<MovementHistory> = {},
): MovementHistory {
  const days = overrides.days ?? [movementHistoryDay()];
  return {
    exerciseId: "exercise-1",
    name: "Push-up",
    movementGroup: "push_horizontal",
    unit: "reps",
    sessions: days.length,
    total: 0,
    firstTrained: days.at(-1)!.date,
    lastTrained: days[0].date,
    ...overrides,
    days,
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
    instructions: [],
    fallbackExerciseId: null,
    key: null,
    primaryMuscles: [],
    secondaryMuscles: [],
    force: null,
    mechanic: null,
    level: null,
    category: null,
    ownerId: null,
    archivedAt: null,
    fallbackExercise: null,
    ...overrides,
  };
}

/** One row of the swap panel's options (DN-170). */
export function swapOption(overrides: Partial<SwapOption> = {}): SwapOption {
  return {
    exerciseId: "exercise-1",
    name: "Push-up",
    level: "beginner",
    equipment: [],
    isFallback: false,
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
    id: DEFAULT_PROGRAM_ID,
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
    allowsNoEnd: false,
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
    id: "program-pull-up-builder",
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

/**
 * A program the athlete wrote (DN-145): one repeating week, run for a length
 * or with no end (DN-154).
 */
export function authoredProgram(
  overrides: Partial<SetupProgram> = {},
): SetupProgram {
  return setupProgram({
    id: "program-tom-hardy-split",
    name: "Tom Hardy Split",
    summary: "Monday to Friday.",
    scheduleMode: "fixed",
    minDaysPerWeek: null,
    maxDaysPerWeek: null,
    defaultDays: [],
    minWeeks: 1,
    maxWeeks: 52,
    defaultWeeks: 8,
    allowsNoEnd: true,
    fixedDays: [1, 2, 3, 4, 5],
    hasStraightSets: true,
    ...overrides,
  });
}

/** A program whose slots are its schedule: no day picker, a readout instead. */
export function fixedProgram(
  overrides: Partial<SetupProgram> = {},
): SetupProgram {
  return setupProgram({
    id: "program-bar-muscle-up",
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

/** One of the athlete's own warm-up/cool-down entries (DN-173). */
export function checklistEntry(
  overrides: Partial<AthleteChecklistEntry> = {},
): AthleteChecklistEntry {
  return {
    id: "entry-1",
    kind: "warmup",
    pattern: null,
    sortOrder: 0,
    exercise: { id: "exercise-1", name: "Push-up" },
    ...overrides,
  };
}

/**
 * A library with muscles and kit on record, for the movement picker (DN-194):
 * enough pushes that "press" finds some the kit can do and some it can't, and
 * one exact match -- Barbell Bench Press -- the example kit has no barbell for.
 */
export function pickerLibrary(): ApiExercise[] {
  const e = (
    id: string,
    name: string,
    equipment: Equipment[],
    primaryMuscles: Muscle[],
    secondaryMuscles: Muscle[],
    movementGroup: ApiExercise["movementGroup"] = null,
  ) => apiExercise({ id, name, equipment, primaryMuscles, secondaryMuscles, movementGroup });
  return [
    e("db-bench", "Dumbbell Bench Press", ["dumbbell", "bench"], ["chest"], ["triceps", "shoulders"], "push_horizontal"),
    e("db-floor", "Dumbbell Floor Press", ["dumbbell"], ["chest"], ["triceps"], "push_horizontal"),
    e("band-chest", "Band Chest Press", ["bands"], ["chest"], ["shoulders"], "push_horizontal"),
    e("bb-bench", "Barbell Bench Press", ["barbell", "bench"], ["chest"], ["triceps", "shoulders"], "push_horizontal"),
    e("db-shoulder", "Dumbbell Shoulder Press", ["dumbbell"], ["shoulders"], ["triceps"], "push_vertical"),
    e("push-press", "Push Press", ["barbell"], ["shoulders"], ["triceps", "quadriceps"], "push_vertical"),
    e("pike", "Pike Push-up", [], ["shoulders"], ["triceps"], "push_vertical"),
    e("leg-press", "Leg Press", ["gym_machines"], ["quadriceps"], ["glutes"], "squat"),
    e("goblet", "Goblet Squat", ["dumbbell"], ["quadriceps"], ["glutes"], "squat"),
    e("pull-up", "Pull-up", ["bar"], ["lats"], ["biceps"], "pull"),
    e("db-row", "One-arm Dumbbell Row", ["dumbbell", "bench"], ["lats"], ["biceps", "middle_back"], "pull"),
  ];
}

/** The example athlete's kit in the picker's designs: no barbell, no machines. */
export const PICKER_KIT: Equipment[] = ["bar", "dumbbell", "bench", "bands"];
