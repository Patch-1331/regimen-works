-- DN-93: `Exercise` and `Wod` gain an owner, splitting the library into two
-- tiers. They were the only two models with no owner at all, which was fine
-- while nothing could write them -- the seed was the only author. It stops
-- being fine the moment DN-25/DN-26 ship write endpoints, because a row an
-- athlete creates would otherwise land in every other athlete's scheduler.
--
--   "ownerId" IS NULL -- global content. Seeded, admin-curated, read by all.
--   "ownerId" set     -- that athlete's own. Read and written only by them.
--
-- Every existing row is global, so the column is added nullable with no
-- backfill and no athlete's workouts change. What changes is that every read
-- of these tables is now scoped; see `libraryVisibleTo` in
-- apps/api/src/library/visible-to.ts.

ALTER TABLE "Exercise" ADD COLUMN "ownerId" TEXT;
ALTER TABLE "Wod" ADD COLUMN "ownerId" TEXT;

-- Cascade, so deleting an athlete takes their library with them. Their
-- DailyAssignment rows cascade from the same delete, and any that outrace it
-- have "wodId" set to NULL by the existing optional FK rather than blocking
-- the delete -- so the order Postgres happens to run the two cascades in
-- does not matter.
ALTER TABLE "Exercise"
  ADD CONSTRAINT "Exercise_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Wod"
  ADD CONSTRAINT "Wod_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The global name index has to be rebuilt in two halves.
--
-- A single `UNIQUE ("ownerId", "name")` is not enough on its own: Postgres
-- treats NULLs as distinct, so with the old global unique dropped it would
-- happily accept two global rows both named "Push-up" -- and the seed's
-- upsert keyed on name is the only thing standing between a re-seed and a
-- duplicated library. So the compound constraint covers the athlete tier, and
-- a partial unique index covers the global one.
--
-- The partial index cannot be expressed in schema.prisma. It exists only
-- here, and `prisma migrate dev` will propose dropping it on the next change
-- to either model. Don't accept that.
DROP INDEX "Exercise_name_key";
DROP INDEX "Wod_name_key";

CREATE UNIQUE INDEX "Exercise_ownerId_name_key" ON "Exercise"("ownerId", "name");
CREATE UNIQUE INDEX "Wod_ownerId_name_key" ON "Wod"("ownerId", "name");

CREATE UNIQUE INDEX "Exercise_global_name_key" ON "Exercise"("name") WHERE "ownerId" IS NULL;
CREATE UNIQUE INDEX "Wod_global_name_key" ON "Wod"("name") WHERE "ownerId" IS NULL;
