-- A prescribed count in three shapes: fixed, a range, or until failure (DN-142).
--
-- ADR 0005 has the reasoning. The short version is that `reps INTEGER NOT NULL`
-- assumes the only author this app has ever had -- the seed, written in
-- TypeScript with a compiler watching. Measured against a routine written
-- outside it, 12 of 25 prescriptions are ranges and 1 is "until failure", and
-- storing a range as its floor is a silent edit of what the source said.

-- AlterTable
ALTER TABLE "PlanSlotMovement" ALTER COLUMN "reps" DROP NOT NULL;
ALTER TABLE "PlanSlotMovement" ADD COLUMN "repsMax" INTEGER;
ALTER TABLE "PlanSlotMovement" ADD COLUMN "toFailure" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "WorkoutSetLog" ALTER COLUMN "prescribedReps" DROP NOT NULL;
ALTER TABLE "WorkoutSetLog" ALTER COLUMN "actualReps" DROP NOT NULL;
ALTER TABLE "WorkoutSetLog" ADD COLUMN "prescribedRepsMax" INTEGER;
ALTER TABLE "WorkoutSetLog" ADD COLUMN "prescribedToFailure" BOOLEAN NOT NULL DEFAULT false;

-- Constraints Prisma cannot express
--
-- The old `counts_positive` CHECK named `reps` while the column was NOT NULL.
-- It has to go, and not because it would now reject anything -- it would not.
-- `TRUE AND NULL` is NULL, and a CHECK only fails on FALSE, so a failure row
-- would slip past a constraint that appears to be guarding it. A rule that
-- silently stops applying is worse than no rule, so `reps` moves to the shape
-- CHECK below, which handles every case deliberately.
ALTER TABLE "PlanSlotMovement" DROP CONSTRAINT "PlanSlotMovement_counts_positive";

ALTER TABLE "PlanSlotMovement"
  ADD CONSTRAINT "PlanSlotMovement_counts_positive"
  CHECK ("sets" >= 1 AND "restSeconds" >= 0);

-- Exactly three shapes are legal, and nothing else is:
--
--   fixed    reps set,  repsMax null,        toFailure false
--   range    reps set,  repsMax set > reps,  toFailure false
--   failure  reps null, repsMax null,        toFailure true
--
-- Spelled as three explicit alternatives rather than as a clever combination
-- of null-checks, because the next person to read it needs to see the three
-- shapes themselves, not derive them. The same reason
-- `PlanSlotMovement_line_xor_exercise` is written as an `<>` of two null tests
-- rather than folded into the columns.
--
-- Every branch opens with `IS NOT NULL` on the columns it then compares, and
-- that is not belt-and-braces: it is the same trap that retires
-- `counts_positive` above, one line further down. `NULL >= 1` is NULL, not
-- false, and `FALSE OR NULL` is NULL, which a CHECK accepts. Without those
-- guards a row with a `repsMax` and no `reps` -- a range with no bottom --
-- makes every branch false-or-null and is admitted.
--
-- A range is `repsMax > reps` and never `>=`: 8-8 is a fixed prescription
-- written the long way, and admitting both spellings would mean two rows that
-- say the same thing and sort differently.
ALTER TABLE "PlanSlotMovement"
  ADD CONSTRAINT "PlanSlotMovement_rep_shape"
  CHECK (
    ("reps" IS NOT NULL AND "reps" >= 1
      AND "repsMax" IS NULL AND "toFailure" = false)
    OR ("reps" IS NOT NULL AND "reps" >= 1
      AND "repsMax" IS NOT NULL AND "repsMax" > "reps" AND "toFailure" = false)
    OR ("reps" IS NULL AND "repsMax" IS NULL AND "toFailure" = true)
  );

-- The set log carries the same three shapes, but as a **snapshot** of a row
-- that was already checked when it was written -- so it gets the range's
-- ordering rule and nothing more. A stricter CHECK here would be a second
-- authority on a fact this table does not own, and the one thing it can
-- usefully refuse is a max below its own minimum.
--
-- `prescribedReps_positive` and `actualReps_nonnegative` from the set log's own
-- migration still stand: both are now comparisons against a nullable column,
-- and both go on doing their job for every row that has a number in it.
ALTER TABLE "WorkoutSetLog"
  ADD CONSTRAINT "WorkoutSetLog_prescribedRepsMax_above_min"
  CHECK (
    "prescribedRepsMax" IS NULL
    OR ("prescribedReps" IS NOT NULL AND "prescribedRepsMax" > "prescribedReps")
  );
