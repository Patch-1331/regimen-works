/**
 * The warm-up and cool-down lists, as data (Feature #63, DN-172, ADR-0008).
 *
 * An entry points at an exercise; it does not describe one. Which checklist a
 * movement is on, and which of a WOD's patterns it prepares or unwinds, are
 * facts about the entry -- so a movement can be on a checklist and in a
 * workout at once, which `Exercise.phase` could never say. The bodyweight
 * squat is the case that forced it: the squat group prescribes it, and the
 * warm-up rehearses it.
 *
 * Data only, like `library/curation.ts` beside it, so a spec can read it.
 */

export type ChecklistEntrySeed = {
  /**
   * The exercise's key in the library (DN-167) -- not its name, which is a
   * label that can change. The seed refuses one it cannot find.
   */
  exercise: string;
  kind: 'warmup' | 'cooldown';
  /**
   * The WOD pattern this entry is chosen for. Null for filler any day can
   * use -- light jogging, deep breathing.
   */
  pattern: string | null;
  /**
   * What to say about the movement *as this entry*, when the exercise's own
   * steps are wrong for it. Omitted to show the exercise's steps, which is
   * nearly always right: an entry that only exists on a checklist was written
   * as checklist copy in the first place.
   */
  instructions?: string;
};

export const checklistEntries: ChecklistEntrySeed[] = [
  // Warm-up -- the pattern each one best prepares, so a WOD's dominant
  // pattern can pull in the relevant move.
  { exercise: 'Arm_Circles', kind: 'warmup', pattern: 'push' },
  { exercise: 'rw-leg-swings', kind: 'warmup', pattern: 'hinge' },
  {
    exercise: 'Bodyweight_Squat',
    kind: 'warmup',
    pattern: 'squat',
    // The squat's own steps are for a working set. As a warm-up it is the
    // same movement asked for differently -- this is the copy the old
    // "Bodyweight squats" row carried before it folded into Air squat
    // (DN-172), which took the dataset's name in DN-167.
    instructions:
      'Easy, unloaded air squats at a steady pace, sinking a little deeper each rep. This is a rehearsal to get the hips and knees moving, not a set to work at.',
  },
  { exercise: 'Inchworm', kind: 'warmup', pattern: 'core' },
  { exercise: 'Scapular_Pull-Up', kind: 'warmup', pattern: 'pull' },
  { exercise: 'rw-light-jogging-in-place', kind: 'warmup', pattern: null },

  // Cool-down -- the pattern each one unwinds.
  { exercise: 'rw-static-quad-stretch', kind: 'cooldown', pattern: 'squat' },
  { exercise: 'rw-childs-pose', kind: 'cooldown', pattern: 'hinge' },
  { exercise: 'rw-cat-cow', kind: 'cooldown', pattern: 'core' },
  { exercise: 'rw-doorway-chest-stretch', kind: 'cooldown', pattern: 'push' },
  {
    exercise: 'Shoulder_Stretch',
    kind: 'cooldown',
    pattern: 'pull',
    // The dataset's copy is one line and says nothing about holding it. This
    // is the copy the row carried as "Cross-body shoulder stretch", before it
    // became the dataset's twin (DN-167).
    instructions:
      'Bring one arm straight across the chest and use the other forearm to draw it closer. Hold twenty to thirty seconds, then switch. Keep the shoulder down rather than shrugged toward the ear.',
  },
  { exercise: 'rw-deep-breathing', kind: 'cooldown', pattern: null },
];

/** The steps an entry stores: none to fall back to the exercise's own. */
export function entrySteps(
  e: Pick<ChecklistEntrySeed, 'instructions'>,
): string[] {
  return e.instructions === undefined ? [] : [e.instructions];
}
