-- DN-12: ScheduleRule.trainingDays replaces the maxDaysPerWeek quota.
--
-- Weekday numbering is Date.getUTCDay()'s: 0 = Sunday … 6 = Saturday. The full
-- statement of it lives on `trainingDaysSchema` in packages/shared.

ALTER TABLE "ScheduleRule"
  ADD COLUMN "trainingDays" INTEGER[] NOT NULL DEFAULT ARRAY[1, 2, 3, 4, 5];

-- Spread each athlete's existing quota across the week, so nobody's schedule
-- changes shape on deploy. A table rather than arithmetic: these are the days
-- a person would pick, and two of them are not what even division gives —
-- 2 days is Mon/Thu (an even split of the week), not Mon/Tue, and 4 days is
-- Mon/Tue/Thu/Fri (the two-on, one-off shape lifters actually run) rather
-- than Mon–Thu. The ELSE is unreachable through the CHECK-free column's 1–7
-- range but is spelled out anyway, because a silent empty array here would
-- read downstream as "trains no days".
UPDATE "ScheduleRule" SET "trainingDays" = CASE "maxDaysPerWeek"
  WHEN 1 THEN ARRAY[1]                 -- Mon
  WHEN 2 THEN ARRAY[1, 4]              -- Mon, Thu
  WHEN 3 THEN ARRAY[1, 3, 5]           -- Mon, Wed, Fri
  WHEN 4 THEN ARRAY[1, 2, 4, 5]        -- Mon, Tue, Thu, Fri
  WHEN 5 THEN ARRAY[1, 2, 3, 4, 5]     -- Mon–Fri
  WHEN 6 THEN ARRAY[1, 2, 3, 4, 5, 6]  -- Mon–Sat
  WHEN 7 THEN ARRAY[0, 1, 2, 3, 4, 5, 6]
  ELSE ARRAY[1, 2, 3, 4, 5]
END;

-- Dropped in the same migration that reads it, so there is never a deploy in
-- which both columns are live and able to disagree about the same fact. Safe
-- to drop rather than deprecate: the value is recoverable at any time as
-- array_length("trainingDays", 1), so nothing is lost that cannot be derived.
ALTER TABLE "ScheduleRule" DROP COLUMN "maxDaysPerWeek";
