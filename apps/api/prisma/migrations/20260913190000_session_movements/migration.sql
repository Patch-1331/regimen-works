-- Snapshot the resolved movements onto the session (DN-90).
--
-- A WOD is resolved at read time -- the athlete's current rung, then the
-- day's swaps -- and none of the result was stored. AssignmentSubstitution
-- records only the days the athlete changed something; every other day was
-- recomputed from state that keeps moving, so changing a default next month
-- silently rewrote what every past session "used". WorkoutSession already
-- snapshots capSeconds and autoStopAtCap at start for exactly this reason;
-- the movement list was simply missed.
--
-- jsonb rather than JSON-in-text, as roundSplits is, so the database itself
-- rejects a malformed write. The default leaves existing sessions with an
-- empty list: those predate collection and there is no honest way to fill
-- them in -- a backfill from today's rungs is precisely the inference this
-- column exists to replace.

ALTER TABLE "WorkoutSession" ADD COLUMN "movements" JSONB NOT NULL DEFAULT '[]'::jsonb;
