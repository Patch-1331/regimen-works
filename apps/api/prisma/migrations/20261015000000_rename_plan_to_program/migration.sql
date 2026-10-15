-- DN-176 (ADR 0009, decision 4): the Plan tables become Program, renamed in
-- place. Every statement here is a rename, never a drop and a create: this
-- runs against production, the only environment, and `prisma migrate dev`
-- would have diffed the same change as dropping every program, week, slot,
-- prescription and enrollment. Rows, ids and foreign keys are untouched;
-- Postgres carries the data, defaults and check expressions with each name.
--
-- Row ids are data and keep their values: Just WODs is still
-- "plan_just_wods", which every enrollment of it references.

-- Tables
ALTER TABLE "Plan" RENAME TO "Program";
ALTER TABLE "PlanWeek" RENAME TO "ProgramWeek";
ALTER TABLE "PlanSlot" RENAME TO "ProgramSlot";
ALTER TABLE "PlanSlotMovement" RENAME TO "ProgramSlotMovement";
ALTER TABLE "PlanEnrollment" RENAME TO "ProgramEnrollment";

-- Columns
ALTER TABLE "ProgramWeek" RENAME COLUMN "planId" TO "programId";
ALTER TABLE "ProgramSlot" RENAME COLUMN "planWeekId" TO "programWeekId";
ALTER TABLE "ProgramSlotMovement" RENAME COLUMN "planSlotId" TO "programSlotId";
ALTER TABLE "ProgramEnrollment" RENAME COLUMN "planId" TO "programId";
ALTER TABLE "DailyAssignment" RENAME COLUMN "planSlotId" TO "programSlotId";
ALTER TABLE "DailyAssignment" RENAME COLUMN "planDayIndex" TO "programDayIndex";
ALTER TABLE "AssignmentSubstitution" RENAME COLUMN "planSlotMovementId" TO "programSlotMovementId";

-- Primary keys (renaming the constraint renames its index)
ALTER TABLE "Program" RENAME CONSTRAINT "Plan_pkey" TO "Program_pkey";
ALTER TABLE "ProgramWeek" RENAME CONSTRAINT "PlanWeek_pkey" TO "ProgramWeek_pkey";
ALTER TABLE "ProgramSlot" RENAME CONSTRAINT "PlanSlot_pkey" TO "ProgramSlot_pkey";
ALTER TABLE "ProgramSlotMovement" RENAME CONSTRAINT "PlanSlotMovement_pkey" TO "ProgramSlotMovement_pkey";
ALTER TABLE "ProgramEnrollment" RENAME CONSTRAINT "PlanEnrollment_pkey" TO "ProgramEnrollment_pkey";

-- Foreign keys
ALTER TABLE "Program" RENAME CONSTRAINT "Plan_ownerId_fkey" TO "Program_ownerId_fkey";
ALTER TABLE "ProgramWeek" RENAME CONSTRAINT "PlanWeek_planId_fkey" TO "ProgramWeek_programId_fkey";
ALTER TABLE "ProgramSlot" RENAME CONSTRAINT "PlanSlot_planWeekId_fkey" TO "ProgramSlot_programWeekId_fkey";
ALTER TABLE "ProgramSlot" RENAME CONSTRAINT "PlanSlot_wodId_fkey" TO "ProgramSlot_wodId_fkey";
ALTER TABLE "ProgramSlotMovement" RENAME CONSTRAINT "PlanSlotMovement_planSlotId_fkey" TO "ProgramSlotMovement_programSlotId_fkey";
ALTER TABLE "ProgramSlotMovement" RENAME CONSTRAINT "PlanSlotMovement_exerciseId_fkey" TO "ProgramSlotMovement_exerciseId_fkey";
ALTER TABLE "ProgramEnrollment" RENAME CONSTRAINT "PlanEnrollment_planId_fkey" TO "ProgramEnrollment_programId_fkey";
ALTER TABLE "ProgramEnrollment" RENAME CONSTRAINT "PlanEnrollment_userId_fkey" TO "ProgramEnrollment_userId_fkey";
ALTER TABLE "DailyAssignment" RENAME CONSTRAINT "DailyAssignment_planSlotId_fkey" TO "DailyAssignment_programSlotId_fkey";
ALTER TABLE "AssignmentSubstitution" RENAME CONSTRAINT "AssignmentSubstitution_planSlotMovementId_fkey" TO "AssignmentSubstitution_programSlotMovementId_fkey";

-- Check constraints
ALTER TABLE "Program" RENAME CONSTRAINT "Plan_schedule_mode_bounds" TO "Program_schedule_mode_bounds";
ALTER TABLE "ProgramSlot" RENAME CONSTRAINT "PlanSlot_pinned_wod_present" TO "ProgramSlot_pinned_wod_present";
ALTER TABLE "ProgramSlotMovement" RENAME CONSTRAINT "PlanSlotMovement_counts_positive" TO "ProgramSlotMovement_counts_positive";
ALTER TABLE "ProgramSlotMovement" RENAME CONSTRAINT "PlanSlotMovement_movementGroup_xor_exercise" TO "ProgramSlotMovement_movementGroup_xor_exercise";
ALTER TABLE "ProgramSlotMovement" RENAME CONSTRAINT "PlanSlotMovement_rep_shape" TO "ProgramSlotMovement_rep_shape";
ALTER TABLE "ProgramEnrollment" RENAME CONSTRAINT "PlanEnrollment_defaultRestSeconds_nonnegative" TO "ProgramEnrollment_defaultRestSeconds_nonnegative";

-- Unique and partial indexes
ALTER INDEX "PlanWeek_planId_order_key" RENAME TO "ProgramWeek_programId_order_key";
ALTER INDEX "PlanSlot_planWeekId_dayOfWeek_key" RENAME TO "ProgramSlot_programWeekId_dayOfWeek_key";
ALTER INDEX "PlanSlotMovement_planSlotId_order_key" RENAME TO "ProgramSlotMovement_programSlotId_order_key";
ALTER INDEX "PlanEnrollment_id_userId_key" RENAME TO "ProgramEnrollment_id_userId_key";
ALTER INDEX "AssignmentSubstitution_assignmentId_planSlotMovementId_key" RENAME TO "AssignmentSubstitution_assignmentId_programSlotMovementId_key";
ALTER INDEX "Plan_live_owned_name_key" RENAME TO "Program_live_owned_name_key";
ALTER INDEX "Plan_live_global_name_key" RENAME TO "Program_live_global_name_key";
ALTER INDEX "plan_enrollment_one_active_per_user" RENAME TO "program_enrollment_one_active_per_user";
