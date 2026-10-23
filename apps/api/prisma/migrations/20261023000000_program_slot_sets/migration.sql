-- A program line's sets move onto rows of their own (DN-190, ADR 0011).
--
-- A line held `sets` and one rep shape, so every set of it was the same. ADR
-- 0011 makes a line an ordered list of sets, each with its own count and rest.
-- This migration changes the storage only: every existing line becomes `sets`
-- identical rows carrying its count and rest, and nothing an athlete sees
-- changes. The feature that varies them is DN-186.
--
-- Production is the only deployed environment, and this rewrites every program
-- line there. `program-slot-sets.migration.db-spec.ts` replays section 2 on a
-- line of each rep shape and on null and 0 rest.
--
-- Sections 1 and 3 are what `prisma migrate diff` generates from the schema,
-- except the CHECKs, which Prisma cannot express and will offer to drop on the
-- next change to this model. Don't accept that.
--
-- One transaction, which Prisma does not open on its own: a failure after the
-- copy and before the drop would otherwise leave every line stored twice.
BEGIN;

-- 1. The table, and the two rules each set keeps from the line.
CREATE TABLE "ProgramSlotSet" (
    "id" TEXT NOT NULL,
    "programSlotMovementId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "reps" INTEGER,
    "repsMax" INTEGER,
    "toFailure" BOOLEAN NOT NULL DEFAULT false,
    "restSeconds" INTEGER,

    CONSTRAINT "ProgramSlotSet_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProgramSlotSet_programSlotMovementId_order_key" ON "ProgramSlotSet"("programSlotMovementId", "order");

ALTER TABLE "ProgramSlotSet" ADD CONSTRAINT "ProgramSlotSet_programSlotMovementId_fkey" FOREIGN KEY ("programSlotMovementId") REFERENCES "ProgramSlotMovement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ADR 0005's three shapes, now on each set (ADR 0011, decision 2). The same
-- CHECK `20260929000000_prescribed_rep_shapes` put on the line, word for word,
-- and for the same reasons: every branch opens with `IS NOT NULL` on what it
-- compares, because `NULL >= 1` is NULL and a CHECK admits NULL.
--
--   fixed    reps set,  repsMax null,        toFailure false
--   range    reps set,  repsMax set > reps,  toFailure false
--   failure  reps null, repsMax null,        toFailure true
--
-- Mirrored by `refineRepShape` in packages/shared/src/rep-shape.ts.
ALTER TABLE "ProgramSlotSet"
  ADD CONSTRAINT "ProgramSlotSet_rep_shape"
  CHECK (
    ("reps" IS NOT NULL AND "reps" >= 1
      AND "repsMax" IS NULL AND "toFailure" = false)
    OR ("reps" IS NOT NULL AND "reps" >= 1
      AND "repsMax" IS NOT NULL AND "repsMax" > "reps" AND "toFailure" = false)
    OR ("reps" IS NULL AND "repsMax" IS NULL AND "toFailure" = true)
  );

-- Null rest is "the source was silent" and 0 is "straight through" (ADR 0005).
-- One comparison against a nullable column, so a null passes and a negative
-- does not. The line's `counts_positive` held `sets >= 1` beside it; a line
-- with no sets is now a line with no rows here, which the line's own readers
-- refuse.
ALTER TABLE "ProgramSlotSet"
  ADD CONSTRAINT "ProgramSlotSet_restSeconds_nonnegative"
  CHECK ("restSeconds" >= 0);

-- 2. Every line becomes `sets` identical rows, numbered from 0.
--
--    Copied column for column, so a null rest stays null and a 0 stays 0:
--    nothing here may turn one into the other. `counts_positive` held
--    `sets >= 1` on every line, so every line gets at least one row.
INSERT INTO "ProgramSlotSet" ("id", "programSlotMovementId", "order", "reps", "repsMax", "toFailure", "restSeconds")
SELECT
  gen_random_uuid()::text, m."id", s."order", m."reps", m."repsMax", m."toFailure", m."restSeconds"
FROM "ProgramSlotMovement" m
CROSS JOIN LATERAL generate_series(0, m."sets" - 1) AS s("order");

-- 3. The line keeps what it names and where it sits, and nothing else.
ALTER TABLE "ProgramSlotMovement" DROP CONSTRAINT "ProgramSlotMovement_counts_positive";
ALTER TABLE "ProgramSlotMovement" DROP CONSTRAINT "ProgramSlotMovement_rep_shape";

ALTER TABLE "ProgramSlotMovement" DROP COLUMN "sets",
DROP COLUMN "reps",
DROP COLUMN "repsMax",
DROP COLUMN "toFailure",
DROP COLUMN "restSeconds";

COMMIT;
