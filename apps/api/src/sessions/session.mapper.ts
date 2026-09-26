import type {
  Prisma,
  WorkoutSession as PrismaWorkoutSession,
} from '@prisma/client';
import type {
  RoundSplit,
  SessionMovement,
  WorkoutSession,
  WorkoutSetLog as WorkoutSetLogDto,
} from '@regimen-works/shared';

/**
 * `roundSplits` is a jsonb column, so Prisma hands it back as a JsonValue --
 * already-structured data rather than the text this used to JSON.parse (#39).
 * The cast is the one place that names the shape, so the assertion stays here
 * rather than being repeated at each read site.
 */
export function toRoundSplits(value: Prisma.JsonValue): RoundSplit[] {
  return (value ?? []) as RoundSplit[];
}

/** Same contract as toRoundSplits, for the movement snapshot (DN-90). */
export function toSessionMovements(value: Prisma.JsonValue): SessionMovement[] {
  return (value ?? []) as SessionMovement[];
}

export function toSessionDto(session: PrismaWorkoutSession): WorkoutSession {
  return {
    id: session.id,
    assignmentId: session.assignmentId,
    startedAt: session.startedAt.toISOString(),
    capSeconds: session.capSeconds,
    roundSplits: toRoundSplits(session.roundSplits),
    movements: toSessionMovements(session.movements),
    status: session.status as WorkoutSession['status'],
    finishedAtSeconds: session.finishedAtSeconds,
    roundSplitCount: session.roundSplitCount,
    autoStopAtCap: session.autoStopAtCap,
    warmupCompletedAt: session.warmupCompletedAt?.toISOString() ?? null,
    cooldownCompletedAt: session.cooldownCompletedAt?.toISOString() ?? null,
    intervalIndex: session.intervalIndex,
    intervalStartedAtSeconds: session.intervalStartedAtSeconds,
    setsCompleted: session.setsCompleted,
    restStartedAtSeconds: session.restStartedAtSeconds,
  };
}

/**
 * A stored set, as a client reads it (DN-21).
 *
 * `userId`, `sessionId` and the timestamps are dropped: the caller asked for
 * one session's sets and already knows whose they are, and a row's identity to
 * the screen is its position, not when it was written.
 */
export function toSetLogDto(row: {
  id: string;
  movementOrder: number;
  setNumber: number;
  exerciseId: string;
  prescribedReps: number | null;
  prescribedRepsMax: number | null;
  prescribedToFailure: boolean;
  actualReps: number | null;
}): WorkoutSetLogDto {
  return {
    id: row.id,
    movementOrder: row.movementOrder,
    setNumber: row.setNumber,
    exerciseId: row.exerciseId,
    prescribedReps: row.prescribedReps,
    prescribedRepsMax: row.prescribedRepsMax,
    prescribedToFailure: row.prescribedToFailure,
    actualReps: row.actualReps,
  };
}
