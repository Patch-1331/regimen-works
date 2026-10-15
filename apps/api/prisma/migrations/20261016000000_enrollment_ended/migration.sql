-- End the current run when the athlete starts another program (DN-178).
--
-- ADR 0009, decision 1. A run is now `active`, `completed` or `ended`, and an
-- ended run records when. Nothing is backfilled: until this migration a
-- switch rewrote the run in place, so no row has ever been ended.

-- AlterTable
ALTER TABLE "ProgramEnrollment" ADD COLUMN "endedAt" TIMESTAMP(3);
