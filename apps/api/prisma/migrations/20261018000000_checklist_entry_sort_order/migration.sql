-- DN-173: an athlete orders their own warm-up and cool-down entries.
--
-- Global entries keep 0 and are read in seed order. Athlete entries that
-- already exist (migrated from `Exercise.phase` in 20261012000000) are
-- numbered in the order they were written, so nothing on anyone's list moves.
--
-- Written by hand: `prisma migrate dev` would also offer to drop the partial
-- unique indexes on this table, which live only in migrations. Keep them.
ALTER TABLE "ChecklistEntry" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

UPDATE "ChecklistEntry" AS e
SET "sortOrder" = numbered.position
FROM (
  SELECT "id",
         ROW_NUMBER() OVER (
           PARTITION BY "ownerId", "kind"
           ORDER BY "createdAt", "id"
         ) - 1 AS position
  FROM "ChecklistEntry"
  WHERE "ownerId" IS NOT NULL
) AS numbered
WHERE e."id" = numbered."id";
