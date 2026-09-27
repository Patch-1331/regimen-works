-- Archive routines, and retire the seeded first programs (DN-144).
--
-- ADR 0006 decisions 3 and 5. Removing a routine archives it, for every tier:
-- the row leaves the picker, and a run already under way finishes on it.

-- AlterTable
ALTER TABLE "Plan" ADD COLUMN "archivedAt" TIMESTAMP(3);

-- Name uniqueness covers live rows only.
--
-- On Exercise and Wod an archived row keeps its name. A routine cannot: a
-- structural edit to one somebody has enrolled in forks it (decision 6), and
-- the fork keeps the name while the original is archived. Both indexes are
-- rebuilt as partial indexes over live rows, which Prisma cannot express --
-- the schema carries no @@unique for Plan, and `prisma migrate dev` will offer
-- to drop these. Keep them.
DROP INDEX "Plan_ownerId_name_key";
DROP INDEX "Plan_global_name_key";

CREATE UNIQUE INDEX "Plan_live_owned_name_key"
  ON "Plan" ("ownerId", "name") WHERE "archivedAt" IS NULL;

-- The owned index cannot cover the global tier: Postgres treats NULLs as
-- distinct, so ("ownerId", "name") would accept two live global plans of the
-- same name. The split DN-93 made for Exercise and Wod, now over live rows.
CREATE UNIQUE INDEX "Plan_live_global_name_key"
  ON "Plan" ("name") WHERE "ownerId" IS NULL AND "archivedAt" IS NULL;

-- Retire the seeded first programs (decision 3).
--
-- The seed no longer writes them, so this is the only place they are named.
-- A program nobody ever enrolled in is deleted outright: its weeks, slots and
-- movements cascade, and with no enrollment there is no assignment, session or
-- log that could point at any of them. A program somebody enrolled in --
-- active or completed -- is archived instead, so the run finishes and the
-- history keeps its name. On a fresh database both statements match nothing.
--
-- Just WODs (`plan_just_wods`) is not in this list and is untouched.
DELETE FROM "Plan" p
WHERE p."id" IN ('plan_pull_up_builder', 'plan_foundations')
  AND NOT EXISTS (SELECT 1 FROM "PlanEnrollment" e WHERE e."planId" = p."id");

UPDATE "Plan"
SET "archivedAt" = CURRENT_TIMESTAMP
WHERE "id" IN ('plan_pull_up_builder', 'plan_foundations');
