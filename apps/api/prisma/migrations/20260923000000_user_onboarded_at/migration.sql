-- The first-run setup wizard's gate (DN-15).
--
-- Null means "has not finished setup". Setup stamps it last, in the same
-- transaction that writes the chosen program, so an athlete who closes the
-- app midway starts the wizard over rather than training a program they
-- never confirmed.
ALTER TABLE "User" ADD COLUMN "onboardedAt" TIMESTAMP(3);

-- Everyone who already has an account chose their program before the wizard
-- existed, or accepted the default by training on it. Sending them back
-- through setup would ask them to re-answer questions they have answered by
-- using the app, so they are onboarded as of this migration.
UPDATE "User" SET "onboardedAt" = NOW();
