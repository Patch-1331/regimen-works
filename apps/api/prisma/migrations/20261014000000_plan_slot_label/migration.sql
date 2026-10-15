-- A routine's day can carry a name (DN-155), shown on Today beside the
-- week's label. Nullable: every existing day, and every day of an authored
-- program, is known by its weekday alone.
ALTER TABLE "PlanSlot" ADD COLUMN "label" TEXT;
