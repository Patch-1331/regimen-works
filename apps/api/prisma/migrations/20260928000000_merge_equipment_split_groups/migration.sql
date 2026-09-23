-- The equipment-split groups fold back into `squat` and `hinge`
-- (DN-140, ADR-0004 decision 9).
--
-- `squat_loaded`, `squat_box` and `hinge_loaded` encoded in a group name what
-- `Exercise.equipment` already says, and the prescription layer already
-- filters on (DN-79). Two copies of one fact that could disagree -- and the
-- split walled off the swap an athlete most wants to make, the one for the kit
-- actually in front of them.
--
-- `movementGroup` is a plain string column, so this is data only. The Zod enum
-- in `packages/shared/src/enums.ts` is what refuses the retired names from here
-- on.

-- 1. Stand the retiring defaults down BEFORE anything moves.
--
--    Each split group declared its own default member. Move them first and
--    three declared defaults land in `squat` at once, which the partial unique
--    index from DN-139 refuses -- the migration would abort mid-deploy rather
--    than fail review. The merged groups keep the bodyweight default they
--    already had (air squat, glute bridge), which is the shape DN-139 requires:
--    a default needing equipment silently drops its movements from a prescribed
--    day for an athlete who does not own it.
UPDATE "Exercise"
SET "isGroupDefault" = false
WHERE "movementGroup" IN ('squat_loaded', 'squat_box', 'hinge_loaded');

-- 2. The two movements that do not come along.
--
--    A thruster is a squat *and* an overhead press; a box jump is plyometric.
--    Neither is interchangeable with a squat in a program, and the merge is
--    what forces the question to be answered rather than hidden behind an
--    equipment label. They keep their pattern and their fallback and stay
--    available to an authored WOD by name; they hold no group, like the 22
--    other library movements that are nobody's substitute.
--
--    Matched by name against the seeded library only (`ownerId IS NULL`), so an
--    athlete's own exercise that happens to share a name is left alone.
UPDATE "Exercise"
SET "movementGroup" = NULL, "sortOrder" = NULL, "isGroupDefault" = false
WHERE "ownerId" IS NULL
  AND "name" IN ('Dumbbell thruster', 'Box jump');

-- 3. The merge itself.
UPDATE "Exercise"
SET "movementGroup" = 'squat'
WHERE "movementGroup" IN ('squat_loaded', 'squat_box');

UPDATE "Exercise"
SET "movementGroup" = 'hinge'
WHERE "movementGroup" = 'hinge_loaded';

-- 4. Re-derive `sortOrder` across each merged group: bodyweight first, then
--    the members needing kit, ties broken by id so the result is deterministic.
--    Ordering only -- nothing reads it as difficulty (DN-130).
WITH ordered AS (
  SELECT "id",
         ROW_NUMBER() OVER (
           PARTITION BY "movementGroup"
           ORDER BY
             (COALESCE(array_length("equipment", 1), 0) > 0),
             "sortOrder" ASC NULLS LAST,
             "id" ASC
         ) - 1 AS position
  FROM "Exercise"
  WHERE "ownerId" IS NULL
    AND "archivedAt" IS NULL
    AND "movementGroup" IN ('squat', 'hinge')
)
UPDATE "Exercise" e
SET "sortOrder" = ordered.position
FROM ordered
WHERE e."id" = ordered."id";

-- 5. A stored choice whose exercise just left its group is not a stale choice
--    -- it is an inconsistent row, claiming a group its exercise is no longer
--    in. Drop it and the athlete re-picks in one tap; leaving it would have the
--    group resolve to a movement that is not a member.
DELETE FROM "SkillLevel" s
USING "Exercise" e
WHERE s."exerciseId" = e."id"
  AND e."ownerId" IS NULL
  AND e."name" IN ('Dumbbell thruster', 'Box jump');

-- 6. Now the athlete's stored choices follow their groups.
UPDATE "SkillLevel"
SET "movementGroup" = 'squat'
WHERE "movementGroup" IN ('squat_loaded', 'squat_box');

UPDATE "SkillLevel"
SET "movementGroup" = 'hinge'
WHERE "movementGroup" = 'hinge_loaded';

-- 7. Settle the collision explicitly rather than letting `(userId,
--    movementGroup)` decide by accident: an athlete could hold a choice in
--    `squat`, `squat_loaded` and `squat_box`, which is now one group.
--
--    Most recently updated wins. That is not a new rule -- `proposeMovementChanges`
--    already answers the same question the same way (DN-88): the app cannot know
--    which one they meant to keep, and the last thing they reached for is the
--    closest it can honestly get. `id` breaks a tie so the outcome is
--    deterministic rather than whatever the scan order was.
DELETE FROM "SkillLevel"
WHERE "id" IN (
  SELECT "id" FROM (
    SELECT "id",
           ROW_NUMBER() OVER (
             PARTITION BY "userId", "movementGroup"
             ORDER BY "updatedAt" DESC, "id" DESC
           ) AS rank
    FROM "SkillLevel"
  ) ranked
  WHERE ranked.rank > 1
);

-- 8. A program slot that authored one of the retired groups now authors the
--    merged one. A slot naming a specific exercise is untouched -- it stores
--    `exerciseId` instead, and exactly one of the two is ever set.
UPDATE "PlanSlotMovement"
SET "movementGroup" = 'squat'
WHERE "movementGroup" IN ('squat_loaded', 'squat_box');

UPDATE "PlanSlotMovement"
SET "movementGroup" = 'hinge'
WHERE "movementGroup" = 'hinge_loaded';
