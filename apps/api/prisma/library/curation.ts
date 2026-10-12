import type { Curation } from '../../src/seed/library';

/**
 * The curation file (DN-167, ADR-0007 decision 3): what the scheduler needs
 * to know about each exercise, which no dataset says.
 *
 * Keyed by exercise key -- free-exercise-db's own `id`, or `rw-` for one of
 * the app's own in `own-exercises.json`. A dataset entry is in the library
 * when it has an entry here, and only then: this object is the allow-list.
 * Every own exercise has one too, because pattern and grouping are ours to
 * say either way.
 *
 * Data only, so a spec can read it. Order is reading order, and the order
 * the import writes rows in.
 */
export const curation: Record<string, Curation> = {
  // Push · Horizontal
  'rw-knee-push-up': {
    pattern: 'push',
    movementGroup: 'push_horizontal',
    sortOrder: 0,
    isGroupDefault: true,
  },
  Pushups: {
    pattern: 'push',
    formerly: 'Push-up',
    movementGroup: 'push_horizontal',
    sortOrder: 1,
    fallback: 'rw-knee-push-up',
  },
  'Push-Ups_-_Close_Triceps_Position': {
    pattern: 'push',
    formerly: 'Diamond push-up',
    movementGroup: 'push_horizontal',
    sortOrder: 2,
  },
  'rw-archer-push-up': {
    pattern: 'push',
    movementGroup: 'push_horizontal',
    sortOrder: 3,
  },

  // Loaded pressing (DN-113) -- its own movement, not a member of
  // `push_horizontal`. The reason is equipment, not difficulty: every member
  // of that group needs nothing, and the resolver treats a group as freely
  // interchangeable.
  Dumbbell_Floor_Press: {
    pattern: 'push',
    formerly: 'Dumbbell floor press',
    fallback: 'Pushups',
  },

  // Push · Vertical
  'rw-incline-pike-push-up': {
    pattern: 'push',
    movementGroup: 'push_vertical',
    sortOrder: 0,
    isGroupDefault: true,
  },
  'rw-pike-push-up': {
    pattern: 'push',
    movementGroup: 'push_vertical',
    sortOrder: 1,
    scalable: true,
    fallback: 'rw-incline-pike-push-up',
  },
  'Handstand_Push-Ups': {
    pattern: 'push',
    formerly: 'Handstand push-up',
    movementGroup: 'push_vertical',
    sortOrder: 2,
    scalable: true,
    fallback: 'rw-pike-push-up',
  },

  // Pull
  'rw-supermans-reverse-snow-angels': {
    pattern: 'pull',
    movementGroup: 'pull',
    sortOrder: 0,
    isGroupDefault: true,
  },
  'rw-negative-pull-up': {
    pattern: 'pull',
    movementGroup: 'pull',
    sortOrder: 1,
    fallback: 'rw-supermans-reverse-snow-angels',
  },
  'Chin-Up': {
    pattern: 'pull',
    formerly: 'Chin-up',
    movementGroup: 'pull',
    sortOrder: 2,
    fallback: 'rw-supermans-reverse-snow-angels',
  },
  Pullups: {
    pattern: 'pull',
    formerly: 'Pull-up',
    movementGroup: 'pull',
    sortOrder: 3,
    fallback: 'rw-supermans-reverse-snow-angels',
  },
  // Loaded pulling (DN-113), off the group for the floor press's reason.
  'One-Arm_Dumbbell_Row': {
    pattern: 'pull',
    formerly: 'Dumbbell row',
    fallback: 'rw-supermans-reverse-snow-angels',
  },

  // Squat -- the bodyweight and the equipment squats in one group (DN-140).
  Bodyweight_Squat: {
    pattern: 'squat',
    formerly: 'Air squat',
    movementGroup: 'squat',
    sortOrder: 0,
    isGroupDefault: true,
  },
  'rw-reverse-lunge': {
    pattern: 'squat',
    movementGroup: 'squat',
    sortOrder: 1,
  },
  'rw-assisted-pistol': {
    pattern: 'squat',
    movementGroup: 'squat',
    sortOrder: 2,
  },
  'rw-pistol-squat': {
    pattern: 'squat',
    movementGroup: 'squat',
    sortOrder: 3,
    scalable: true,
    fallback: 'rw-assisted-pistol',
  },
  Goblet_Squat: {
    pattern: 'squat',
    formerly: 'Goblet squat',
    movementGroup: 'squat',
    sortOrder: 4,
    fallback: 'Bodyweight_Squat',
    // The dataset's goblet squat holds a kettlebell; ours has always been a
    // dumbbell, and an athlete's Settings say which they own.
    equipment: ['dumbbell'],
  },
  'rw-dumbbell-front-squat': {
    pattern: 'squat',
    movementGroup: 'squat',
    sortOrder: 5,
    fallback: 'Bodyweight_Squat',
  },
  'rw-box-step-up': {
    pattern: 'squat',
    movementGroup: 'squat',
    sortOrder: 6,
    fallback: 'rw-reverse-lunge',
    equipment: ['box'],
  },
  // The thruster and the box jump stay out of every group (DN-140): a
  // thruster is a squat and an overhead press, and a box jump is plyometric.
  // Usable by name in an authored WOD, never as a substitute.
  'rw-dumbbell-thruster': { pattern: 'squat', fallback: 'Freehand_Jump_Squat' },
  Freehand_Jump_Squat: {
    pattern: 'squat',
    formerly: 'Jump squat',
    fallback: 'Bodyweight_Squat',
  },
  Bodyweight_Walking_Lunge: { pattern: 'squat', formerly: 'Walking lunge' },
  Front_Box_Jump: {
    pattern: 'squat',
    formerly: 'Box jump',
    fallback: 'Freehand_Jump_Squat',
    // The dataset says "other".
    equipment: ['box'],
  },

  // Hinge -- one group, as squat is (DN-140).
  Butt_Lift_Bridge: {
    pattern: 'hinge',
    formerly: 'Glute bridge',
    movementGroup: 'hinge',
    sortOrder: 0,
    isGroupDefault: true,
  },
  Single_Leg_Glute_Bridge: {
    pattern: 'hinge',
    formerly: 'Single-leg glute bridge',
    movementGroup: 'hinge',
    sortOrder: 1,
    fallback: 'Butt_Lift_Bridge',
  },
  Superman: { pattern: 'hinge', movementGroup: 'hinge', sortOrder: 2 },
  'rw-single-leg-superman': {
    pattern: 'hinge',
    movementGroup: 'hinge',
    sortOrder: 3,
  },
  Romanian_Deadlift: {
    pattern: 'hinge',
    formerly: 'Romanian deadlift',
    movementGroup: 'hinge',
    sortOrder: 4,
    fallback: 'Butt_Lift_Bridge',
    // The dataset's is a barbell lift; ours has always been dumbbells.
    equipment: ['dumbbell'],
  },
  'rw-single-leg-romanian-deadlift': {
    pattern: 'hinge',
    movementGroup: 'hinge',
    sortOrder: 5,
    fallback: 'Single_Leg_Glute_Bridge',
  },
  'rw-kettlebell-swing': {
    pattern: 'hinge',
    movementGroup: 'hinge',
    sortOrder: 6,
    fallback: 'Standing_Long_Jump',
  },
  Standing_Long_Jump: { pattern: 'hinge', formerly: 'Broad jump' },

  // Core · Dynamic
  'Sit-Up': {
    pattern: 'core',
    formerly: 'Sit-up',
    movementGroup: 'core_dynamic',
    sortOrder: 0,
    isGroupDefault: true,
  },
  'rw-tuck-up': {
    pattern: 'core',
    movementGroup: 'core_dynamic',
    sortOrder: 1,
  },
  'Jackknife_Sit-Up': {
    pattern: 'core',
    formerly: 'V-up',
    movementGroup: 'core_dynamic',
    sortOrder: 2,
    fallback: 'rw-tuck-up',
  },
  'rw-lying-leg-raise': {
    pattern: 'core',
    movementGroup: 'core_dynamic',
    sortOrder: 3,
  },
  'rw-hanging-knee-raise': {
    pattern: 'core',
    movementGroup: 'core_dynamic',
    sortOrder: 4,
    fallback: 'rw-lying-leg-raise',
  },
  'rw-toes-to-bar': {
    pattern: 'core',
    movementGroup: 'core_dynamic',
    sortOrder: 5,
    fallback: 'Jackknife_Sit-Up',
  },

  // Core · Hold -- counted in seconds.
  'rw-knee-plank': {
    pattern: 'core',
    unit: 'seconds',
    movementGroup: 'core_hold',
    sortOrder: 0,
    isGroupDefault: true,
  },
  'rw-tucked-hollow-hold': {
    pattern: 'core',
    unit: 'seconds',
    movementGroup: 'core_hold',
    sortOrder: 1,
  },
  Plank: {
    pattern: 'core',
    formerly: 'Plank hold',
    unit: 'seconds',
    movementGroup: 'core_hold',
    sortOrder: 2,
    fallback: 'rw-knee-plank',
  },
  'rw-hollow-hold': {
    pattern: 'core',
    unit: 'seconds',
    movementGroup: 'core_hold',
    sortOrder: 3,
    fallback: 'rw-tucked-hollow-hold',
  },
  'rw-long-lever-plank': {
    pattern: 'core',
    unit: 'seconds',
    movementGroup: 'core_hold',
    sortOrder: 4,
  },

  // Core · Side
  'rw-knee-side-plank': {
    pattern: 'core',
    movementGroup: 'core_side',
    sortOrder: 0,
    isGroupDefault: true,
  },
  'rw-side-plank': {
    pattern: 'core',
    movementGroup: 'core_side',
    sortOrder: 1,
    fallback: 'rw-knee-side-plank',
  },

  // Carries (DN-113). Really measured in distance, which `unit` has no word
  // for; seconds is the honest half.
  'rw-farmer-carry': { pattern: 'core', unit: 'seconds', fallback: 'Plank' },
  'rw-suitcase-carry': { pattern: 'core', unit: 'seconds', fallback: 'Plank' },

  // Cardio
  'rw-burpee': { pattern: 'cardio', fallback: 'rw-squat-thrust' },
  'rw-squat-thrust': { pattern: 'cardio' },
  Mountain_Climbers: { pattern: 'cardio', formerly: 'Mountain climber' },
  'rw-high-knees': { pattern: 'cardio' },
  // The rope pair (DN-115): both members need the rope, so the way off the
  // group is the fallback, not another member.
  Rope_Jumping: {
    pattern: 'cardio',
    formerly: 'Single-unders',
    movementGroup: 'cardio_rope',
    sortOrder: 0,
    isGroupDefault: true,
    fallback: 'rw-high-knees',
    // The dataset says "other".
    equipment: ['jump_rope'],
  },
  'rw-double-unders': {
    pattern: 'cardio',
    movementGroup: 'cardio_rope',
    sortOrder: 1,
    fallback: 'rw-high-knees',
    equipment: ['jump_rope'],
  },

  // On the warm-up and cool-down lists (checklist-seed.ts). The pattern is
  // the exercise's; which day an entry is chosen for is the entry's.
  Arm_Circles: { pattern: 'push', formerly: 'Arm circles' },
  'rw-leg-swings': { pattern: 'hinge' },
  Inchworm: { pattern: 'core', formerly: 'Inchworms' },
  'Scapular_Pull-Up': {
    pattern: 'pull',
    formerly: 'Scapular pull-ups',
    // The bar rule would tag it, and it does hang from one. The library has
    // never said so, and saying so needs a no-bar fallback that nobody has
    // chosen; until then it stays as it was. It is only on the warm-up list.
    equipment: [],
  },
  'rw-light-jogging-in-place': { pattern: null },
  'rw-static-quad-stretch': { pattern: 'squat' },
  'rw-childs-pose': { pattern: 'hinge' },
  'rw-cat-cow': { pattern: 'core' },
  'rw-doorway-chest-stretch': { pattern: 'push' },
  Shoulder_Stretch: {
    pattern: 'pull',
    formerly: 'Cross-body shoulder stretch',
  },
  'rw-deep-breathing': { pattern: null },
};

const STRONGMAN = 'strongman kit: stones, kegs, logs, yokes and the like';
const SLED = 'needs a sled or a prowler';
const CHAINS = 'needs lifting chains';
const SPECIALIST = (piece: string) =>
  `needs ${piece}, which Settings does not ask about`;

/**
 * Dataset entries kept out on purpose (ADR-0007 decision 9): the specialist
 * kit no athlete is asked about. Any of them can come back with the catalog
 * item it needs -- adding the item and deleting the line here is the whole
 * change.
 */
export const leftOut: Record<string, string> = {
  Atlas_Stone_Trainer: STRONGMAN,
  Atlas_Stones: STRONGMAN,
  Axle_Deadlift: STRONGMAN,
  Backward_Drag: STRONGMAN,
  Bear_Crawl_Sled_Drags: STRONGMAN,
  Car_Deadlift: STRONGMAN,
  Circus_Bell: STRONGMAN,
  Conans_Wheel: STRONGMAN,
  Crucifix: STRONGMAN,
  Farmers_Walk: STRONGMAN,
  Forward_Drag_with_Press: STRONGMAN,
  Keg_Load: STRONGMAN,
  Log_Lift: STRONGMAN,
  Power_Stairs: STRONGMAN,
  Rickshaw_Carry: STRONGMAN,
  Rickshaw_Deadlift: STRONGMAN,
  Sandbag_Load: STRONGMAN,
  'Sled_Drag_-_Harness': STRONGMAN,
  Sled_Push: STRONGMAN,
  Tire_Flip: STRONGMAN,
  Yoke_Walk: STRONGMAN,

  Prowler_Sprint: SLED,
  Sled_Overhead_Backward_Walk: SLED,
  Sled_Overhead_Triceps_Extension: SLED,
  Sled_Reverse_Flye: SLED,
  Sled_Row: SLED,

  Chain_Handle_Extension: CHAINS,
  Chain_Press: CHAINS,

  Heavy_Bag_Thrust: SPECIALIST('a heavy bag'),
  Sledgehammer_Swings: SPECIALIST('a sledgehammer and a tyre'),
  Battling_Ropes: SPECIALIST('battle ropes'),
  Seated_Head_Harness_Neck_Resistance: SPECIALIST('a neck harness'),
  Trap_Bar_Deadlift: SPECIALIST('a trap bar'),
  Wrist_Roller: SPECIALIST('a wrist roller'),
  Ab_Roller: SPECIALIST('an ab roller'),
  Balance_Board: SPECIALIST('a balance board'),
};
