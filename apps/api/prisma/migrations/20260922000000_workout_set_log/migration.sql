-- CreateTable
CREATE TABLE "WorkoutSetLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "movementOrder" INTEGER NOT NULL,
    "setNumber" INTEGER NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "prescribedReps" INTEGER NOT NULL,
    "actualReps" INTEGER NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkoutSetLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkoutSession_id_userId_key" ON "WorkoutSession"("id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkoutSetLog_sessionId_movementOrder_setNumber_key" ON "WorkoutSetLog"("sessionId", "movementOrder", "setNumber");

-- CreateIndex
CREATE INDEX "WorkoutSetLog_userId_exerciseId_completedAt_idx" ON "WorkoutSetLog"("userId", "exerciseId", "completedAt");

-- AddForeignKey
ALTER TABLE "WorkoutSetLog" ADD CONSTRAINT "WorkoutSetLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutSetLog" ADD CONSTRAINT "WorkoutSetLog_sessionId_userId_fkey" FOREIGN KEY ("sessionId", "userId") REFERENCES "WorkoutSession"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutSetLog" ADD CONSTRAINT "WorkoutSetLog_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Constraints Prisma cannot express
--
-- `movementOrder` indexes into the session's own snapshot and `setNumber`
-- counts within that movement the way `straightSetsStateAt` counts -- 0-based
-- and 1-based respectively, which is why they are checked differently. A set
-- numbered 0 would be a set before the first one.
ALTER TABLE "WorkoutSetLog"
  ADD CONSTRAINT "WorkoutSetLog_movementOrder_nonnegative"
  CHECK ("movementOrder" >= 0);

ALTER TABLE "WorkoutSetLog"
  ADD CONSTRAINT "WorkoutSetLog_setNumber_positive"
  CHECK ("setNumber" >= 1);

-- A set nobody was asked to do is not a prescription, so the count the day
-- asked for is positive. What the athlete managed is separately allowed to be
-- 0: a set attempted and not made is a fact about the session, and refusing to
-- store it would leave the row missing and read as "not done yet" instead.
ALTER TABLE "WorkoutSetLog"
  ADD CONSTRAINT "WorkoutSetLog_prescribedReps_positive"
  CHECK ("prescribedReps" >= 1);

ALTER TABLE "WorkoutSetLog"
  ADD CONSTRAINT "WorkoutSetLog_actualReps_nonnegative"
  CHECK ("actualReps" >= 0);
