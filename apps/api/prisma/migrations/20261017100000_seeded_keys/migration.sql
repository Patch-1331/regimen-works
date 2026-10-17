-- Which global WODs and checklist entries the committed files own (DN-151,
-- ADR 0010), the way `Exercise.key` already says it for the library.
--
-- No backfill here. The seed import takes each key on its next run, finding
-- the row by the name it has today -- the way the library import took the
-- exercise keys (DN-167). A row the files do not name keeps a null key, and
-- the deploy leaves it alone.

ALTER TABLE "Wod" ADD COLUMN "key" TEXT;
ALTER TABLE "ChecklistEntry" ADD COLUMN "key" TEXT;

-- Unique among global rows, archived ones included: an identity is not freed
-- by retiring its row. Partial, so Prisma cannot express it -- keep it when
-- `prisma migrate dev` offers to drop it.
CREATE UNIQUE INDEX "Wod_key_global_key"
  ON "Wod" ("key")
  WHERE "ownerId" IS NULL;
CREATE UNIQUE INDEX "ChecklistEntry_key_global_key"
  ON "ChecklistEntry" ("key")
  WHERE "ownerId" IS NULL;

-- Never on an athlete's own row: no import writes one, and a key there would
-- be a claim the files own it.
ALTER TABLE "Wod"
  ADD CONSTRAINT "Wod_key_global_only"
  CHECK ("ownerId" IS NULL OR "key" IS NULL);
ALTER TABLE "ChecklistEntry"
  ADD CONSTRAINT "ChecklistEntry_key_global_only"
  CHECK ("ownerId" IS NULL OR "key" IS NULL);
