-- AlterTable
ALTER TABLE "AssignmentSubstitution" ADD COLUMN     "planSlotMovementId" TEXT,
ALTER COLUMN "wodMovementId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "AssignmentSubstitution_assignmentId_planSlotMovementId_key" ON "AssignmentSubstitution"("assignmentId", "planSlotMovementId");

-- AddForeignKey
ALTER TABLE "AssignmentSubstitution" ADD CONSTRAINT "AssignmentSubstitution_planSlotMovementId_fkey" FOREIGN KEY ("planSlotMovementId") REFERENCES "PlanSlotMovement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Constraints Prisma cannot express
--
-- A swap names exactly one movement (DN-125). Both columns were one NOT NULL
-- column until a program day could be straight sets rather than a WOD; making
-- it nullable without this would let a row name neither, which is a swap
-- attached to nothing, and a schema that permits it will eventually hold one.
-- Both set is two movements and no way to tell which the athlete tapped.
--
-- The uniqueness rule -- one swap per movement per day -- is carried by the
-- two composite unique indexes above rather than by a partial index each.
-- Postgres treats NULLs as distinct, so each index constrains exactly the rows
-- that carry its column and ignores the rest, which is what a partial index
-- would have said; unlike a partial index, Prisma can see these, so the two
-- upserts keep a compound key to write against.
ALTER TABLE "AssignmentSubstitution"
  ADD CONSTRAINT "AssignmentSubstitution_movement_xor"
  CHECK (("wodMovementId" IS NOT NULL) <> ("planSlotMovementId" IS NOT NULL));
