-- DN-9: the program schema. Four new models plus three columns on
-- DailyAssignment. No behaviour change -- nothing reads any of this yet.
--
-- It lands ahead of the code on purpose. "Just WODs is itself a program"
-- (docs/design/programs.md) only pays for itself if `getToday` can be
-- rewritten with one path instead of an `if (enrolled) … else …` that would
-- spread into the scheduler, the today response, History and Stats -- and
-- that rewrite (DN-16) needs a Plan to already exist to resolve against.
--
-- Everything above the "Constraints Prisma cannot express" line is what
-- `prisma migrate diff` generated from schema.prisma. Everything below it is
-- hand-written and invisible to the schema file: `prisma migrate dev` will
-- offer to drop those on the next change to any of these models. Don't accept
-- that -- the same warning the DN-93 migration carries about its partial
-- index applies to all four here.

-- AlterTable
ALTER TABLE "DailyAssignment" ADD COLUMN     "enrollmentId" TEXT,
ADD COLUMN     "planDayIndex" INTEGER,
ADD COLUMN     "planSlotId" TEXT;

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "goal" TEXT,
    "scheduleMode" TEXT NOT NULL,
    "minDaysPerWeek" INTEGER,
    "maxDaysPerWeek" INTEGER,
    "defaultDays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "minWeeks" INTEGER,
    "maxWeeks" INTEGER,
    "defaultWeeks" INTEGER,
    "ownerId" TEXT,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanWeek" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "phase" TEXT NOT NULL,
    "label" TEXT,

    CONSTRAINT "PlanWeek_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanSlot" (
    "id" TEXT NOT NULL,
    "planWeekId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "wodId" TEXT,
    "pattern" TEXT,
    "wodType" TEXT,
    "allowNamed" BOOLEAN NOT NULL DEFAULT false,
    "maxTimeCapMinutes" INTEGER,

    CONSTRAINT "PlanSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanEnrollment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "weeks" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "startingRungs" JSONB NOT NULL DEFAULT '{}',
    "summary" JSONB,

    CONSTRAINT "PlanEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Plan_ownerId_name_key" ON "Plan"("ownerId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "PlanWeek_planId_order_key" ON "PlanWeek"("planId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "PlanSlot_planWeekId_dayOfWeek_key" ON "PlanSlot"("planWeekId", "dayOfWeek");

-- CreateIndex
CREATE UNIQUE INDEX "PlanEnrollment_id_userId_key" ON "PlanEnrollment"("id", "userId");

-- AddForeignKey
ALTER TABLE "DailyAssignment" ADD CONSTRAINT "DailyAssignment_enrollmentId_userId_fkey" FOREIGN KEY ("enrollmentId", "userId") REFERENCES "PlanEnrollment"("id", "userId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "DailyAssignment" ADD CONSTRAINT "DailyAssignment_planSlotId_fkey" FOREIGN KEY ("planSlotId") REFERENCES "PlanSlot"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanWeek" ADD CONSTRAINT "PlanWeek_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanSlot" ADD CONSTRAINT "PlanSlot_planWeekId_fkey" FOREIGN KEY ("planWeekId") REFERENCES "PlanWeek"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanSlot" ADD CONSTRAINT "PlanSlot_wodId_fkey" FOREIGN KEY ("wodId") REFERENCES "Wod"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanEnrollment" ADD CONSTRAINT "PlanEnrollment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanEnrollment" ADD CONSTRAINT "PlanEnrollment_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Constraints Prisma cannot express
-- ---------------------------------------------------------------------------

-- At most one active enrollment per athlete. Without this, two tabs racing on
-- "Start program" both succeed and the athlete has two programs claiming the
-- same day -- and `getToday`, which reads "the active enrollment", would have
-- to pick one arbitrarily.
--
-- Partial rather than a plain unique over ("userId", status): completed
-- enrollments are a list the athlete keeps (DN-18), and several of those must
-- be allowed to coexist. Only the `active` row is exclusive.
CREATE UNIQUE INDEX "plan_enrollment_one_active_per_user"
  ON "PlanEnrollment" ("userId") WHERE "status" = 'active';

-- Global plan names are unique, athlete-owned ones are unique per athlete.
-- The compound UNIQUE ("ownerId", "name") above covers the second, and cannot
-- cover the first: Postgres treats NULLs as distinct, so it would accept two
-- global plans both called "Just WODs" -- which the seed's upsert keyed on
-- name is the only guard against. Exactly the split DN-93 made for Exercise
-- and Wod, and for the same reason.
CREATE UNIQUE INDEX "Plan_global_name_key"
  ON "Plan" ("name") WHERE "ownerId" IS NULL;

-- A pinned day has something pinned, and nothing else does. Both halves
-- matter: a wod_pinned slot with a null wodId gives the athlete a program day
-- with no workout, and a rest day pointing at a WOD is a disagreement about
-- what the day is that nothing downstream can resolve.
--
-- This also decides what happens when a pinned WOD is deleted. The foreign
-- key above is ON DELETE SET NULL, which on its own would quietly empty the
-- slot; with this CHECK the nulling fails and the delete is refused instead.
-- Archiving is the answer there, as it is everywhere else in this library.
ALTER TABLE "PlanSlot"
  ADD CONSTRAINT "PlanSlot_pinned_wod_present"
  CHECK (("kind" = 'wod_pinned') = ("wodId" IS NOT NULL));

-- The two schedule modes stay distinguishable. A fixed program's slot layout
-- IS its schedule, so a days-per-week range is not a thing it can have; a
-- flexible one is unusable without both bounds, because the cadence picker
-- has nothing to bound the athlete's choice with.
--
-- Written as two implications rather than a CASE so each mode's rule reads on
-- its own line.
ALTER TABLE "Plan"
  ADD CONSTRAINT "Plan_schedule_mode_bounds"
  CHECK (
    ("scheduleMode" = 'fixed'
      AND "minDaysPerWeek" IS NULL AND "maxDaysPerWeek" IS NULL)
    OR
    ("scheduleMode" = 'flexible'
      AND "minDaysPerWeek" IS NOT NULL AND "maxDaysPerWeek" IS NOT NULL)
  );
