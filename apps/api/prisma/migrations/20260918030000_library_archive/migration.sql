-- Soft delete for both library models (DN-25).
--
-- Archive rather than delete, because these rows are referenced from an
-- athlete's own history: a `WodMovement` names an exercise, an
-- `AssignmentSubstitution` names the one they swapped to. A hard delete would
-- either be blocked by those foreign keys or take the movement's name out of a
-- workout the athlete actually did.
--
-- Nullable timestamp rather than a boolean: "when" answers "whether", and an
-- un-archive is a write of NULL rather than a second column to keep in step.
--
-- `Wod.archivedAt` has no endpoint writing it yet -- that is DN-26. It lands
-- here with Exercise's because `libraryVisibleTo()` filters both models
-- through one clause, and splitting the column across two migrations would
-- mean that helper quietly meaning something different depending on which
-- model the caller had in hand.
ALTER TABLE "Exercise" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "Wod" ADD COLUMN "archivedAt" TIMESTAMP(3);

-- Deliberately NOT indexed. Every read that filters on it is already narrowed
-- by ownership, both tables are small (tens of rows), and an index that only
-- ever discriminates "almost all" from "almost none" earns nothing.
--
-- Deliberately NOT part of the unique constraints either. Archiving does not
-- free a name: (ownerId, name) and the partial global-name index both still
-- count an archived row, so re-using its name means un-archiving it rather
-- than creating a second row that would have to be told apart from the first.
