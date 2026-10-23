-- A set of a program line may state a load step (DN-186, ADR 0011 decision 3).
--
-- Additive only: one nullable column and two CHECKs. Every existing row gets
-- null, which is what it is -- no source has stated a load step yet -- and is
-- never read as 0. Nothing is rewritten.
--
-- The column is what `prisma migrate diff` generates. The CHECKs are not:
-- Prisma cannot express them and will offer to drop them on the next change
-- to this model. Don't accept that.

ALTER TABLE "ProgramSlotSet" ADD COLUMN "loadStepPercent" INTEGER;

-- The step is relative to the previous set, so the first set has none.
ALTER TABLE "ProgramSlotSet"
  ADD CONSTRAINT "ProgramSlotSet_first_set_no_load_step"
  CHECK ("order" > 0 OR "loadStepPercent" IS NULL);

-- A drop of 100% or more is no bar at all. One comparison against a nullable
-- column, so a null passes.
ALTER TABLE "ProgramSlotSet"
  ADD CONSTRAINT "ProgramSlotSet_load_step_above_minus_100"
  CHECK ("loadStepPercent" > -100);
