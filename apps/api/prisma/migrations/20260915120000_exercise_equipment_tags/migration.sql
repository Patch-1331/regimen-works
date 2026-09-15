-- DN-31: `Exercise.needsBar` becomes a tag set drawn from the shared equipment
-- catalog (DN-77), so a movement can require any piece of the expanded pool
-- rather than only the bar.
--
-- A TEXT[] rather than a join table: the set is tiny, it is read on every
-- scheduler pass alongside the exercise row itself, and a join buys nothing.
--
-- No athlete's workouts change. `needsBar: true` becomes `equipment: ['bar']`,
-- the bar stays part of the assumed baseline (DN-81 on defaults), and nothing
-- reads the column for scheduling yet -- `applyEquipmentAvailability` is DN-79.
--
-- Every row is backfilled explicitly, including to the empty array, so the
-- column holds no NULLs for a reader to disambiguate from "needs nothing".
ALTER TABLE "Exercise" ADD COLUMN "equipment" TEXT[] DEFAULT ARRAY[]::TEXT[];

UPDATE "Exercise"
SET "equipment" = CASE WHEN "needsBar" THEN ARRAY['bar'] ELSE ARRAY[]::TEXT[] END;

ALTER TABLE "Exercise" DROP COLUMN "needsBar";
