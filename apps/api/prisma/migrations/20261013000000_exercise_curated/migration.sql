-- Whether a person has curated the exercise (DN-169): one of the app's own,
-- or a dataset twin with a curation entry. The library import writes it; the
-- muscle-match substitute prefers a curated movement over an imported one
-- that scores the same. Every athlete-owned row is false.
ALTER TABLE "Exercise" ADD COLUMN "curated" BOOLEAN NOT NULL DEFAULT false;
