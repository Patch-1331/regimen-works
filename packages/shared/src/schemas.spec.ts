import { describe, expect, it } from "vitest";
import { dailyAssignmentSchema } from "./assignment.js";
import { movementPattern, progressionLine, resultType, wodType } from "./enums.js";
import { exerciseSchema, createExerciseSchema } from "./exercise.js";
import { logResultRequestSchema, workoutLogListItemSchema } from "./log.js";
import { proposedRungChangeSchema } from "./rung-change.js";
import { scheduleCapSchema, scheduleRuleSchema } from "./schedule.js";
import { sessionMovementSchema, workoutSessionSchema } from "./session.js";
import { settingsSchema, updateSettingsSchema } from "./settings.js";
import { skillLevelSchema } from "./skill-level.js";
import { setSubstitutionRequestSchema } from "./substitution.js";
import { todayResponseSchema } from "./today.js";
import { wodMovementSchema, wodSchema } from "./wod.js";

/**
 * The schema contract both applications rely on.
 *
 * Weighted towards rejection, deliberately: a payload that parses is proved
 * every time the app runs, while the malformed one is the case nobody
 * exercises by hand. A schema that quietly accepts bad input is a defect in
 * `apps/api` and `apps/web` at once.
 */

function exercise(overrides: Record<string, unknown> = {}) {
  return {
    id: "exercise-1",
    name: "Push-up",
    pattern: "push",
    equipment: [],
    unit: "reps",
    instructions: null,
    line: "push_horizontal",
    rung: 2,
    altExerciseId: null,
    ...overrides,
  };
}

function movement(overrides: Record<string, unknown> = {}) {
  return { id: "wm-1", reps: 45, order: 0, exercise: exercise(), ...overrides };
}

function wod(overrides: Record<string, unknown> = {}) {
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
    description: null,
    movements: [movement()],
    ...overrides,
  };
}

describe("wodMovementSchema", () => {
  it("parses a movement with no ladder", () => {
    const parsed = wodMovementSchema.parse(movement());
    expect(parsed.reps).toBe(45);
  });

  it("defaults the optional fields so a row written before they existed still parses", () => {
    const parsed = wodMovementSchema.parse(movement());
    expect(parsed.repScheme).toEqual([]);
    expect(parsed.isSwapped).toBe(false);
    expect(parsed.prescribedName).toBeNull();
  });

  it("rejects a rep count of zero, which is not a movement", () => {
    expect(wodMovementSchema.safeParse(movement({ reps: 0 })).success).toBe(false);
  });

  it("rejects a fractional rep count", () => {
    expect(wodMovementSchema.safeParse(movement({ reps: 10.5 })).success).toBe(false);
  });

  it("rejects a negative order", () => {
    expect(wodMovementSchema.safeParse(movement({ order: -1 })).success).toBe(false);
  });
});

describe("wodMovementSchema's repScheme refinement", () => {
  // Mirrors the CHECK constraint on WodMovement. A scheme that doesn't sum to
  // `reps` has the screen counting one workout while the record credits
  // another, so neither layer may accept it.
  it("accepts a ladder that sums to the total", () => {
    expect(wodMovementSchema.safeParse(movement({ reps: 45, repScheme: [21, 15, 9] })).success).toBe(true);
  });

  it("rejects a ladder that sums to less than the total", () => {
    const result = wodMovementSchema.safeParse(movement({ reps: 45, repScheme: [21, 15] }));
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(["repScheme"]);
    expect(result.error?.issues[0].message).toBe("repScheme must sum to reps");
  });

  it("rejects a ladder that sums to more than the total", () => {
    expect(wodMovementSchema.safeParse(movement({ reps: 45, repScheme: [21, 15, 9, 9] })).success).toBe(false);
  });

  it("lets an empty scheme through — it means the movement is flat, not that it sums to nothing", () => {
    expect(wodMovementSchema.safeParse(movement({ reps: 45, repScheme: [] })).success).toBe(true);
  });

  it("rejects a zero rung in the ladder", () => {
    expect(wodMovementSchema.safeParse(movement({ reps: 45, repScheme: [21, 15, 9, 0] })).success).toBe(false);
  });
});

describe("wodSchema's matching-scheme-lengths refinement", () => {
  // A ladder is one shape for the whole WOD: 21-15-9 of push-ups and jump
  // squats is three rounds for both. Different lengths leave no single answer
  // to "what round is this?".
  const ladder = (id: string, reps: number, repScheme: number[]) => movement({ id, reps, repScheme });

  it("accepts two movements on the same ladder", () => {
    const parsed = wodSchema.safeParse(
      wod({ movements: [ladder("a", 45, [21, 15, 9]), ladder("b", 45, [21, 15, 9])] }),
    );
    expect(parsed.success).toBe(true);
  });

  it("accepts different rep counts on schemes of the same length", () => {
    expect(
      wodSchema.safeParse(wod({ movements: [ladder("a", 45, [21, 15, 9]), ladder("b", 90, [42, 30, 18])] }))
        .success,
    ).toBe(true);
  });

  it("rejects schemes of differing lengths in one WOD", () => {
    const result = wodSchema.safeParse(
      wod({ movements: [ladder("a", 45, [21, 15, 9]), ladder("b", 36, [21, 15])] }),
    );
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(["movements"]);
    expect(result.error?.issues[0].message).toBe("every repScheme in a WOD must have the same length");
  });

  it("lets a laddered movement sit beside a flat one", () => {
    // The flat movement has no scheme to disagree about — it is every round.
    expect(
      wodSchema.safeParse(wod({ movements: [ladder("a", 45, [21, 15, 9]), ladder("b", 30, [])] })).success,
    ).toBe(true);
  });
});

describe("wodSchema", () => {
  it("parses a WOD with no movements at all", () => {
    // Empty is structurally valid; whether it is useful is not the schema's call.
    expect(wodSchema.safeParse(wod({ movements: [] })).success).toBe(true);
  });

  it("rejects an unknown WOD type", () => {
    expect(wodSchema.safeParse(wod({ type: "chipper" })).success).toBe(false);
  });

  it("rejects a zero time cap", () => {
    expect(wodSchema.safeParse(wod({ timeCapMinutes: 0 })).success).toBe(false);
  });

  it("accepts null rounds, which an AMRAP has none of", () => {
    expect(wodSchema.safeParse(wod({ rounds: null })).success).toBe(true);
  });

  it("rejects zero rounds, which is not the same as none", () => {
    expect(wodSchema.safeParse(wod({ rounds: 0 })).success).toBe(false);
  });
});

describe("sessionMovementSchema", () => {
  const sessionMovement = (overrides: Record<string, unknown> = {}) => ({
    wodMovementId: "wm-1",
    order: 0,
    reps: 45,
    repScheme: [21, 15, 9],
    isSwapped: false,
    exercise: { id: "e-1", name: "Push-up", unit: "reps", line: "push_horizontal", rung: 2 },
    ...overrides,
  });

  it("defaults prescribedName to null so a session snapshotted before the field existed still parses", () => {
    // Those sessions predate it and there is no honest way to fill it in after
    // the fact — parsing them must not fail.
    expect(sessionMovementSchema.parse(sessionMovement()).prescribedName).toBeNull();
  });

  it("keeps a prescribedName when the athlete's standing choice replaced one", () => {
    expect(sessionMovementSchema.parse(sessionMovement({ prescribedName: "Ring row" })).prescribedName).toBe(
      "Ring row",
    );
  });

  it("requires the join back to the template", () => {
    const { wodMovementId: _omitted, ...withoutId } = sessionMovement();
    expect(sessionMovementSchema.safeParse(withoutId).success).toBe(false);
  });
});

describe("workoutSessionSchema", () => {
  const session = (overrides: Record<string, unknown> = {}) => ({
    id: "session-1",
    assignmentId: "assignment-1",
    startedAt: "2026-09-16T10:00:00.000Z",
    capSeconds: 720,
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
  });

  it("parses a session in progress", () => {
    expect(workoutSessionSchema.safeParse(session()).success).toBe(true);
  });

  it("rejects a startedAt that is a date without a time", () => {
    expect(workoutSessionSchema.safeParse(session({ startedAt: "2026-09-16" })).success).toBe(false);
  });

  it("rejects an unknown session status", () => {
    expect(workoutSessionSchema.safeParse(session({ status: "paused" })).success).toBe(false);
  });

  it("accepts a zero finish time, which is a real elapsed value", () => {
    expect(workoutSessionSchema.safeParse(session({ finishedAtSeconds: 0 })).success).toBe(true);
  });

  it("accepts intervalIndex 0, the first interval rather than an absent one", () => {
    expect(workoutSessionSchema.safeParse(session({ intervalIndex: 0 })).success).toBe(true);
  });

  it("rejects a round split at a negative time", () => {
    expect(
      workoutSessionSchema.safeParse(session({ roundSplits: [{ round: 1, atSeconds: -1 }] })).success,
    ).toBe(false);
  });

  it("rejects a round numbered zero", () => {
    expect(
      workoutSessionSchema.safeParse(session({ roundSplits: [{ round: 0, atSeconds: 10 }] })).success,
    ).toBe(false);
  });
});

describe("logResultRequestSchema", () => {
  it("parses a result with only the two required fields", () => {
    expect(logResultRequestSchema.safeParse({ resultType: "time_seconds", resultValue: "305" }).success).toBe(
      true,
    );
  });

  it("rejects an empty result value — the whole point of the request", () => {
    expect(logResultRequestSchema.safeParse({ resultType: "time_seconds", resultValue: "" }).success).toBe(
      false,
    );
  });

  it.each([0, 11, 5.5])("rejects an RPE of %s, which is off the 1-10 scale", (rpe) => {
    expect(
      logResultRequestSchema.safeParse({ resultType: "rounds_reps", resultValue: "5+3", rpe }).success,
    ).toBe(false);
  });

  it.each([1, 10])("accepts an RPE of %s, at the edge of the scale", (rpe) => {
    expect(
      logResultRequestSchema.safeParse({ resultType: "rounds_reps", resultValue: "5+3", rpe }).success,
    ).toBe(true);
  });

  it("accepts a null RPE, which is 'not asked' rather than a score", () => {
    expect(
      logResultRequestSchema.safeParse({ resultType: "rounds_reps", resultValue: "5+3", rpe: null }).success,
    ).toBe(true);
  });
});

describe("workoutLogListItemSchema", () => {
  const listItem = (overrides: Record<string, unknown> = {}) => ({
    id: "log-1",
    assignmentId: "assignment-1",
    date: "2026-09-16",
    wodName: "Fran",
    wodType: "for_time",
    dominantPattern: "push",
    resultType: "time_seconds",
    resultValue: "305",
    rpe: null,
    notes: null,
    ...overrides,
  });

  it("parses a History row", () => {
    expect(workoutLogListItemSchema.safeParse(listItem()).success).toBe(true);
  });

  it("rejects an unknown movement pattern", () => {
    expect(workoutLogListItemSchema.safeParse(listItem({ dominantPattern: "grip" })).success).toBe(false);
  });

  it("rejects an unknown result type", () => {
    expect(workoutLogListItemSchema.safeParse(listItem({ resultType: "calories" })).success).toBe(false);
  });
});

describe("settingsSchema", () => {
  it("requires both toggles", () => {
    expect(settingsSchema.safeParse({ warmupCooldownEnabled: true }).success).toBe(false);
  });

  it("rejects a string standing in for a boolean", () => {
    expect(
      settingsSchema.safeParse({ warmupCooldownEnabled: "true", autoStopAtCapEnabled: true }).success,
    ).toBe(false);
  });

  it("lets a PATCH carry one toggle, so two switches never restate each other", () => {
    // A stale tab echoing what it last read must not flip the other one back.
    expect(updateSettingsSchema.safeParse({ autoStopAtCapEnabled: false }).success).toBe(true);
  });

  it("lets a PATCH carry nothing at all", () => {
    expect(updateSettingsSchema.safeParse({}).success).toBe(true);
  });
});

describe("skillLevelSchema", () => {
  const level = (overrides: Record<string, unknown> = {}) => ({
    id: "sl-1",
    line: "core_hold",
    rung: 0,
    updatedAt: "2026-09-16T10:00:00.000Z",
    ...overrides,
  });

  it("accepts rung 0, the first movement on a line rather than an absent choice", () => {
    expect(skillLevelSchema.safeParse(level()).success).toBe(true);
  });

  it("rejects a negative rung", () => {
    expect(skillLevelSchema.safeParse(level({ rung: -1 })).success).toBe(false);
  });

  it("rejects a line that is not one of the eight", () => {
    // push/pull are patterns; the lines are finer-grained than that.
    expect(skillLevelSchema.safeParse(level({ line: "push" })).success).toBe(false);
  });
});

describe("scheduleRuleSchema", () => {
  const rule = (overrides: Record<string, unknown> = {}) => ({
    id: "rule-1",
    maxDaysPerWeek: 5,
    patternCooldownDays: 2,
    ...overrides,
  });

  it.each([1, 7])("accepts a cap of %s days, at the edge of a week", (maxDaysPerWeek) => {
    expect(scheduleRuleSchema.safeParse(rule({ maxDaysPerWeek })).success).toBe(true);
  });

  it.each([0, 8])("rejects a cap of %s days, which is not a week", (maxDaysPerWeek) => {
    expect(scheduleRuleSchema.safeParse(rule({ maxDaysPerWeek })).success).toBe(false);
  });

  it("accepts a zero pattern cooldown, which means no cooldown", () => {
    expect(scheduleRuleSchema.safeParse(rule({ patternCooldownDays: 0 })).success).toBe(true);
  });

  it("takes the cap on its own for callers that need nothing else", () => {
    expect(scheduleCapSchema.safeParse({ maxDaysPerWeek: 5 }).success).toBe(true);
  });
});

describe("dailyAssignmentSchema", () => {
  const assignment = (overrides: Record<string, unknown> = {}) => ({
    id: "assignment-1",
    date: "2026-09-16",
    wodId: "wod-1",
    status: "scheduled",
    ...overrides,
  });

  it("parses a calendar date", () => {
    expect(dailyAssignmentSchema.safeParse(assignment()).success).toBe(true);
  });

  it("rejects a full timestamp where a calendar date belongs", () => {
    expect(dailyAssignmentSchema.safeParse(assignment({ date: "2026-09-16T10:00:00.000Z" })).success).toBe(
      false,
    );
  });

  it("rejects a date that does not exist", () => {
    expect(dailyAssignmentSchema.safeParse(assignment({ date: "2026-02-30" })).success).toBe(false);
  });

  it("rejects an unknown assignment status", () => {
    expect(dailyAssignmentSchema.safeParse(assignment({ status: "pending" })).success).toBe(false);
  });
});

describe("exerciseSchema", () => {
  const libraryExercise = (overrides: Record<string, unknown> = {}) => ({
    id: "e-1",
    name: "Push-up",
    pattern: "push",
    equipment: [],
    scalable: true,
    unit: "reps",
    instructions: null,
    line: "push_horizontal",
    rung: 2,
    altExerciseId: null,
    phase: null,
    ...overrides,
  });

  it("parses a library exercise", () => {
    expect(exerciseSchema.safeParse(libraryExercise()).success).toBe(true);
  });

  it("accepts a null pattern, which warm-up filler has", () => {
    expect(exerciseSchema.safeParse(libraryExercise({ pattern: null, phase: "warmup" })).success).toBe(true);
  });

  it("accepts an off-ladder exercise with no line or rung", () => {
    // Cardio is not on a progression ladder.
    expect(exerciseSchema.safeParse(libraryExercise({ line: null, rung: null })).success).toBe(true);
  });

  it("rejects a unit that is neither reps nor seconds", () => {
    expect(exerciseSchema.safeParse(libraryExercise({ unit: "metres" })).success).toBe(false);
  });

  it("accepts a movement tagged with what it needs", () => {
    expect(exerciseSchema.safeParse(libraryExercise({ equipment: ["bar"] })).success).toBe(true);
  });

  it("rejects a tag outside the equipment catalog", () => {
    // The column is a bare String[] -- this schema is the only thing standing
    // between a typo in the seed and a tag no ownership check will ever match.
    expect(exerciseSchema.safeParse(libraryExercise({ equipment: ["barbell"] })).success).toBe(false);
  });

  it("drops the id for a create payload", () => {
    const { id: _omitted, ...withoutId } = libraryExercise();
    expect(createExerciseSchema.safeParse(withoutId).success).toBe(true);
  });
});

describe("setSubstitutionRequestSchema", () => {
  it("parses a swap keyed by the movement row, not the exercise", () => {
    // A WOD naming the same line twice must move only the row that was tapped.
    expect(setSubstitutionRequestSchema.safeParse({ wodMovementId: "wm-1", exerciseId: "e-2" }).success).toBe(
      true,
    );
  });

  it("rejects an empty movement id rather than swapping nothing", () => {
    expect(setSubstitutionRequestSchema.safeParse({ wodMovementId: "", exerciseId: "e-2" }).success).toBe(
      false,
    );
  });

  it("rejects an empty exercise id", () => {
    expect(setSubstitutionRequestSchema.safeParse({ wodMovementId: "wm-1", exerciseId: "" }).success).toBe(
      false,
    );
  });
});

describe("proposedRungChangeSchema", () => {
  const proposal = (overrides: Record<string, unknown> = {}) => ({
    line: "pull",
    fromRung: 1,
    toRung: 3,
    exerciseId: "e-9",
    exerciseName: "Chin-up",
    ...overrides,
  });

  it("accepts a null fromRung — 'no default yet' is a proposal like any other", () => {
    // The ordinary case for a first swap, since DN-86 stopped provisioning a
    // rung for everyone.
    expect(proposedRungChangeSchema.safeParse(proposal({ fromRung: null })).success).toBe(true);
  });

  it("requires a destination rung", () => {
    expect(proposedRungChangeSchema.safeParse(proposal({ toRung: null })).success).toBe(false);
  });
});

describe("todayResponseSchema", () => {
  const todayPayload = (overrides: Record<string, unknown> = {}) => ({
    date: "2026-09-16",
    isRestDay: false,
    assignment: { id: "a-1", date: "2026-09-16", status: "scheduled", wod: wod(), session: null },
    warmupCooldownEnabled: true,
    warmup: [{ id: "c-1", name: "Arm circles", instructions: null }],
    cooldown: [],
    ...overrides,
  });

  it("parses a day with an assignment", () => {
    expect(todayResponseSchema.safeParse(todayPayload()).success).toBe(true);
  });

  it("parses a rest day, where the assignment and both checklists are null", () => {
    expect(
      todayResponseSchema.safeParse(
        todayPayload({ isRestDay: true, assignment: null, warmup: null, cooldown: null }),
      ).success,
    ).toBe(true);
  });

  it("rejects a malformed WOD nested inside it", () => {
    // The refinements have to survive nesting, or the API's outermost
    // response is the one place they stop applying.
    const badWod = wod({ movements: [movement({ reps: 45, repScheme: [21, 15] })] });
    expect(
      todayResponseSchema.safeParse(
        todayPayload({ assignment: { id: "a-1", date: "2026-09-16", status: "scheduled", wod: badWod, session: null } }),
      ).success,
    ).toBe(false);
  });
});

describe("enums", () => {
  it.each([
    ["movementPattern", movementPattern, "push", "grip"],
    ["progressionLine", progressionLine, "core_hold", "core"],
    ["wodType", wodType, "amrap", "chipper"],
    ["resultType", resultType, "total_reps", "calories"],
  ])("%s accepts its members and rejects anything else", (_name, schema, valid, invalid) => {
    expect(schema.safeParse(valid).success).toBe(true);
    expect(schema.safeParse(invalid).success).toBe(false);
  });

  it("keeps progressionLine finer-grained than movementPattern", () => {
    // "core" is a pattern; the ladders under it are core_dynamic/hold/side.
    expect(movementPattern.safeParse("core").success).toBe(true);
    expect(progressionLine.safeParse("core").success).toBe(false);
    expect(progressionLine.safeParse("core_dynamic").success).toBe(true);
  });
});
