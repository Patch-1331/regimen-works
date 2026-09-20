import { describe, expect, it } from "vitest";
import { dailyAssignmentSchema } from "./assignment.js";
import {
  enrollmentStatus,
  movementPattern,
  planPhase,
  planSlotKind,
  progressionLine,
  resultType,
  scheduleMode,
  wodType,
} from "./enums.js";
import { exerciseSchema, createExerciseSchema } from "./exercise.js";
import { movementHistorySchema } from "./history.js";
import { logResultRequestSchema, workoutLogListItemSchema } from "./log.js";
import { proposedRungChangeSchema } from "./rung-change.js";
import {
  patternCooldownDaysSchema,
  scheduleCapSchema,
  scheduleRuleSchema,
  trainingDaysSchema,
} from "./schedule.js";
import { sessionMovementSchema, workoutSessionSchema } from "./session.js";
import {
  scheduleLockSchema,
  settingsSchema,
  updateSettingsSchema,
} from "./settings.js";
import { skillLevelSchema } from "./skill-level.js";
import { setSubstitutionRequestSchema } from "./substitution.js";
import { createWodSchema, updateWodSchema } from "./wod.js";
import { planDetailSchema, planSchema, planSlotSchema } from "./plan.js";
import {
  completedProgramSchema,
  createEnrollmentSchema,
  planEnrollmentSchema,
} from "./plan-enrollment.js";
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
    expect(parsed.prescribedId).toBeNull();
    expect(parsed.prescribedReason).toBeNull();
  });

  it("carries why a movement was replaced, not just what it replaced", () => {
    // The screen says different words for the two (DN-79), so a payload that
    // named the prescription without saying which layer set it would leave
    // the client guessing.
    const parsed = wodMovementSchema.parse(
      movement({ prescribedName: "Pull-up", prescribedReason: "equipment" }),
    );
    expect(parsed.prescribedReason).toBe("equipment");
  });

  it("carries the prescribed movement's id so the client can offer it back", () => {
    // The name is for reading and the id is for tapping (DN-110). A client
    // cannot work the id out for itself: one alternative stands in for
    // several movements, so reading backwards from it is ambiguous.
    const parsed = wodMovementSchema.parse(
      movement({
        prescribedName: "Double-unders",
        prescribedId: "exercise-double-unders",
        prescribedReason: "equipment",
      }),
    );
    expect(parsed.prescribedId).toBe("exercise-double-unders");
  });

  it("rejects a reason outside the two automatic substitutions", () => {
    // The day's own swap is not one of them — it is `isSwapped`, and carries
    // no prescription at all.
    expect(
      wodMovementSchema.safeParse(movement({ prescribedReason: "swapped" }))
        .success,
    ).toBe(false);
  });

  it("rejects a rep count of zero, which is not a movement", () => {
    expect(wodMovementSchema.safeParse(movement({ reps: 0 })).success).toBe(
      false,
    );
  });

  it("rejects a fractional rep count", () => {
    expect(wodMovementSchema.safeParse(movement({ reps: 10.5 })).success).toBe(
      false,
    );
  });

  it("rejects a negative order", () => {
    expect(wodMovementSchema.safeParse(movement({ order: -1 })).success).toBe(
      false,
    );
  });
});

describe("wodMovementSchema's repScheme refinement", () => {
  // Mirrors the CHECK constraint on WodMovement. A scheme that doesn't sum to
  // `reps` has the screen counting one workout while the record credits
  // another, so neither layer may accept it.
  it("accepts a ladder that sums to the total", () => {
    expect(
      wodMovementSchema.safeParse(
        movement({ reps: 45, repScheme: [21, 15, 9] }),
      ).success,
    ).toBe(true);
  });

  it("rejects a ladder that sums to less than the total", () => {
    const result = wodMovementSchema.safeParse(
      movement({ reps: 45, repScheme: [21, 15] }),
    );
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(["repScheme"]);
    expect(result.error?.issues[0].message).toBe("repScheme must sum to reps");
  });

  it("rejects a ladder that sums to more than the total", () => {
    expect(
      wodMovementSchema.safeParse(
        movement({ reps: 45, repScheme: [21, 15, 9, 9] }),
      ).success,
    ).toBe(false);
  });

  it("lets an empty scheme through — it means the movement is flat, not that it sums to nothing", () => {
    expect(
      wodMovementSchema.safeParse(movement({ reps: 45, repScheme: [] }))
        .success,
    ).toBe(true);
  });

  it("rejects a zero rung in the ladder", () => {
    expect(
      wodMovementSchema.safeParse(
        movement({ reps: 45, repScheme: [21, 15, 9, 0] }),
      ).success,
    ).toBe(false);
  });
});

describe("wodSchema's matching-scheme-lengths refinement", () => {
  // A ladder is one shape for the whole WOD: 21-15-9 of push-ups and jump
  // squats is three rounds for both. Different lengths leave no single answer
  // to "what round is this?".
  const ladder = (id: string, reps: number, repScheme: number[]) =>
    movement({ id, reps, repScheme });

  it("accepts two movements on the same ladder", () => {
    const parsed = wodSchema.safeParse(
      wod({
        movements: [ladder("a", 45, [21, 15, 9]), ladder("b", 45, [21, 15, 9])],
      }),
    );
    expect(parsed.success).toBe(true);
  });

  it("accepts different rep counts on schemes of the same length", () => {
    expect(
      wodSchema.safeParse(
        wod({
          movements: [
            ladder("a", 45, [21, 15, 9]),
            ladder("b", 90, [42, 30, 18]),
          ],
        }),
      ).success,
    ).toBe(true);
  });

  it("rejects schemes of differing lengths in one WOD", () => {
    const result = wodSchema.safeParse(
      wod({
        movements: [ladder("a", 45, [21, 15, 9]), ladder("b", 36, [21, 15])],
      }),
    );
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(["movements"]);
    expect(result.error?.issues[0].message).toBe(
      "every repScheme in a WOD must have the same length",
    );
  });

  it("lets a laddered movement sit beside a flat one", () => {
    // The flat movement has no scheme to disagree about — it is every round.
    expect(
      wodSchema.safeParse(
        wod({ movements: [ladder("a", 45, [21, 15, 9]), ladder("b", 30, [])] }),
      ).success,
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
    exercise: {
      id: "e-1",
      name: "Push-up",
      unit: "reps",
      line: "push_horizontal",
      rung: 2,
    },
    ...overrides,
  });

  it("defaults prescribedName to null so a session snapshotted before the field existed still parses", () => {
    // Those sessions predate it and there is no honest way to fill it in after
    // the fact — parsing them must not fail.
    expect(
      sessionMovementSchema.parse(sessionMovement()).prescribedName,
    ).toBeNull();
  });

  it("keeps a prescribedName when the athlete's standing choice replaced one", () => {
    expect(
      sessionMovementSchema.parse(
        sessionMovement({ prescribedName: "Ring row" }),
      ).prescribedName,
    ).toBe("Ring row");
  });

  it("requires the join back to the template", () => {
    const { wodMovementId: _omitted, ...withoutId } = sessionMovement();
    expect(sessionMovementSchema.safeParse(withoutId).success).toBe(false);
  });

  it("takes a prescribed movement's id instead, on a straight-sets day", () => {
    // DN-20: the day was prescribed by a program slot, so there is no
    // WodMovement to point at and the sets and rest are what it carries.
    const { wodMovementId: _omitted, ...prescribed } = sessionMovement();
    const parsed = sessionMovementSchema.parse({
      ...prescribed,
      planSlotMovementId: "plan-slot-movement-1",
      sets: 5,
      restSeconds: 90,
    });

    expect(parsed.wodMovementId).toBeNull();
    expect(parsed.sets).toBe(5);
  });

  it("refuses a row claiming to be both kinds of movement", () => {
    expect(
      sessionMovementSchema.safeParse({
        ...sessionMovement(),
        planSlotMovementId: "plan-slot-movement-1",
      }).success,
    ).toBe(false);
  });

  it("defaults the straight-sets fields to null on a WOD snapshot", () => {
    // Null rather than zero: a WOD movement has rounds, not sets, and a zero
    // would read as a movement nobody was asked to do.
    const parsed = sessionMovementSchema.parse(sessionMovement());

    expect(parsed.sets).toBeNull();
    expect(parsed.restSeconds).toBeNull();
    expect(parsed.planSlotMovementId).toBeNull();
  });
});

describe("workoutSessionSchema", () => {
  const session = (overrides: Record<string, unknown> = {}) => ({
    id: "session-1",
    assignmentId: "assignment-1",
    startedAt: "2026-09-16T10:00:00.000Z",
    capSeconds: 720,
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
  });

  it("parses a session in progress", () => {
    expect(workoutSessionSchema.safeParse(session()).success).toBe(true);
  });

  it("rejects a startedAt that is a date without a time", () => {
    expect(
      workoutSessionSchema.safeParse(session({ startedAt: "2026-09-16" }))
        .success,
    ).toBe(false);
  });

  it("rejects an unknown session status", () => {
    expect(
      workoutSessionSchema.safeParse(session({ status: "paused" })).success,
    ).toBe(false);
  });

  it("accepts a zero finish time, which is a real elapsed value", () => {
    expect(
      workoutSessionSchema.safeParse(session({ finishedAtSeconds: 0 })).success,
    ).toBe(true);
  });

  it("accepts intervalIndex 0, the first interval rather than an absent one", () => {
    expect(
      workoutSessionSchema.safeParse(session({ intervalIndex: 0 })).success,
    ).toBe(true);
  });

  it("parses an untimed session, which is what a prescribed day is", () => {
    // DN-20. Null rather than a zero cap, because a zero cap is one that has
    // already been reached.
    expect(
      workoutSessionSchema.safeParse(
        session({ capSeconds: null, setsCompleted: 0 }),
      ).success,
    ).toBe(true);
  });

  it("accepts setsCompleted 0, a started session with no set behind it yet", () => {
    // Distinct from null, which means this is not a straight-sets session at
    // all — the same distinction intervalIndex 0 carries.
    expect(
      workoutSessionSchema.parse(session({ setsCompleted: 0 })).setsCompleted,
    ).toBe(0);
  });

  it("rejects a cap of zero, which was never a real session", () => {
    expect(workoutSessionSchema.safeParse(session({ capSeconds: 0 })).success).toBe(
      false,
    );
  });

  it("rejects a round split at a negative time", () => {
    expect(
      workoutSessionSchema.safeParse(
        session({ roundSplits: [{ round: 1, atSeconds: -1 }] }),
      ).success,
    ).toBe(false);
  });

  it("rejects a round numbered zero", () => {
    expect(
      workoutSessionSchema.safeParse(
        session({ roundSplits: [{ round: 0, atSeconds: 10 }] }),
      ).success,
    ).toBe(false);
  });
});

describe("logResultRequestSchema", () => {
  it("parses a result with only the two required fields", () => {
    expect(
      logResultRequestSchema.safeParse({
        resultType: "time_seconds",
        resultValue: "305",
      }).success,
    ).toBe(true);
  });

  it("rejects an empty result value — the whole point of the request", () => {
    expect(
      logResultRequestSchema.safeParse({
        resultType: "time_seconds",
        resultValue: "",
      }).success,
    ).toBe(false);
  });

  it.each([0, 11, 5.5])(
    "rejects an RPE of %s, which is off the 1-10 scale",
    (rpe) => {
      expect(
        logResultRequestSchema.safeParse({
          resultType: "rounds_reps",
          resultValue: "5+3",
          rpe,
        }).success,
      ).toBe(false);
    },
  );

  it.each([1, 10])("accepts an RPE of %s, at the edge of the scale", (rpe) => {
    expect(
      logResultRequestSchema.safeParse({
        resultType: "rounds_reps",
        resultValue: "5+3",
        rpe,
      }).success,
    ).toBe(true);
  });

  it("accepts a null RPE, which is 'not asked' rather than a score", () => {
    expect(
      logResultRequestSchema.safeParse({
        resultType: "rounds_reps",
        resultValue: "5+3",
        rpe: null,
      }).success,
    ).toBe(true);
  });
});

describe("workoutLogListItemSchema", () => {
  const listItem = (overrides: Record<string, unknown> = {}) => ({
    id: "log-1",
    assignmentId: "assignment-1",
    date: "2026-09-16",
    name: "Fran",
    wod: { type: "for_time", dominantPattern: "push" },
    resultType: "time_seconds",
    resultValue: "305",
    rpe: null,
    notes: null,
    ...overrides,
  });

  it("parses a History row", () => {
    expect(workoutLogListItemSchema.safeParse(listItem()).success).toBe(true);
  });

  it("parses a prescribed day, which has a name and no WOD", () => {
    expect(
      workoutLogListItemSchema.safeParse(
        listItem({
          name: "Strength",
          wod: null,
          resultType: "sets_completed",
          resultValue: "8/8",
        }),
      ).success,
    ).toBe(true);
  });

  it("requires the WOD block to be present or explicitly absent", () => {
    // Nullable, not optional: a row that simply omits it is a row that forgot
    // to say which kind of day it was, which is the state this shape exists
    // to make unrepresentable.
    const { wod: _wod, ...withoutWod } = listItem();
    expect(workoutLogListItemSchema.safeParse(withoutWod).success).toBe(false);
  });

  it("rejects an unknown movement pattern", () => {
    expect(
      workoutLogListItemSchema.safeParse(
        listItem({ wod: { type: "for_time", dominantPattern: "grip" } }),
      ).success,
    ).toBe(false);
  });

  it("rejects an unknown result type", () => {
    expect(
      workoutLogListItemSchema.safeParse(listItem({ resultType: "calories" }))
        .success,
    ).toBe(false);
  });
});

describe("settingsSchema", () => {
  const settings = (overrides: Record<string, unknown> = {}) => ({
    warmupCooldownEnabled: true,
    autoStopAtCapEnabled: true,
    equipment: ["bar"],
    trainingDays: [1, 2, 3, 4, 5],
    patternCooldownDays: 5,
    scheduleLock: null,
    ...overrides,
  });

  it("requires every field", () => {
    expect(
      settingsSchema.safeParse({ warmupCooldownEnabled: true }).success,
    ).toBe(false);
  });

  it("rejects a string standing in for a boolean", () => {
    expect(
      settingsSchema.safeParse(settings({ warmupCooldownEnabled: "true" }))
        .success,
    ).toBe(false);
  });

  it("lets a PATCH carry one toggle, so two switches never restate each other", () => {
    // A stale tab echoing what it last read must not flip the other one back.
    expect(
      updateSettingsSchema.safeParse({ autoStopAtCapEnabled: false }).success,
    ).toBe(true);
  });

  it("lets a PATCH carry nothing at all", () => {
    expect(updateSettingsSchema.safeParse({}).success).toBe(true);
  });

  it("accepts owning nothing, which is a real answer rather than an omission", () => {
    expect(settingsSchema.safeParse(settings({ equipment: [] })).success).toBe(
      true,
    );
    expect(updateSettingsSchema.safeParse({ equipment: [] }).success).toBe(
      true,
    );
  });

  it("refuses a PATCH that tries to write the schedule lock", () => {
    // Derived from the enrollment on every read, so there is nothing here to
    // write it to. Omitted rather than ignored, so a client that sends it is
    // told no instead of watching it vanish.
    expect(
      updateSettingsSchema.safeParse({
        scheduleLock: { planId: "p", planName: "Pull-Up Builder", days: [1] },
      }).success,
    ).toBe(false);
  });

  it("requires the lock to say which program locked the week", () => {
    // "Locked" without naming the program is not an answer the athlete can
    // act on: ending that program is the action available to them.
    expect(
      scheduleLockSchema.safeParse({ planId: "p", days: [1] }).success,
    ).toBe(false);
  });

  it("accepts a lock with no training days, which a rest week really has", () => {
    // `trainingDaysSchema` refuses an empty set -- an athlete training on no
    // days has no app. A program authoring a week of pure rest has made a
    // coaching decision, and this is how it says so.
    expect(
      scheduleLockSchema.safeParse({
        planId: "p",
        planName: "Deload",
        days: [],
      }).success,
    ).toBe(true);
  });

  it("rejects a piece the catalog does not have", () => {
    // Prisma will not check a String[], so this is what keeps an unknown
    // string out of the column.
    expect(
      settingsSchema.safeParse(settings({ equipment: ["sandbag"] })).success,
    ).toBe(false);
    expect(
      updateSettingsSchema.safeParse({ equipment: ["sandbag"] }).success,
    ).toBe(false);
  });

  it("rejects a bare string where the set belongs", () => {
    expect(
      settingsSchema.safeParse(settings({ equipment: "bar" })).success,
    ).toBe(false);
  });

  it("carries the pattern cooldown, the last ScheduleRule knob to be exposed", () => {
    expect(
      settingsSchema.safeParse(settings({ patternCooldownDays: 0 })).data,
    ).toEqual(expect.objectContaining({ patternCooldownDays: 0 }));
  });

  it("refuses a cooldown the scheduler could not honour", () => {
    expect(
      settingsSchema.safeParse(settings({ patternCooldownDays: 31 })).success,
    ).toBe(false);
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
    expect(skillLevelSchema.safeParse(level({ line: "push" })).success).toBe(
      false,
    );
  });
});

describe("trainingDaysSchema", () => {
  const parse = (days: unknown) => trainingDaysSchema.safeParse(days);

  it.each([[[0]], [[6]], [[0, 1, 2, 3, 4, 5, 6]]])(
    "accepts %j, at the edges of the week",
    (days) => {
      expect(parse(days).success).toBe(true);
    },
  );

  it("sorts what it accepts, so tap order never reaches the database", () => {
    expect(parse([5, 1, 3]).data).toEqual([1, 3, 5]);
  });

  it("refuses an empty week rather than reading it as a break", () => {
    // An athlete who trains on no days has no app, and "I'm taking a week off"
    // is answered by not opening it.
    expect(parse([]).success).toBe(false);
  });

  it("refuses a repeated day rather than collapsing it", () => {
    // [1, 1, 3] is a client that believes it asked for three days. Storing two
    // would leave it right about the request and wrong about the result.
    expect(parse([1, 1, 3]).success).toBe(false);
  });

  it.each([-1, 7, 1.5])("refuses %s, which is not a weekday", (day) => {
    expect(parse([day]).success).toBe(false);
  });
});

describe("patternCooldownDaysSchema", () => {
  const parse = (days: unknown) => patternCooldownDaysSchema.safeParse(days);

  it("accepts 0, which is the rule turned off rather than a missing answer", () => {
    // Against a small library the cooldown relaxes on most days anyway, so an
    // athlete preferring the variety the pool can offer is entitled to say so.
    expect(parse(0).success).toBe(true);
  });

  it("accepts 30, the widest window the scheduler can honour", () => {
    expect(parse(30).success).toBe(true);
  });

  it("refuses 31, which the history query could not see", () => {
    // SchedulerService reads the cooldown's history with `take: 30`. A wider
    // window would be a number stored and then quietly not applied.
    expect(parse(31).success).toBe(false);
  });

  it.each([-1, 2.5])("refuses %s", (value) => {
    expect(parse(value).success).toBe(false);
  });
});

describe("scheduleRuleSchema", () => {
  const rule = (overrides: Record<string, unknown> = {}) => ({
    id: "rule-1",
    trainingDays: [1, 2, 3, 4, 5],
    patternCooldownDays: 2,
    ...overrides,
  });

  it("carries the training days that replaced the quota", () => {
    expect(scheduleRuleSchema.safeParse(rule()).success).toBe(true);
  });

  it("accepts a zero pattern cooldown, which means no cooldown", () => {
    expect(
      scheduleRuleSchema.safeParse(rule({ patternCooldownDays: 0 })).success,
    ).toBe(true);
  });

  it("refuses a cooldown past the ceiling, the same bound settings applies", () => {
    // One schema behind both, so the rule row and the settings endpoint can
    // not disagree about what is storable.
    expect(
      scheduleRuleSchema.safeParse(rule({ patternCooldownDays: 31 })).success,
    ).toBe(false);
  });

  it("takes the day count on its own for callers that need nothing else", () => {
    // Derived from trainingDays.length by the API; the shape is still a count.
    expect(scheduleCapSchema.safeParse({ maxDaysPerWeek: 5 }).success).toBe(
      true,
    );
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
    expect(
      dailyAssignmentSchema.safeParse(
        assignment({ date: "2026-09-16T10:00:00.000Z" }),
      ).success,
    ).toBe(false);
  });

  it("rejects a date that does not exist", () => {
    expect(
      dailyAssignmentSchema.safeParse(assignment({ date: "2026-02-30" }))
        .success,
    ).toBe(false);
  });

  it("rejects an unknown assignment status", () => {
    expect(
      dailyAssignmentSchema.safeParse(assignment({ status: "pending" }))
        .success,
    ).toBe(false);
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
    ownerId: null,
    archivedAt: null,
    ...overrides,
  });

  it("parses a library exercise", () => {
    expect(exerciseSchema.safeParse(libraryExercise()).success).toBe(true);
  });

  it("accepts a null pattern, which warm-up filler has", () => {
    expect(
      exerciseSchema.safeParse(
        libraryExercise({ pattern: null, phase: "warmup" }),
      ).success,
    ).toBe(true);
  });

  it("accepts an off-ladder exercise with no line or rung", () => {
    // Cardio is not on a progression ladder.
    expect(
      exerciseSchema.safeParse(libraryExercise({ line: null, rung: null }))
        .success,
    ).toBe(true);
  });

  it("rejects a unit that is neither reps nor seconds", () => {
    expect(
      exerciseSchema.safeParse(libraryExercise({ unit: "metres" })).success,
    ).toBe(false);
  });

  it("accepts a movement tagged with what it needs", () => {
    expect(
      exerciseSchema.safeParse(libraryExercise({ equipment: ["bar"] })).success,
    ).toBe(true);
  });

  it("carries which tier the row is in and whether it is retired", () => {
    // Both nullable, and both meaningful when set (DN-93, DN-25): an owner id
    // marks the row as one athlete's own rather than shared, and a timestamp
    // marks it retired. The management screen is the one reader that asks for
    // retired rows on purpose, so the shape has to admit them.
    const owned = libraryExercise({
      ownerId: "user_alice",
      archivedAt: "2026-09-17T00:00:00.000Z",
    });
    expect(exerciseSchema.safeParse(owned).success).toBe(true);
  });

  it("rejects a write that names its own tier", () => {
    // `ownerId` and `archivedAt` are the server's answer to which route was
    // called. If they ever became writable, an athlete could post one naming
    // `ownerId: null` and write straight into the shared library.
    const written = createExerciseSchema.safeParse({
      name: "Push-up",
      pattern: "push",
      equipment: [],
      scalable: true,
      unit: "reps",
      instructions: null,
      line: null,
      rung: null,
      altExerciseId: null,
      phase: null,
      ownerId: null,
    });
    expect(written.success).toBe(true);
    expect(written.success && "ownerId" in written.data).toBe(false);
  });

  it("rejects a tag outside the equipment catalog", () => {
    // The column is a bare String[] -- this schema is the only thing standing
    // between a typo in the seed and a tag no ownership check will ever match.
    expect(
      exerciseSchema.safeParse(libraryExercise({ equipment: ["barbell"] }))
        .success,
    ).toBe(false);
  });

  it("drops the id for a create payload", () => {
    const { id: _omitted, ...withoutId } = libraryExercise();
    expect(createExerciseSchema.safeParse(withoutId).success).toBe(true);
  });
});

describe("setSubstitutionRequestSchema", () => {
  it("parses a swap keyed by the movement row, not the exercise", () => {
    // A WOD naming the same line twice must move only the row that was tapped.
    expect(
      setSubstitutionRequestSchema.safeParse({
        wodMovementId: "wm-1",
        exerciseId: "e-2",
      }).success,
    ).toBe(true);
  });

  it("rejects an empty movement id rather than swapping nothing", () => {
    expect(
      setSubstitutionRequestSchema.safeParse({
        wodMovementId: "",
        exerciseId: "e-2",
      }).success,
    ).toBe(false);
  });

  it("rejects an empty exercise id", () => {
    expect(
      setSubstitutionRequestSchema.safeParse({
        wodMovementId: "wm-1",
        exerciseId: "",
      }).success,
    ).toBe(false);
  });

  it("parses a swap against a prescribed movement instead", () => {
    // A program's straight-sets day carries no WodMovement at all (DN-125).
    expect(
      setSubstitutionRequestSchema.safeParse({
        planSlotMovementId: "psm-1",
        exerciseId: "e-2",
      }).success,
    ).toBe(true);
  });

  it("rejects a body naming both kinds of movement", () => {
    expect(
      setSubstitutionRequestSchema.safeParse({
        wodMovementId: "wm-1",
        planSlotMovementId: "psm-1",
        exerciseId: "e-2",
      }).success,
    ).toBe(false);
  });

  it("rejects a body naming neither", () => {
    expect(
      setSubstitutionRequestSchema.safeParse({ exerciseId: "e-2" }).success,
    ).toBe(false);
  });

  it("defaults the key it was not given, so a body written before DN-125 still parses", () => {
    expect(
      setSubstitutionRequestSchema.parse({
        wodMovementId: "wm-1",
        exerciseId: "e-2",
      }).planSlotMovementId,
    ).toBeNull();
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
    expect(
      proposedRungChangeSchema.safeParse(proposal({ fromRung: null })).success,
    ).toBe(true);
  });

  it("requires a destination rung", () => {
    expect(
      proposedRungChangeSchema.safeParse(proposal({ toRung: null })).success,
    ).toBe(false);
  });
});

describe("todayResponseSchema", () => {
  const todayPayload = (overrides: Record<string, unknown> = {}) => ({
    date: "2026-09-16",
    isRestDay: false,
    assignment: {
      id: "a-1",
      date: "2026-09-16",
      status: "scheduled",
      wod: wod(),
      prescription: null,
      session: null,
    },
    warmupCooldownEnabled: true,
    warmup: [{ id: "c-1", name: "Arm circles", instructions: null }],
    cooldown: [],
    plan: null,
    completedProgram: null,
    makeup: null,
    ...overrides,
  });

  const completedProgramBlock = (overrides: Record<string, unknown> = {}) => ({
    enrollmentId: "enrollment-1",
    planId: "plan-1",
    planName: "Pull-Up Builder",
    completedAt: "2026-09-15T09:00:00.000Z",
    summary: {
      weeks: 6,
      sessions: 24,
      rungChanges: [
        {
          line: "pull",
          fromRung: 0,
          toRung: 2,
          fromName: "Negative chin-up",
          toName: "Chin-up",
        },
      ],
      ...(overrides.summary as Record<string, unknown> | undefined),
    },
    ...overrides,
  });

  const planBlock = (overrides: Record<string, unknown> = {}) => ({
    enrollmentId: "enrollment-1",
    planId: "plan-1",
    name: "Pull-Up Builder",
    week: 2,
    totalWeeks: 6,
    weekLabel: "Deload",
    slotKind: "wod_generated",
    ...overrides,
  });

  it("carries the completion card when one is owed (DN-18)", () => {
    expect(
      todayResponseSchema.safeParse(
        todayPayload({ completedProgram: completedProgramBlock() }),
      ).success,
    ).toBe(true);
  });

  it("refuses the card field being absent, so a client cannot forget it", () => {
    const { completedProgram: _omitted, ...rest } = todayPayload();
    expect(todayResponseSchema.safeParse(rest).success).toBe(false);
  });

  it("parses a day with an assignment", () => {
    expect(todayResponseSchema.safeParse(todayPayload()).success).toBe(true);
  });

  it("parses a rest day, where the assignment and both checklists are null", () => {
    expect(
      todayResponseSchema.safeParse(
        todayPayload({
          isRestDay: true,
          assignment: null,
          warmup: null,
          cooldown: null,
        }),
      ).success,
    ).toBe(true);
  });

  describe("a day that is a prescription rather than a WOD (DN-19)", () => {
    const prescribed = {
      id: "psm-1",
      order: 0,
      sets: 5,
      reps: 3,
      restSeconds: 90,
      line: "pull",
      exercise: movement().exercise,
      isSwapped: false,
      prescribedName: null,
      prescribedId: null,
      prescribedReason: null,
    };
    const day = (assignment: Record<string, unknown>) =>
      todayResponseSchema.safeParse(
        todayPayload({
          assignment: {
            id: "a-1",
            date: "2026-09-16",
            status: "scheduled",
            session: null,
            ...assignment,
          },
        }),
      );

    it("parses a prescribed day", () => {
      expect(
        day({ wod: null, prescription: { movements: [prescribed] } }).success,
      ).toBe(true);
    });

    it("rejects a day carrying both", () => {
      // Two workouts and no way to choose between them.
      expect(
        day({ wod: wod(), prescription: { movements: [prescribed] } }).success,
      ).toBe(false);
    });

    it("rejects a day carrying neither", () => {
      // What a WOD-less assignment looked like before DN-19 gave the column a
      // meaning: an assignment with no session in it, which is a bug and not
      // a day.
      expect(day({ wod: null, prescription: null }).success).toBe(false);
    });

    it("rejects a prescription with nothing in it", () => {
      expect(day({ wod: null, prescription: { movements: [] } }).success).toBe(
        false,
      );
    });
  });

  it("rejects a malformed WOD nested inside it", () => {
    // The refinements have to survive nesting, or the API's outermost
    // response is the one place they stop applying.
    const badWod = wod({
      movements: [movement({ reps: 45, repScheme: [21, 15] })],
    });
    expect(
      todayResponseSchema.safeParse(
        todayPayload({
          assignment: {
            id: "a-1",
            date: "2026-09-16",
            status: "scheduled",
            wod: badWod,
            prescription: null,
            session: null,
          },
        }),
      ).success,
    ).toBe(false);
  });

  it("requires the plan block to be stated, even as null", () => {
    // Nullable, not optional. An API that omits it is an API whose response
    // the client rejects, which is the whole reason the field is spelled out
    // on every path in SchedulerService rather than added where convenient.
    const { plan: _omitted, ...withoutPlan } = todayPayload();
    expect(todayResponseSchema.safeParse(withoutPlan).success).toBe(false);
  });

  it("requires the makeup block to be stated, even as null", () => {
    const { makeup: _omitted, ...withoutMakeup } = todayPayload();
    expect(todayResponseSchema.safeParse(withoutMakeup).success).toBe(false);
  });

  it("parses a rest day carrying a makeup offer", () => {
    expect(
      todayResponseSchema.safeParse(
        todayPayload({
          isRestDay: true,
          assignment: null,
          makeup: { sessionsThisWeek: 5, completedThisWeek: 3 },
        }),
      ).success,
    ).toBe(true);
  });

  it("parses a fresh week, short by all of it", () => {
    // Monday morning with nothing done. Zero is a real count here, so the
    // schema has to allow it where it refuses a zero week number.
    expect(
      todayResponseSchema.safeParse(
        todayPayload({
          makeup: { sessionsThisWeek: 5, completedThisWeek: 0 },
        }),
      ).success,
    ).toBe(true);
  });

  it("rejects a negative completed count", () => {
    // "-1 short this week" is an accusation, not a count.
    expect(
      todayResponseSchema.safeParse(
        todayPayload({
          makeup: { sessionsThisWeek: 5, completedThisWeek: -1 },
        }),
      ).success,
    ).toBe(false);
  });

  it("parses a day inside a program", () => {
    expect(
      todayResponseSchema.safeParse(todayPayload({ plan: planBlock() }))
        .success,
    ).toBe(true);
  });

  it("parses an open-ended program, where the week has no second half", () => {
    // "Week 37" rather than "week 37 of ...". Just WODs never finishes.
    expect(
      todayResponseSchema.safeParse(
        todayPayload({
          plan: planBlock({ week: 37, totalWeeks: null, weekLabel: null }),
        }),
      ).success,
    ).toBe(true);
  });

  it("parses a day the program authors nothing for", () => {
    // resolveSlotForDate's `unscheduled`: inside the program, but this week
    // says nothing about this weekday. Distinct from an authored rest day,
    // which is a positive instruction.
    expect(
      todayResponseSchema.safeParse(
        todayPayload({ plan: planBlock({ slotKind: null }) }),
      ).success,
    ).toBe(true);
  });

  it("rejects a week counted from zero", () => {
    // The one 1-based number in this vocabulary, because it is the one an
    // athlete reads. Accepting 0 would put "Week 0" on someone's screen.
    expect(
      todayResponseSchema.safeParse(
        todayPayload({ plan: planBlock({ week: 0 }) }),
      ).success,
    ).toBe(false);
  });

  it("rejects a slot kind the program vocabulary does not have", () => {
    expect(
      todayResponseSchema.safeParse(
        todayPayload({ plan: planBlock({ slotKind: "wod" }) }),
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
    ["planPhase", planPhase, "core", "deload"],
    ["planSlotKind", planSlotKind, "wod_generated", "wod"],
    ["scheduleMode", scheduleMode, "flexible", "strict"],
    ["enrollmentStatus", enrollmentStatus, "completed", "cancelled"],
  ])(
    "%s accepts its members and rejects anything else",
    (_name, schema, valid, invalid) => {
      expect(schema.safeParse(valid).success).toBe(true);
      expect(schema.safeParse(invalid).success).toBe(false);
    },
  );

  it("keeps progressionLine finer-grained than movementPattern", () => {
    // "core" is a pattern; the ladders under it are core_dynamic/hold/side.
    expect(movementPattern.safeParse("core").success).toBe(true);
    expect(progressionLine.safeParse("core").success).toBe(false);
    expect(progressionLine.safeParse("core_dynamic").success).toBe(true);
  });
});

/**
 * Per-movement history (DN-89). The client reads this to say what has been
 * trained, so what the schema refuses matters as much as what it accepts: a
 * movement with no days, or a session count of zero, would render as a
 * movement the athlete has trained and never trained at once.
 */
describe("movementHistorySchema", () => {
  function history(overrides: Record<string, unknown> = {}) {
    return {
      exerciseId: "chin-up",
      name: "Chin-up",
      line: "pull",
      unit: "reps",
      sessions: 2,
      total: 50,
      firstTrained: "2026-09-10",
      lastTrained: "2026-09-14",
      days: [
        {
          date: "2026-09-14",
          name: "Cindy",
          reps: 30,
          isSwapped: false,
          prescribedName: null,
          prescribedReason: null,
        },
      ],
      ...overrides,
    };
  }

  it("parses a movement the athlete has trained", () => {
    const parsed = movementHistorySchema.parse(history());
    expect(parsed).toMatchObject({ sessions: 2, total: 50, unit: "reps" });
    expect(parsed.days[0].name).toBe("Cindy");
  });

  it("accepts a movement that sits off every progression line", () => {
    // Cardio and the loaded movements carry no line, and they are trained like
    // anything else.
    expect(
      movementHistorySchema.parse(history({ line: null })).line,
    ).toBeNull();
  });

  it("refuses a history of no sessions", () => {
    // `sessions` counts the days behind it, so zero is not a movement with an
    // empty history — it is a row that should not have been built.
    expect(
      movementHistorySchema.safeParse(history({ sessions: 0 })).success,
    ).toBe(false);
  });

  it("carries which layer replaced the prescribed movement", () => {
    // The three causes read differently (DN-79), so history keeps them apart
    // rather than recording "something changed".
    const parsed = movementHistorySchema.parse(
      history({
        days: [
          {
            date: "2026-09-14",
            name: "Rope Trick",
            reps: 100,
            isSwapped: false,
            prescribedName: "Double-unders",
            prescribedReason: "equipment",
          },
        ],
      }),
    );
    expect(parsed.days[0].prescribedReason).toBe("equipment");
  });

  it("refuses a reason outside the two automatic substitutions", () => {
    const parsed = movementHistorySchema.safeParse(
      history({
        days: [
          {
            date: "2026-09-14",
            name: "Cindy",
            reps: 30,
            isSwapped: true,
            prescribedName: null,
            prescribedReason: "swapped",
          },
        ],
      }),
    );
    // A swap is `isSwapped`, not a reason — the same line substitutionReason
    // holds everywhere else.
    expect(parsed.success).toBe(false);
  });

  it("counts a timed movement in seconds without converting it", () => {
    const parsed = movementHistorySchema.parse(
      history({ unit: "seconds", total: 300, line: "core_hold" }),
    );
    expect(parsed).toMatchObject({ unit: "seconds", total: 300 });
  });
});

describe("createWodSchema", () => {
  /** A complete write body — each test changes only the field it is about. */
  function wod(overrides: Record<string, unknown> = {}) {
    return {
      name: "Fran",
      type: "for_time",
      timeCapMinutes: 12,
      rounds: null,
      workSeconds: null,
      restSeconds: null,
      intervalCount: null,
      isNamed: true,
      dominantPattern: "push",
      description: null,
      movements: [{ exerciseId: "ex-1", reps: 21 }],
      ...overrides,
    };
  }

  it("rejects a write that names its own tier", () => {
    // `ownerId` and `archivedAt` are the server's answer to which route was
    // called. Writable, an athlete could post one naming `ownerId: null` and
    // write straight into the pool every other athlete trains from.
    const written = createWodSchema.safeParse(
      wod({ ownerId: null, archivedAt: null }),
    );
    expect(written.success).toBe(true);
    expect(written.success && "ownerId" in written.data).toBe(false);
    expect(written.success && "archivedAt" in written.data).toBe(false);
  });

  it("drops the session-only fields a read carries", () => {
    // `wodMovementSchema` describes a movement in one athlete's session. None
    // of what it says about that session means anything in the library, which
    // is why the write shape is spelled out rather than derived from it.
    const written = createWodSchema.safeParse(
      wod({
        movements: [
          {
            exerciseId: "ex-1",
            reps: 21,
            isSwapped: true,
            prescribedName: "Pull-up",
          },
        ],
      }),
    );
    expect(written.success).toBe(true);
    expect(written.success && "isSwapped" in written.data.movements[0]).toBe(
      false,
    );
  });

  it("takes a flat count or a ladder, and refuses both at once", () => {
    // The pair is what the CHECK constraint rejects, and Postgres rejecting it
    // arrives as an opaque constraint violation. Accepting only one of the two
    // is how the totals stop being two numbers that have to agree.
    expect(createWodSchema.safeParse(wod()).success).toBe(true);
    expect(
      createWodSchema.safeParse({
        ...wod(),
        movements: [{ exerciseId: "ex-1", repScheme: [21, 15, 9] }],
      }).success,
    ).toBe(true);
    expect(
      createWodSchema.safeParse({
        ...wod(),
        movements: [{ exerciseId: "ex-1", reps: 45, repScheme: [21, 15, 9] }],
      }).success,
    ).toBe(false);
  });

  it("refuses a movement stating neither", () => {
    expect(
      createWodSchema.safeParse({
        ...wod(),
        movements: [{ exerciseId: "ex-1" }],
      }).success,
    ).toBe(false);
  });

  it("refuses a WOD with no movements", () => {
    // It parses, schedules, and hands the athlete an empty screen at the
    // moment they meant to train.
    expect(createWodSchema.safeParse(wod({ movements: [] })).success).toBe(
      false,
    );
  });

  it("refuses ladders of differing lengths", () => {
    // A ladder is one shape for the whole workout. Two lengths leave no single
    // answer to "what round is this?" — the same rule wodSchema holds on read.
    expect(
      createWodSchema.safeParse({
        ...wod(),
        movements: [
          { exerciseId: "ex-1", repScheme: [21, 15, 9] },
          { exerciseId: "ex-2", repScheme: [10, 10] },
        ],
      }).success,
    ).toBe(false);
  });

  it("lets a flat movement sit alongside a ladder", () => {
    // Only non-empty schemes are compared: "15 burpees every round" is not a
    // third length, it is the absence of one.
    expect(
      createWodSchema.safeParse({
        ...wod(),
        movements: [
          { exerciseId: "ex-1", repScheme: [21, 15, 9] },
          { exerciseId: "ex-2", reps: 15 },
        ],
      }).success,
    ).toBe(true);
  });

  it("takes no order, so the list's own sequence is the only one", () => {
    const written = createWodSchema.safeParse({
      ...wod(),
      movements: [{ exerciseId: "ex-1", reps: 21, order: 7 }],
    });
    expect(written.success).toBe(true);
    expect(written.success && "order" in written.data.movements[0]).toBe(false);
  });
});

describe("updateWodSchema", () => {
  it("accepts a patch naming one field", () => {
    expect(updateWodSchema.safeParse({ timeCapMinutes: 20 }).success).toBe(
      true,
    );
  });

  it("holds the movement rules on a patch that carries a list", () => {
    // `.partial()` makes the field optional, not lax: a list that arrives is
    // the whole list, and it has to be a legal one.
    expect(updateWodSchema.safeParse({ movements: [] }).success).toBe(false);
    expect(
      updateWodSchema.safeParse({
        movements: [{ exerciseId: "ex-1", reps: 45, repScheme: [21, 15, 9] }],
      }).success,
    ).toBe(false);
  });

  it("cannot retire a WOD by echoing back a field it read", () => {
    const written = updateWodSchema.safeParse({
      archivedAt: "2026-09-17T00:00:00.000Z",
    });
    expect(written.success).toBe(true);
    expect(written.success && "archivedAt" in written.data).toBe(false);
  });
});

/**
 * Programs (DN-10). The two refinements here mirror database CHECKs, so each
 * is tested from both sides: what the constraint permits must parse, and what
 * it refuses must not. A schema looser than its CHECK lets the API build a
 * payload the database will reject; a schema tighter than its CHECK lets the
 * seed write a row the API then cannot serialize.
 */
function slot(overrides: Record<string, unknown> = {}) {
  return {
    id: "slot-1",
    dayOfWeek: 1,
    kind: "wod_generated",
    priority: 0,
    wodId: null,
    pattern: "pull",
    wodType: null,
    allowNamed: false,
    maxTimeCapMinutes: 20,
    ...overrides,
  };
}

function plan(overrides: Record<string, unknown> = {}) {
  return {
    id: "plan-1",
    name: "Pull-Up Builder",
    summary: "Six weeks to your first unassisted chin-up.",
    goal: "your first unassisted chin-up",
    scheduleMode: "flexible",
    minDaysPerWeek: 3,
    maxDaysPerWeek: 5,
    defaultDays: [1, 3, 5],
    minWeeks: 4,
    maxWeeks: 8,
    defaultWeeks: 6,
    ...overrides,
  };
}

describe("planSlotSchema's pinned-WOD refinement", () => {
  it("accepts a pinned slot that names a WOD", () => {
    expect(
      planSlotSchema.safeParse(slot({ kind: "wod_pinned", wodId: "wod-1" }))
        .success,
    ).toBe(true);
  });

  it("rejects a pinned slot with nothing pinned", () => {
    const result = planSlotSchema.safeParse(
      slot({ kind: "wod_pinned", wodId: null }),
    );
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(["wodId"]);
  });

  it("rejects a rest day that points at a WOD", () => {
    // The CHECK is a biconditional, not "a pinned slot has a wodId". A rest
    // day carrying a WOD is a row whose `kind` and `wodId` tell different
    // stories, and whichever a reader believes, the other is a bug.
    expect(
      planSlotSchema.safeParse(slot({ kind: "rest", wodId: "wod-1" })).success,
    ).toBe(false);
  });

  it("rejects a generated slot that points at a WOD", () => {
    expect(
      planSlotSchema.safeParse(slot({ kind: "wod_generated", wodId: "wod-1" }))
        .success,
    ).toBe(false);
  });

  it("accepts a generated slot with every constraint left open", () => {
    // A null skips its axis rather than narrowing to nothing.
    expect(
      planSlotSchema.safeParse(
        slot({ pattern: null, wodType: null, maxTimeCapMinutes: null }),
      ).success,
    ).toBe(true);
  });

  it("rejects a weekday outside 0-6", () => {
    expect(planSlotSchema.safeParse(slot({ dayOfWeek: 7 })).success).toBe(
      false,
    );
    expect(planSlotSchema.safeParse(slot({ dayOfWeek: -1 })).success).toBe(
      false,
    );
  });

  it("accepts Sunday, which is 0 and not 7", () => {
    expect(planSlotSchema.safeParse(slot({ dayOfWeek: 0 })).success).toBe(true);
  });
});

describe("planSlotSchema's prescription refinement", () => {
  const prescribed = (overrides: Record<string, unknown> = {}) => ({
    id: "psm-1",
    order: 0,
    line: "pull",
    exerciseId: null,
    sets: 5,
    reps: 3,
    restSeconds: 90,
    ...overrides,
  });
  const movementDay = (movements: unknown[]) =>
    slot({ kind: "movements", pattern: null, maxTimeCapMinutes: null, movements });

  it("accepts a movements day that prescribes something", () => {
    expect(planSlotSchema.safeParse(movementDay([prescribed()])).success).toBe(
      true,
    );
  });

  it("rejects a movements day that prescribes nothing", () => {
    // The rule no CHECK can hold: `kind` is on the slot and the rows are on
    // another table (DN-19). A day of this kind with an empty prescription is
    // a screen with nothing on it.
    const result = planSlotSchema.safeParse(movementDay([]));
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(["movements"]);
  });

  it("rejects a rest day carrying a prescription", () => {
    // The same biconditional as the pinned-WOD rule, refused for the same
    // reason: two halves of one row describing different days.
    expect(
      planSlotSchema.safeParse(slot({ kind: "rest", movements: [prescribed()] }))
        .success,
    ).toBe(false);
  });

  it("leaves every other kind with an empty prescription by default", () => {
    // Why the field is defaulted rather than required: every slot authored
    // before DN-19 still parses as the WOD day it describes.
    const parsed = planSlotSchema.parse(slot());
    expect(parsed.movements).toEqual([]);
  });

  it("accepts a prescription pinned to an exercise instead of a line", () => {
    expect(
      planSlotSchema.safeParse(
        movementDay([prescribed({ line: null, exerciseId: "ex-1" })]),
      ).success,
    ).toBe(true);
  });

  it("rejects a prescribed movement naming both a line and an exercise", () => {
    expect(
      planSlotSchema.safeParse(movementDay([prescribed({ exerciseId: "ex-1" })]))
        .success,
    ).toBe(false);
  });

  it("rejects a prescribed movement naming neither", () => {
    // Sets and reps attached to nothing.
    expect(
      planSlotSchema.safeParse(movementDay([prescribed({ line: null })])).success,
    ).toBe(false);
  });

  it("rejects zero sets and zero reps", () => {
    expect(
      planSlotSchema.safeParse(movementDay([prescribed({ sets: 0 })])).success,
    ).toBe(false);
    expect(
      planSlotSchema.safeParse(movementDay([prescribed({ reps: 0 })])).success,
    ).toBe(false);
  });

  it("accepts no rest but refuses negative rest", () => {
    // 0 is a prescription -- straight through -- rather than an omission.
    expect(
      planSlotSchema.safeParse(movementDay([prescribed({ restSeconds: 0 })]))
        .success,
    ).toBe(true);
    expect(
      planSlotSchema.safeParse(movementDay([prescribed({ restSeconds: -1 })]))
        .success,
    ).toBe(false);
  });
});

describe("planSchema's schedule-mode refinement", () => {
  it("accepts a flexible program carrying both day bounds", () => {
    expect(planSchema.safeParse(plan()).success).toBe(true);
  });

  it("accepts a fixed program carrying neither", () => {
    expect(
      planSchema.safeParse(
        plan({
          scheduleMode: "fixed",
          minDaysPerWeek: null,
          maxDaysPerWeek: null,
        }),
      ).success,
    ).toBe(true);
  });

  it("rejects a fixed program that states day bounds anyway", () => {
    // The slot layout IS a fixed program's schedule, so a day count beside it
    // is a second answer to a question already settled -- and the one the
    // scheduler ignores.
    const result = planSchema.safeParse(plan({ scheduleMode: "fixed" }));
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(["scheduleMode"]);
  });

  it("rejects a fixed program stating just one of them", () => {
    expect(
      planSchema.safeParse(
        plan({ scheduleMode: "fixed", maxDaysPerWeek: null }),
      ).success,
    ).toBe(false);
  });

  it("rejects a flexible program missing its bounds", () => {
    expect(
      planSchema.safeParse(plan({ minDaysPerWeek: null, maxDaysPerWeek: null }))
        .success,
    ).toBe(false);
  });

  it("rejects a flexible program stating only one bound", () => {
    expect(planSchema.safeParse(plan({ maxDaysPerWeek: null })).success).toBe(
      false,
    );
  });

  it("accepts an open-ended program, which has no length to choose", () => {
    // Just WODs: fixed, never finishes, so all three week fields are null.
    expect(
      planSchema.safeParse(
        plan({
          name: "Just WODs",
          goal: null,
          scheduleMode: "fixed",
          minDaysPerWeek: null,
          maxDaysPerWeek: null,
          defaultDays: [],
          minWeeks: null,
          maxWeeks: null,
          defaultWeeks: null,
        }),
      ).success,
    ).toBe(true);
  });

  it("rejects a program with no summary to tell it apart", () => {
    expect(planSchema.safeParse(plan({ summary: undefined })).success).toBe(
      false,
    );
  });
});

describe("planDetailSchema", () => {
  const week = (overrides: Record<string, unknown> = {}) => ({
    id: "week-1",
    order: 0,
    phase: "core",
    label: null,
    slots: [slot()],
    ...overrides,
  });

  it("parses a program with its authored weeks", () => {
    expect(
      planDetailSchema.safeParse({ ...plan(), weeks: [week()] }).success,
    ).toBe(true);
  });

  it("carries the same schedule-mode rule as planSchema", () => {
    // One predicate, applied twice -- a rule restated in two places is a rule
    // that eventually becomes two different rules.
    expect(
      planDetailSchema.safeParse({
        ...plan({ scheduleMode: "fixed" }),
        weeks: [week()],
      }).success,
    ).toBe(false);
  });

  it("rejects a malformed slot nested two levels down", () => {
    const bad = week({ slots: [slot({ kind: "rest", wodId: "wod-1" })] });
    expect(
      planDetailSchema.safeParse({ ...plan(), weeks: [bad] }).success,
    ).toBe(false);
  });

  it("rejects a week whose phase is not one expandPlanWeeks will play", () => {
    expect(
      planDetailSchema.safeParse({
        ...plan(),
        weeks: [week({ phase: "deload" })],
      }).success,
    ).toBe(false);
  });

  it("accepts a program with no weeks authored yet", () => {
    // An empty list is a program under construction, not a malformed one.
    // What a program may not do is run without weeks, which is
    // minimumViableWeeks' job and not a shape question.
    expect(planDetailSchema.safeParse({ ...plan(), weeks: [] }).success).toBe(
      true,
    );
  });
});

describe("planEnrollmentSchema", () => {
  const enrollment = (overrides: Record<string, unknown> = {}) => ({
    id: "enrollment-1",
    plan: plan(),
    startDate: "2026-09-14",
    weeks: 6,
    status: "active",
    completedAt: null,
    startingRungs: { pull: 2, squat: 4 },
    summary: null,
    ...overrides,
  });

  it("parses an active run", () => {
    expect(planEnrollmentSchema.safeParse(enrollment()).success).toBe(true);
  });

  it("parses a completed run with its snapshotted card", () => {
    expect(
      planEnrollmentSchema.safeParse(
        enrollment({
          status: "completed",
          completedAt: "2026-10-26T09:00:00.000Z",
          summary: {
            weeks: 6,
            sessions: 24,
            rungChanges: [
              {
                line: "pull",
                fromRung: 2,
                toRung: 4,
                fromName: "Negative",
                toName: "Chin-up",
              },
            ],
          },
        }),
      ).success,
    ).toBe(true);
  });

  it("accepts an athlete with no rungs at all", () => {
    // A new athlete has no SkillLevel rows (DN-86). An exhaustive record would
    // reject exactly the athlete this snapshot exists to describe.
    expect(
      planEnrollmentSchema.safeParse(enrollment({ startingRungs: {} })).success,
    ).toBe(true);
  });

  it("does not require a rung for every line in the app", () => {
    expect(
      planEnrollmentSchema.safeParse(enrollment({ startingRungs: { pull: 2 } }))
        .success,
    ).toBe(true);
  });

  it("rejects a rung snapshot keyed by something that is not a line", () => {
    expect(
      planEnrollmentSchema.safeParse(
        enrollment({ startingRungs: { biceps: 2 } }),
      ).success,
    ).toBe(false);
  });

  it("rejects a start date that is not a date", () => {
    // startDate is string-compared against DailyAssignment.date, so a value
    // in another format does not merely look wrong -- it sorts wrong, and the
    // program silently never starts.
    expect(
      planEnrollmentSchema.safeParse(enrollment({ startDate: "14/09/2026" }))
        .success,
    ).toBe(false);
    expect(
      planEnrollmentSchema.safeParse(
        enrollment({ startDate: "2026-09-14T00:00:00Z" }),
      ).success,
    ).toBe(false);
  });

  it("accepts an open-ended run, which has no length and never completes", () => {
    expect(
      planEnrollmentSchema.safeParse(enrollment({ weeks: null })).success,
    ).toBe(true);
  });

  it("rejects a run of zero weeks", () => {
    expect(
      planEnrollmentSchema.safeParse(enrollment({ weeks: 0 })).success,
    ).toBe(false);
  });

  it("rejects a malformed plan nested inside it", () => {
    expect(
      planEnrollmentSchema.safeParse(
        enrollment({ plan: plan({ scheduleMode: "fixed" }) }),
      ).success,
    ).toBe(false);
  });
});

describe("createEnrollmentSchema", () => {
  it("defaults weeks to null, which is the plan's own length", () => {
    const result = createEnrollmentSchema.safeParse({
      planId: "plan-1",
      startDate: "2026-09-14",
    });
    expect(result.success).toBe(true);
    expect(result.data?.weeks).toBeNull();
  });

  it("rejects an empty planId", () => {
    expect(
      createEnrollmentSchema.safeParse({ planId: "", startDate: "2026-09-14" })
        .success,
    ).toBe(false);
  });

  it("does not accept starting rungs from the client", () => {
    // They are read from the athlete's own SkillLevel rows when enrolling. A
    // client that could send them could misreport what the program is
    // measured against.
    const result = createEnrollmentSchema.safeParse({
      planId: "plan-1",
      startDate: "2026-09-14",
      startingRungs: { pull: 99 },
    });
    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty("startingRungs");
  });
});

/**
 * What a finished program is handed back as (DN-18).
 *
 * The figures are snapshotted when the run ends, so this shape is read far
 * more often than it is written and the rules that matter are the ones about
 * what may be absent: an open-ended run has no length, and a program nobody
 * trained has no sessions and nothing that moved.
 */
describe("completedProgramSchema", () => {
  const program = (overrides: Record<string, unknown> = {}) => ({
    enrollmentId: "enrollment-1",
    planId: "plan-1",
    planName: "Pull-Up Builder",
    completedAt: "2026-09-15T09:00:00.000Z",
    summary: {
      weeks: 6,
      sessions: 24,
      rungChanges: [
        {
          line: "pull",
          fromRung: 0,
          toRung: 2,
          fromName: "Negative chin-up",
          toName: "Chin-up",
        },
      ],
    },
    ...overrides,
  });

  it("parses a finished program", () => {
    expect(completedProgramSchema.safeParse(program()).success).toBe(true);
  });

  it("accepts a run that had no length to report", () => {
    expect(
      completedProgramSchema.safeParse(
        program({ summary: { weeks: null, sessions: 12, rungChanges: [] } }),
      ).success,
    ).toBe(true);
  });

  it("accepts a program nobody trained", () => {
    expect(
      completedProgramSchema.safeParse(
        program({ summary: { weeks: 6, sessions: 0, rungChanges: [] } }),
      ).success,
    ).toBe(true);
  });

  it("refuses zero weeks, which is not a run that happened", () => {
    expect(
      completedProgramSchema.safeParse(
        program({ summary: { weeks: 0, sessions: 0, rungChanges: [] } }),
      ).success,
    ).toBe(false);
  });

  it("refuses a negative session count", () => {
    expect(
      completedProgramSchema.safeParse(
        program({ summary: { weeks: 6, sessions: -1, rungChanges: [] } }),
      ).success,
    ).toBe(false);
  });

  it("refuses a rung change on a line the app does not have", () => {
    expect(
      completedProgramSchema.safeParse(
        program({
          summary: {
            weeks: 6,
            sessions: 24,
            rungChanges: [
              {
                line: "sorcery",
                fromRung: 0,
                toRung: 1,
                fromName: "Wand",
                toName: "Staff",
              },
            ],
          },
        }),
      ).success,
    ).toBe(false);
  });

  it("refuses a rung change with no name at one end", () => {
    // A name is the only part of this an athlete can read, and a card that
    // renders "pull: negative → " is worse than one that omits the line.
    expect(
      completedProgramSchema.safeParse(
        program({
          summary: {
            weeks: 6,
            sessions: 24,
            rungChanges: [
              { line: "pull", fromRung: 0, toRung: 2, fromName: "Negative" },
            ],
          },
        }),
      ).success,
    ).toBe(false);
  });

  it("refuses a date with no time on it", () => {
    // `completedAt` is a timestamp, unlike the ISO dates elsewhere in the
    // program vocabulary -- two programs can finish on the same day.
    expect(
      completedProgramSchema.safeParse(program({ completedAt: "2026-09-15" }))
        .success,
    ).toBe(false);
  });

  it("refuses a run that has not finished", () => {
    expect(
      completedProgramSchema.safeParse(program({ completedAt: null })).success,
    ).toBe(false);
  });
});
