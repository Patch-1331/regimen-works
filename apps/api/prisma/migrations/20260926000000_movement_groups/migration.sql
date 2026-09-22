-- A progression line is an equivalence group, not a ladder (DN-134, ADR-0004).
--
-- Renames only. No value is rewritten: the group slugs ('pull', 'squat_loaded')
-- are unchanged, and `rung` is untouched here — it is replaced by a foreign key
-- to the chosen exercise in a follow-up issue, so renaming it now would be two
-- migrations on one column for nothing.

ALTER TABLE "Exercise" RENAME COLUMN "line" TO "movementGroup";
ALTER TABLE "Exercise" RENAME COLUMN "altExerciseId" TO "fallbackExerciseId";
ALTER TABLE "Exercise" RENAME CONSTRAINT "Exercise_altExerciseId_fkey" TO "Exercise_fallbackExerciseId_fkey";

ALTER TABLE "SkillLevel" RENAME COLUMN "line" TO "movementGroup";
ALTER INDEX "SkillLevel_userId_line_key" RENAME TO "SkillLevel_userId_movementGroup_key";

ALTER TABLE "PlanSlotMovement" RENAME COLUMN "line" TO "movementGroup";
ALTER TABLE "PlanSlotMovement" RENAME CONSTRAINT "PlanSlotMovement_line_xor_exercise" TO "PlanSlotMovement_movementGroup_xor_exercise";
