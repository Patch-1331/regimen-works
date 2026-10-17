-- Let an authored program be run with no end (DN-154).
--
-- The DN-137 verdict: a program's length is chosen when the athlete enrols,
-- and "open-ended" is one of the choices. Only for authored programs; a
-- curated bounded one keeps its required length, and Just WODs, which has no
-- bounds, stays open-ended only.

-- AlterTable
ALTER TABLE "Program" ADD COLUMN "allowsNoEnd" BOOLEAN NOT NULL DEFAULT false;

-- Every program already authored in the app gets it, as a new one would.
-- That is every program with a length except the two seeded first programs
-- DN-144 retired, which were curated: the global library has started empty
-- since (ADR 0006, decision 3), so nothing else bounded was ever seeded.
-- Their ids kept the `plan_` prefix through the DN-176 rename. On a fresh
-- database this matches nothing.
UPDATE "Program"
SET "allowsNoEnd" = true
WHERE "minWeeks" IS NOT NULL
  AND "id" NOT IN ('plan_pull_up_builder', 'plan_foundations');
