-- The fields the exercise library reads (DN-165, ADR-0007): a stable key, the
-- muscles a movement works, and the dataset's force, mechanic, level and
-- category. Instructions become numbered steps.
--
-- Every new column is empty or null on the rows that exist today. The import
-- that fills them is DN-167; this migration only makes room.

-- 1. Instructions: prose becomes a list of steps.
--
--    Each existing row's prose becomes its single step, unchanged, so no
--    athlete-visible copy moves. A null -- a row added outside the seed with no
--    copy yet -- becomes the empty list, which is the same answer in the new
--    shape. Empty prose is treated the same way rather than kept as one empty
--    step, which every screen would have to filter back out.
ALTER TABLE "Exercise"
  ALTER COLUMN "instructions" TYPE TEXT[]
  USING CASE
    WHEN "instructions" IS NULL OR btrim("instructions") = '' THEN ARRAY[]::TEXT[]
    ELSE ARRAY["instructions"]
  END;
ALTER TABLE "Exercise" ALTER COLUMN "instructions" SET DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Exercise" ALTER COLUMN "instructions" SET NOT NULL;

-- 2. The descriptive fields. Validated in the application, like `pattern`.
ALTER TABLE "Exercise"
  ADD COLUMN "key" TEXT,
  ADD COLUMN "primaryMuscles" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "secondaryMuscles" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "force" TEXT,
  ADD COLUMN "mechanic" TEXT,
  ADD COLUMN "level" TEXT,
  ADD COLUMN "category" TEXT;

-- 3. The key is the global library's identity, so it is unique among global
--    rows -- archived ones included: retiring a row does not free its identity,
--    or a re-import would create a second row for the same exercise instead of
--    finding the first.
--
--    Partial, so Prisma's schema cannot state it. Keep it when `prisma migrate
--    dev` offers to drop it.
CREATE UNIQUE INDEX "Exercise_key_global_key"
  ON "Exercise" ("key")
  WHERE "ownerId" IS NULL;

-- 4. And only global rows carry one. An athlete's own exercise is not in the
--    dataset and is never matched by the import; a key on it would be an
--    identity nothing reads, and one an import could collide with.
ALTER TABLE "Exercise"
  ADD CONSTRAINT "Exercise_key_global_only"
  CHECK ("ownerId" IS NULL OR "key" IS NULL);
