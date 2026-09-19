-- DN-19: the prescription on a `movements` day. One new table, nothing else
-- touched.
--
-- Everything above the "Constraints Prisma cannot express" line is what
-- `prisma migrate diff` generated from schema.prisma. Everything below it is
-- hand-written and invisible to the schema file: `prisma migrate dev` will
-- offer to drop those on the next change to this model. Don't accept that --
-- the same warning the DN-9 migration carries applies here.

-- CreateTable
CREATE TABLE "PlanSlotMovement" (
    "id" TEXT NOT NULL,
    "planSlotId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "line" TEXT,
    "exerciseId" TEXT,
    "sets" INTEGER NOT NULL,
    "reps" INTEGER NOT NULL,
    "restSeconds" INTEGER NOT NULL,

    CONSTRAINT "PlanSlotMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlanSlotMovement_planSlotId_order_key" ON "PlanSlotMovement"("planSlotId", "order");

-- AddForeignKey
ALTER TABLE "PlanSlotMovement" ADD CONSTRAINT "PlanSlotMovement_planSlotId_fkey" FOREIGN KEY ("planSlotId") REFERENCES "PlanSlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanSlotMovement" ADD CONSTRAINT "PlanSlotMovement_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Constraints Prisma cannot express
-- ---------------------------------------------------------------------------

-- Exactly one of `line` / `exerciseId`. Both halves matter, and neither is a
-- style preference:
--
--   * neither set is a prescribed movement with no movement in it, which
--     leaves the athlete a set-and-rep count for nothing.
--   * both set is a disagreement nothing downstream can resolve -- "pull at
--     your rung" and "this exact exercise" are different instructions, and a
--     reader picking one would be guessing at the author's intent.
--
-- It also decides what happens when a pinned exercise is deleted. The foreign
-- key above is ON DELETE SET NULL, which alone would quietly empty the row;
-- with this CHECK the nulling fails and the delete is refused instead.
-- Archiving is the answer there, as it is everywhere else in this library
-- (DN-25).
ALTER TABLE "PlanSlotMovement"
  ADD CONSTRAINT "PlanSlotMovement_line_xor_exercise"
  CHECK (("line" IS NOT NULL) <> ("exerciseId" IS NOT NULL));

-- A prescription that prescribes something. Zero sets or zero reps is not a
-- lighter day, it is a row that should not have been written; a negative one
-- is nonsense the rest of the stack would carry into arithmetic. Rest is
-- allowed to be 0 -- that says "straight through" -- but not negative.
ALTER TABLE "PlanSlotMovement"
  ADD CONSTRAINT "PlanSlotMovement_counts_positive"
  CHECK ("sets" >= 1 AND "reps" >= 1 AND "restSeconds" >= 0);

-- Not expressible here, and enforced in `resolveProgramDay` instead: only a
-- `movements` slot may carry these rows. `PlanSlot.kind` is on another table,
-- which no CHECK can reach. A slot of some other kind carrying a prescription
-- is ignored rather than obeyed, and a `movements` slot carrying none falls
-- back to a generated WOD rather than handing the athlete an empty day.
