-- DN-183: a movement group is unordered (ADR 0004, amended). The swap panel
-- ranks by muscle match (DN-170) and every list of a group's members is by
-- name, so the column ordered nothing but was still required of every member.
--
-- Session snapshots (`WorkoutSession.movements`, JSON) keep the key on rows
-- written before this; the shared schema strips it on read.
ALTER TABLE "Exercise" DROP COLUMN "sortOrder";
