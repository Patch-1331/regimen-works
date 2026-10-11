-- Warm-up and cool-down checklists become lists that point at exercises
-- (DN-172, ADR-0008), and `Exercise.phase` goes.
--
-- `phase` was one value per row, so a movement could be checklist content or
-- a workout movement but never both. The squat the squat group prescribes
-- ("Air squat") and the squat the warm-up rehearses ("Bodyweight squats") were
-- two rows of one movement. Here every phase becomes an entry, the duplicate
-- squat folds into the row the workouts already use, and the column is
-- dropped.

-- 1. The list.
CREATE TABLE "ChecklistEntry" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "pattern" TEXT,
    "instructions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "exerciseId" TEXT NOT NULL,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChecklistEntry_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ChecklistEntry" ADD CONSTRAINT "ChecklistEntry_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChecklistEntry" ADD CONSTRAINT "ChecklistEntry_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. Every phase becomes an entry, in the tier its row was in, serving the
--    pattern the row was tagged with -- which is what the checklist matched
--    on before. No copy of its own: the exercise's steps are still what the
--    checklist shows, so nothing an athlete reads changes.
--
--    The checklist read orders by `createdAt`, and one statement gives every
--    row the same `now()`; a millisecond apart, in name order, keeps the
--    lists from reading in whatever order the table hands back.
INSERT INTO "ChecklistEntry" ("id", "kind", "pattern", "exerciseId", "ownerId", "createdAt")
SELECT
  gen_random_uuid()::text, "phase", "pattern", "id", "ownerId",
  CURRENT_TIMESTAMP + (row_number() OVER (ORDER BY "name", "id")) * INTERVAL '1 millisecond'
FROM "Exercise"
WHERE "phase" IS NOT NULL;

-- 3. "Bodyweight squats" folds into "Air squat". Both are global rows; the
--    athlete's own library is not touched.
--
--    Its warm-up entry moves across and keeps the warm-up copy as its own, so
--    the checklist still says "easy reps, a little deeper each time" while the
--    workout keeps Air squat's working-set instructions. Anything else that
--    names the row moves across too; on today's data that is nothing, since
--    no WOD, plan, substitution, choice or log names a checklist movement, but
--    a migration that assumed so would orphan the first one that did.
--
--    Skipped entirely unless both rows exist, so a database that never had
--    them -- a fresh one, a test one -- runs this as a no-op.
DO $$
DECLARE
  dup TEXT;
  keep TEXT;
BEGIN
  SELECT "id" INTO dup FROM "Exercise" WHERE "ownerId" IS NULL AND "name" = 'Bodyweight squats';
  SELECT "id" INTO keep FROM "Exercise" WHERE "ownerId" IS NULL AND "name" = 'Air squat';
  IF dup IS NULL OR keep IS NULL THEN
    RETURN;
  END IF;

  UPDATE "ChecklistEntry" AS entry
  SET "exerciseId" = keep, "instructions" = old."instructions"
  FROM "Exercise" AS old
  WHERE old."id" = dup AND entry."exerciseId" = dup;

  UPDATE "WodMovement" SET "exerciseId" = keep WHERE "exerciseId" = dup;
  UPDATE "AssignmentSubstitution" SET "exerciseId" = keep WHERE "exerciseId" = dup;
  UPDATE "WorkoutSetLog" SET "exerciseId" = keep WHERE "exerciseId" = dup;
  UPDATE "PlanSlotMovement" SET "exerciseId" = keep WHERE "exerciseId" = dup;
  UPDATE "SkillLevel" SET "exerciseId" = keep WHERE "exerciseId" = dup;
  UPDATE "Exercise" SET "fallbackExerciseId" = keep WHERE "fallbackExerciseId" = dup;

  DELETE FROM "Exercise" WHERE "id" = dup;
END $$;

-- 4. The column the entries replace.
ALTER TABLE "Exercise" DROP COLUMN "phase";

-- 5. A movement is on each checklist at most once per tier. The compound
--    unique covers athletes' own entries; Postgres treats NULLs as distinct,
--    so the global tier needs the partial index as well. Prisma cannot express
--    a partial index -- keep it when `prisma migrate dev` offers to drop it.
CREATE UNIQUE INDEX "ChecklistEntry_ownerId_exerciseId_kind_key" ON "ChecklistEntry"("ownerId", "exerciseId", "kind");
CREATE UNIQUE INDEX "ChecklistEntry_global_exerciseId_kind_key" ON "ChecklistEntry"("exerciseId", "kind") WHERE "ownerId" IS NULL;
CREATE INDEX "ChecklistEntry_exerciseId_idx" ON "ChecklistEntry"("exerciseId");
