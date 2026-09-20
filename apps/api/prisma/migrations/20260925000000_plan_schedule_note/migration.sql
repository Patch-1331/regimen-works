-- Why a program's week is laid out the way it is, in the author's own words
-- (DN-124). Shown at enrollment, where a fixed program takes the athlete's
-- day picker away for the run.
--
-- Nullable with no default and no backfill: a program with nothing particular
-- to say about its week says nothing, and a generated sentence would be the
-- app putting words in an author's mouth.
ALTER TABLE "Plan" ADD COLUMN "scheduleNote" TEXT;
