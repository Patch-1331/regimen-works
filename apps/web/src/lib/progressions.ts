import type { SkillLevel } from "@regimen-works/shared";
import type { ApiExercise } from "./api";

const LINE_LABELS: Record<string, string> = {
  push_horizontal: "Push · Horizontal",
  push_vertical: "Push · Vertical",
  pull: "Pull",
  squat: "Squat",
  squat_loaded: "Squat · Loaded",
  squat_box: "Squat · Box",
  hinge: "Hinge",
  hinge_loaded: "Hinge · Loaded",
  core_dynamic: "Core · Dynamic",
  core_hold: "Core · Anti-extension",
  core_side: "Core · Anti-rotation",
  cardio_rope: "Rope",
};

export function lineLabel(movementGroup: string): string {
  return LINE_LABELS[movementGroup] ?? movementGroup;
}

const PATTERN_LABELS: Record<string, string> = {
  squat: "Squat",
  hinge: "Hinge",
  push: "Push",
  pull: "Pull",
  core: "Core",
  carry: "Carry",
  monostructural: "Monostructural",
};

/**
 * A movement pattern as a person reads it.
 *
 * Beside `lineLabel` because they are the same job on the neighbouring
 * column, and because two screens now name patterns — the stats breakdown and
 * the library page (DN-28). Falls through to the raw slug for the same reason
 * `lineLabel` does: a pattern added to the enum and not to this map should
 * ship as an ugly label, not as a blank one.
 */
export function patternLabel(pattern: string): string {
  return PATTERN_LABELS[pattern] ?? pattern;
}

export type MovementOption = {
  id: string;
  name: string;
  sortOrder: number;
  /** The one the athlete currently has on record for this group. */
  isChosen: boolean;
};

export type MovementChoice = {
  movementGroup: string;
  /**
   * The movement the athlete last picked. Null only on a data gap — a stored
   * choice that is not among the movements this screen loaded, which since
   * DN-139 means it was archived — where naming nothing is better than naming
   * the wrong movement.
   */
  chosenName: string | null;
  /** Every movement on the group, in the group's own order. */
  options: MovementOption[];
};

/**
 * What the athlete has chosen, per movement group (DN-91).
 *
 * This replaced a ladder per group whose members were marked done / current /
 * locked. Those are assessment words: `done` says you graduated past
 * something, `locked` says you are not allowed it yet, and neither is true of
 * a preference. What the data supports is one sentence — this is the movement
 * you picked — plus the rest of the group to pick from instead.
 *
 * One entry per group the athlete has actually chosen on, and deliberately not
 * one per group that exists. Rendering all eight with "not set yet" would turn
 * this screen into the calibration wizard DN-86 removed: the app asking what
 * you can do, in the abstract, before it has seen you train. A group appears
 * here once there is something true to say about it.
 */
export function buildMovementChoices(
  exercises: ApiExercise[],
  skillLevels: SkillLevel[],
): MovementChoice[] {
  const exercisesByLine = new Map<string, ApiExercise[]>();
  for (const e of exercises) {
    if (!e.movementGroup || e.sortOrder === null) continue;
    const list = exercisesByLine.get(e.movementGroup) ?? [];
    list.push(e);
    exercisesByLine.set(e.movementGroup, list);
  }

  return skillLevels
    .slice()
    .sort((a, b) =>
      lineLabel(a.movementGroup).localeCompare(lineLabel(b.movementGroup)),
    )
    .map((skill) => {
      const lineExercises = (exercisesByLine.get(skill.movementGroup) ?? [])
        .slice()
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

      const options: MovementOption[] = lineExercises.map((e) => ({
        id: e.id,
        name: e.name,
        sortOrder: e.sortOrder ?? 0,
        // By id since DN-139. Matching on position meant that reordering a
        // group moved the tick to a movement the athlete never picked.
        isChosen: e.id === skill.exerciseId,
      }));

      return {
        movementGroup: skill.movementGroup,
        chosenName: options.find((o) => o.isChosen)?.name ?? null,
        options,
      };
    });
}
