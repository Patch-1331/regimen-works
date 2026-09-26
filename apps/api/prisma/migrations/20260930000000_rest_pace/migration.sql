-- Rest a source did not state, and the pace the athlete trains at (DN-143).
--
-- ADR 0005 decisions 3 and 4. `restSeconds INTEGER NOT NULL` assumed the only
-- author this app has had -- the seed, in TypeScript. The routine DN-131
-- measured states rest 0 times in 25 movements, so transcribing it meant
-- inventing 25 numbers. Null now says "the source was silent", and 0 keeps
-- saying "straight through": different facts, never converted into each other.
--
-- What the athlete actually rests is theirs, set once when they commit to the
-- routine, and it lives on the run rather than on the routine or the user.

-- AlterTable
ALTER TABLE "PlanSlotMovement" ALTER COLUMN "restSeconds" DROP NOT NULL;

-- AlterTable
ALTER TABLE "PlanEnrollment" ADD COLUMN "defaultRestSeconds" INTEGER;

-- Constraints Prisma cannot express
--
-- `counts_positive` is rewritten rather than left standing, for the reason
-- DN-142 retired its first version: `"sets" >= 1 AND NULL` is NULL, and a
-- CHECK only fails on FALSE. Left as it was, a null rest would not just pass
-- its own half -- it would switch off the `sets` guard on the same row.
ALTER TABLE "PlanSlotMovement" DROP CONSTRAINT "PlanSlotMovement_counts_positive";

ALTER TABLE "PlanSlotMovement"
  ADD CONSTRAINT "PlanSlotMovement_counts_positive"
  CHECK ("sets" >= 1 AND ("restSeconds" IS NULL OR "restSeconds" >= 0));

-- A single comparison against a nullable column, so the NULL-passes rule is
-- exactly the one wanted: no pace set is allowed, a negative one is not.
ALTER TABLE "PlanEnrollment"
  ADD CONSTRAINT "PlanEnrollment_defaultRestSeconds_nonnegative"
  CHECK ("defaultRestSeconds" >= 0);
