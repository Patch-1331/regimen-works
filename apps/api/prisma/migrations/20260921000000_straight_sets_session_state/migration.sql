-- AlterTable
ALTER TABLE "WorkoutSession" ADD COLUMN     "restStartedAtSeconds" INTEGER,
ADD COLUMN     "setsCompleted" INTEGER,
ALTER COLUMN "capSeconds" DROP NOT NULL;

-- Constraints Prisma cannot express
--
-- `capSeconds` drops NOT NULL rather than taking a 0 for an untimed session.
-- Every row that exists is a WOD session and keeps its cap; null from here on
-- means a straight-sets day (DN-20), which has no clock over it. A 0 would
-- have been cheaper and wrong in a way that shows: `wasCappedFinish` asks
-- whether the finish landed at or past the cap, so a zero cap makes every
-- prescribed session report itself as stopped by a clock the athlete never
-- saw.
--
-- `setsCompleted` is how many working sets are behind the athlete and
-- `restStartedAtSeconds` is the elapsed second the current rest began -- the
-- straight-sets counterparts to `intervalIndex` / `intervalStartedAtSeconds`,
-- written on every set so a locked phone resumes where it was.
--
-- Nothing here holds "a session has sets iff it has no cap". The two are
-- separate columns because the day's kind is not a column at all: it is
-- whether the assignment has a WOD, and a CHECK here would duplicate that fact
-- where it could drift from it. The xor that does get enforced is the one on
-- each snapshotted movement, in `sessionMovementSchema` -- jsonb, so it is the
-- parse that refuses a row joining back to both kinds of movement or neither.
ALTER TABLE "WorkoutSession"
  ADD CONSTRAINT "WorkoutSession_setsCompleted_nonnegative"
  CHECK ("setsCompleted" IS NULL OR "setsCompleted" >= 0);

ALTER TABLE "WorkoutSession"
  ADD CONSTRAINT "WorkoutSession_restStartedAtSeconds_nonnegative"
  CHECK ("restStartedAtSeconds" IS NULL OR "restStartedAtSeconds" >= 0);
