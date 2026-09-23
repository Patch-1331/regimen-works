-- An athlete's standing choice is a movement, not a position in a list
-- (DN-139, ADR-0004 decisions 2, 3, 6, 7 and 8).

-- 1. `rung` only ever ordered a list. Say so.
ALTER TABLE "Exercise" RENAME COLUMN "rung" TO "sortOrder";

-- 2. The group's default member, prescribed to an athlete who has not chosen
--    and to one whose choice they cannot perform today.
--
--    Seeded here as the lowest-ordered member of each group, which is exactly
--    what `STARTING_RUNG = 0` resolved to, so this migration changes nobody's
--    prescription. The seed then declares the real default and its upsert
--    corrects this: the migration's job is to preserve behaviour, the seed's
--    is to state intent.
ALTER TABLE "Exercise" ADD COLUMN "isGroupDefault" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Exercise" e
SET "isGroupDefault" = true
WHERE e."ownerId" IS NULL
  AND e."movementGroup" IS NOT NULL
  AND e."archivedAt" IS NULL
  AND e."id" = (
    SELECT c."id"
    FROM "Exercise" c
    WHERE c."movementGroup" = e."movementGroup"
      AND c."ownerId" IS NULL
      AND c."archivedAt" IS NULL
    -- `sortOrder` first, then id, so the choice is deterministic even where
    -- two members share a number.
    ORDER BY c."sortOrder" ASC NULLS LAST, c."id" ASC
    LIMIT 1
  );

-- At most one default per group. Prisma cannot express a partial unique index,
-- so this lives only here and `prisma migrate dev` will offer to drop it on the
-- next model change. Keep it.
CREATE UNIQUE INDEX "Exercise_group_default_key"
  ON "Exercise"("movementGroup") WHERE "isGroupDefault";

-- 3. The stored choice becomes a foreign key, resolved once through the
--    `(movementGroup, rung)` pair the seed numbers densely today. This is a
--    one-shot resolution, not a fallback that lives on: after it, nothing in
--    the app resolves a choice by number.
ALTER TABLE "SkillLevel" ADD COLUMN "exerciseId" TEXT;

UPDATE "SkillLevel" s
SET "exerciseId" = e."id"
FROM "Exercise" e
WHERE e."movementGroup" = s."movementGroup"
  AND e."sortOrder" = s."rung"
  AND e."ownerId" IS NULL;

-- A rung with no exercise at it is a choice the app has never been able to
-- honour: resolution misses it today and the athlete silently falls through to
-- whatever the library prescribed. Keeping it would need a nullable key, which
-- re-opens the absent-versus-unusable distinction ADR-0004 decision 7 exists to
-- collapse. The athlete re-picks in one tap.
DELETE FROM "SkillLevel" WHERE "exerciseId" IS NULL;

ALTER TABLE "SkillLevel" ALTER COLUMN "exerciseId" SET NOT NULL;
ALTER TABLE "SkillLevel" DROP COLUMN "rung";

ALTER TABLE "SkillLevel"
  ADD CONSTRAINT "SkillLevel_exerciseId_fkey"
  FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "SkillLevel_exerciseId_idx" ON "SkillLevel"("exerciseId");

-- The completion card's start-of-run snapshot, likewise by id rather than by
-- position. Existing snapshots are `{ group: rung }` and are resolved the same
-- way the SkillLevel rows above were; a pair that resolves to nothing is
-- dropped from its snapshot, which reports that group as unchanged rather than
-- as having moved from a movement nobody can name.
ALTER TABLE "PlanEnrollment" RENAME COLUMN "startingRungs" TO "startingMovements";

UPDATE "PlanEnrollment" p
SET "startingMovements" = COALESCE(
  (
    SELECT jsonb_object_agg(snap.key, e."id")
    FROM jsonb_each_text(p."startingMovements") AS snap(key, value)
    JOIN "Exercise" e
      ON e."movementGroup" = snap.key
     AND e."ownerId" IS NULL
     AND snap.value ~ '^[0-9]+$'
     AND e."sortOrder" = snap.value::int
  ),
  '{}'::jsonb
)
WHERE p."startingMovements" <> '{}'::jsonb;
