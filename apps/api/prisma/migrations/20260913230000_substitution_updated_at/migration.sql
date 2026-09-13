-- DN-88: order two swaps on the same line by when they were chosen.
--
-- The completion screen used to break that tie by taking the higher rung,
-- reasoning that "someone who did both chin-ups and negatives did chin-ups".
-- That is an inference about ability, which is exactly what this project takes
-- out of the app. The honest tie-break is the one they picked most recently,
-- and createdAt cannot give it: the swap write is an upsert, so correcting a
-- swap leaves the original createdAt in place.
--
-- Existing rows are backfilled from createdAt, which is the best available
-- answer and correct for every row swapped only once.
ALTER TABLE "AssignmentSubstitution" ADD COLUMN "updatedAt" TIMESTAMP(3);
UPDATE "AssignmentSubstitution" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;
ALTER TABLE "AssignmentSubstitution" ALTER COLUMN "updatedAt" SET NOT NULL;
