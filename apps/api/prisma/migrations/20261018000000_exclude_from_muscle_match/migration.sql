-- DN-174: a movement a person has kept off the muscle match. The library
-- import writes it from the curation file; every athlete-owned row keeps the
-- default.
ALTER TABLE "Exercise" ADD COLUMN "excludeFromMuscleMatch" BOOLEAN NOT NULL DEFAULT false;
