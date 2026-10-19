import type { Equipment } from '@regimen-works/shared';

import type { Correction, Curation } from '../../src/seed/library';

/**
 * The curation file (DN-167, ADR-0007 decision 3): what the scheduler needs
 * to know about each exercise, which no dataset says.
 *
 * Keyed by exercise key -- free-exercise-db's own `id`, or `rw-` for one of
 * the app's own in `own-exercises.json`. An entry here makes an exercise
 * curated: something the seeded WODs, groups and checklists can prescribe,
 * held to the fallback guard (DN-83). Every own exercise has one, because
 * pattern and grouping are ours to say either way. The rest of the dataset
 * comes in uncurated (DN-168), fixed where needed by `corrections` below.
 *
 * Data only, so a spec can read it. Order is reading order, and the order
 * the import writes rows in.
 */
export const curation: Record<string, Curation> = {
  // Push · Horizontal
  'rw-knee-push-up': {
    pattern: 'push',
    movementGroup: 'push_horizontal',
    isGroupDefault: true,
  },
  Pushups: {
    pattern: 'push',
    formerly: 'Push-up',
    movementGroup: 'push_horizontal',
    fallback: 'rw-knee-push-up',
  },
  'Push-Ups_-_Close_Triceps_Position': {
    pattern: 'push',
    formerly: 'Diamond push-up',
    movementGroup: 'push_horizontal',
  },
  'rw-archer-push-up': {
    pattern: 'push',
    movementGroup: 'push_horizontal',
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
    isGroupDefault: true,
  },
  'rw-pike-push-up': {
    pattern: 'push',
    movementGroup: 'push_vertical',
    scalable: true,
    fallback: 'rw-incline-pike-push-up',
  },
  'Handstand_Push-Ups': {
    pattern: 'push',
    formerly: 'Handstand push-up',
    movementGroup: 'push_vertical',
    scalable: true,
    fallback: 'rw-pike-push-up',
  },

  // Pull
  'rw-supermans-reverse-snow-angels': {
    pattern: 'pull',
    movementGroup: 'pull',
    isGroupDefault: true,
    // A prone hold that shares a row's prime mover, force and mechanic, and
    // is no row (DN-174). Its group still reaches it.
    excludeFromMuscleMatch: true,
  },
  'rw-negative-pull-up': {
    pattern: 'pull',
    movementGroup: 'pull',
    fallback: 'rw-supermans-reverse-snow-angels',
  },
  'Chin-Up': {
    pattern: 'pull',
    formerly: 'Chin-up',
    movementGroup: 'pull',
    fallback: 'rw-supermans-reverse-snow-angels',
  },
  Pullups: {
    pattern: 'pull',
    formerly: 'Pull-up',
    movementGroup: 'pull',
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
    isGroupDefault: true,
  },
  'rw-reverse-lunge': {
    pattern: 'squat',
    movementGroup: 'squat',
  },
  'rw-assisted-pistol': {
    pattern: 'squat',
    movementGroup: 'squat',
  },
  'rw-pistol-squat': {
    pattern: 'squat',
    movementGroup: 'squat',
    scalable: true,
    fallback: 'rw-assisted-pistol',
  },
  Goblet_Squat: {
    pattern: 'squat',
    formerly: 'Goblet squat',
    movementGroup: 'squat',
    fallback: 'Bodyweight_Squat',
    // The dataset's goblet squat holds a kettlebell; ours has always been a
    // dumbbell, and an athlete's Settings say which they own.
    equipment: ['dumbbell'],
  },
  'rw-dumbbell-front-squat': {
    pattern: 'squat',
    movementGroup: 'squat',
    fallback: 'Bodyweight_Squat',
  },
  'rw-box-step-up': {
    pattern: 'squat',
    movementGroup: 'squat',
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
    isGroupDefault: true,
  },
  Single_Leg_Glute_Bridge: {
    pattern: 'hinge',
    formerly: 'Single-leg glute bridge',
    movementGroup: 'hinge',
    fallback: 'Butt_Lift_Bridge',
  },
  Superman: { pattern: 'hinge', movementGroup: 'hinge' },
  'rw-single-leg-superman': {
    pattern: 'hinge',
    movementGroup: 'hinge',
  },
  Romanian_Deadlift: {
    pattern: 'hinge',
    formerly: 'Romanian deadlift',
    movementGroup: 'hinge',
    fallback: 'Butt_Lift_Bridge',
    // The dataset's is a barbell lift; ours has always been dumbbells.
    equipment: ['dumbbell'],
  },
  'rw-single-leg-romanian-deadlift': {
    pattern: 'hinge',
    movementGroup: 'hinge',
    fallback: 'Single_Leg_Glute_Bridge',
  },
  'rw-kettlebell-swing': {
    pattern: 'hinge',
    movementGroup: 'hinge',
    fallback: 'Standing_Long_Jump',
  },
  Standing_Long_Jump: { pattern: 'hinge', formerly: 'Broad jump' },

  // Core · Dynamic
  'Sit-Up': {
    pattern: 'core',
    formerly: 'Sit-up',
    movementGroup: 'core_dynamic',
    isGroupDefault: true,
  },
  'rw-tuck-up': {
    pattern: 'core',
    movementGroup: 'core_dynamic',
  },
  'Jackknife_Sit-Up': {
    pattern: 'core',
    formerly: 'V-up',
    movementGroup: 'core_dynamic',
    fallback: 'rw-tuck-up',
  },
  'rw-lying-leg-raise': {
    pattern: 'core',
    movementGroup: 'core_dynamic',
  },
  'rw-hanging-knee-raise': {
    pattern: 'core',
    movementGroup: 'core_dynamic',
    fallback: 'rw-lying-leg-raise',
  },
  'rw-toes-to-bar': {
    pattern: 'core',
    movementGroup: 'core_dynamic',
    fallback: 'Jackknife_Sit-Up',
  },

  // Core · Hold -- counted in seconds.
  'rw-knee-plank': {
    pattern: 'core',
    unit: 'seconds',
    movementGroup: 'core_hold',
    isGroupDefault: true,
  },
  'rw-tucked-hollow-hold': {
    pattern: 'core',
    unit: 'seconds',
    movementGroup: 'core_hold',
  },
  Plank: {
    pattern: 'core',
    formerly: 'Plank hold',
    unit: 'seconds',
    movementGroup: 'core_hold',
    fallback: 'rw-knee-plank',
  },
  'rw-hollow-hold': {
    pattern: 'core',
    unit: 'seconds',
    movementGroup: 'core_hold',
    fallback: 'rw-tucked-hollow-hold',
  },
  'rw-long-lever-plank': {
    pattern: 'core',
    unit: 'seconds',
    movementGroup: 'core_hold',
  },

  // Core · Side
  'rw-knee-side-plank': {
    pattern: 'core',
    movementGroup: 'core_side',
    isGroupDefault: true,
  },
  'rw-side-plank': {
    pattern: 'core',
    movementGroup: 'core_side',
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
    isGroupDefault: true,
    fallback: 'rw-high-knees',
    // The dataset says "other".
    equipment: ['jump_rope'],
  },
  'rw-double-unders': {
    pattern: 'cardio',
    movementGroup: 'cardio_rope',
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

  // The glute-ham raise (DN-174). On muscles alone the bodyweight one stood
  // in for every clean, snatch and good morning in the library: the same
  // prime mover, force and mechanic, and a different movement. Kept off the
  // muscle match, so the machine version gets it by hand instead.
  Natural_Glute_Ham_Raise: {
    pattern: 'hinge',
    // The bench or box in the steps is not the kit.
    equipment: [],
    excludeFromMuscleMatch: true,
  },
  Glute_Ham_Raise: {
    pattern: 'hinge',
    fallback: 'Natural_Glute_Ham_Raise',
  },
};

const STRONGMAN = 'strongman kit: stones, kegs, logs, yokes and the like';
const SLED = 'needs a sled or a prowler';
const CHAINS = 'needs lifting chains';
const SPECIALIST = (piece: string) =>
  `needs ${piece}, which Settings does not ask about`;
const NO_STEPS = 'the dataset has no instructions for it';

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
  Bicycling: SPECIALIST('a bicycle'),
  Skating: SPECIALIST('skates'),
  Rope_Climb: SPECIALIST('a climbing rope'),
  London_Bridges: SPECIALIST('a climbing rope'),
  Weighted_Squat: SPECIALIST('a dip belt'),

  // DN-168: nothing to read. The swap panel shows moves to people who have
  // never done them, so an entry without steps cannot come in.
  Iron_Cross: NO_STEPS,
  'One-Arm_Kettlebell_Swings': NO_STEPS,
  Push_Press: NO_STEPS,
  Side_Bridge: NO_STEPS,
  Side_Jackknife: NO_STEPS,

  Childs_Pose: 'the same stretch as our own rw-childs-pose',
};

/** "With a chair", "with a partner": things anyone has, which Settings does not ask about. */
const NONE: Equipment[] = [];

/**
 * Hand fixes to the dataset entries nobody has curated (DN-168): what the
 * derived values get wrong. An entry with no line here comes in as derived
 * -- sentence-case name, suggested pattern, unit from the force, equipment
 * from the word plus the hidden-kit rules.
 *
 * Mostly equipment. "other" names nothing, so every entry with it is here;
 * so is every entry a hidden-kit rule reads wrong -- a "bench" in the steps
 * that is only somewhere to sit, a "box" that is a plyo box under a barbell.
 * Kit Settings does not ask about and anyone has -- a chair, a partner, a
 * towel or a belt for a stretch, cones -- counts as no equipment.
 */
export const corrections: Record<string, Correction> = {
  // "other", said plainly
  'Anterior_Tibialis-SMR': { equipment: ['foam_roller'] },
  'Neck-SMR': { equipment: ['foam_roller'] },
  'Foot-SMR': { equipment: ['foam_roller'] },
  'Band_Assisted_Pull-Up': { equipment: ['bar', 'bands'] },
  Bodyweight_Mid_Row: { equipment: ['bar'] },
  Gironda_Sternum_Chins: { equipment: ['bar'] },
  Mixed_Grip_Chin: { equipment: ['bar'] },
  'Rocky_Pull-Ups_Pulldowns': { equipment: ['bar'] },
  Side_To_Side_Chins: { equipment: ['bar'] },
  'One_Arm_Chin-Up': { equipment: ['bar'] },
  One_Handed_Hang: { equipment: ['bar'] },
  Weighted_Pull_Ups: { equipment: ['bar', 'dumbbell'] },
  Bench_Sprint: { equipment: ['box'] },
  Box_Jump_Multiple_Response: { equipment: ['box'] },
  Box_Skip: { equipment: ['box'] },
  Depth_Jump_Leap: { equipment: ['box'] },
  Drop_Push: { equipment: ['box'] },
  'Incline_Push-Up_Depth_Jump': { equipment: ['box'] },
  Linear_Depth_Jump: { equipment: ['box'] },
  Lateral_Box_Jump: { equipment: ['box'] },
  Quick_Leap: { equipment: ['box'] },
  Side_to_Side_Box_Shuffle: { equipment: ['box'] },
  'Single-Leg_Stride_Jump': { equipment: ['box'] },
  'Single_Leg_Push-off': { equipment: ['box'] },
  Stride_Jump_Crossover: { equipment: ['box'] },
  'Single-Leg_High_Box_Squat': { equipment: ['box'] },
  'Dips_-_Chest_Version': { equipment: ['dip_bars'] },
  Parallel_Bar_Dip: { equipment: ['dip_bars'] },
  Knee_Hip_Raise_On_Parallel_Bars: { equipment: ['dip_bars'] },
  Donkey_Calf_Raises: { equipment: ['gym_machines'] },
  Hyperextensions_Back_Extensions: { equipment: ['gym_machines'] },
  // A plate is part of a barbell set.
  Front_Plate_Raise: { equipment: ['barbell'] },
  Plate_Pinch: { equipment: ['barbell'] },
  Plate_Twist: { equipment: ['barbell'] },
  Reverse_Plate_Curls: { equipment: ['barbell'] },
  Standing_Olympic_Plate_Hand_Squeeze: { equipment: ['barbell'] },
  Svend_Press: { equipment: ['barbell'] },
  Lying_Face_Down_Plate_Neck_Resistance: { equipment: ['barbell', 'bench'] },
  Lying_Face_Up_Plate_Neck_Resistance: { equipment: ['barbell', 'bench'] },
  // Rings, and straps, are a suspension trainer.
  Inverted_Row_with_Straps: { equipment: ['suspension_trainer'] },
  Kipping_Muscle_Up: { equipment: ['suspension_trainer'] },
  Muscle_Up: { equipment: ['suspension_trainer'] },
  Ring_Dips: { equipment: ['suspension_trainer'] },
  Suspended_Fallout: { equipment: ['suspension_trainer'] },
  'Suspended_Push-Up': { equipment: ['suspension_trainer'] },
  Suspended_Reverse_Crunch: { equipment: ['suspension_trainer'] },
  Suspended_Row: { equipment: ['suspension_trainer'] },
  Suspended_Split_Squat: { equipment: ['suspension_trainer'] },
  'Otis-Up': { equipment: ['dumbbell'] },
  Seated_Band_Hamstring_Curl: { equipment: ['bands', 'bench'] },
  'Weighted_Sit-Ups_-_With_Bands': { equipment: ['bands', 'bench'] },
  Weighted_Bench_Dip: { equipment: ['bench', 'dumbbell'] },
  // With a partner
  Behind_Head_Chest_Stretch: { equipment: NONE },
  Lying_Bent_Leg_Groin: { equipment: NONE },
  Lying_Hamstring: { equipment: NONE },
  Overhead_Lat: { equipment: NONE },
  // With a chair, a broomstick, cones, a towel or a belt
  Chair_Leg_Extended_Stretch: { equipment: NONE },
  Chair_Upper_Body_Stretch: { equipment: NONE },
  Chest_And_Front_Of_Shoulder_Stretch: { equipment: NONE },
  Round_The_World_Shoulder_Stretch: { equipment: NONE },
  Front_Cone_Hops_or_hurdle_hops: { equipment: NONE },
  Hurdle_Hops: { equipment: NONE },
  Lateral_Cone_Hops: { equipment: NONE },
  'Side_Hop-Sprint': { equipment: NONE },
  'Single-Cone_Sprint_Drill': { equipment: NONE },
  'Single-Leg_Hop_Progression': { equipment: NONE },
  'Single-Leg_Lateral_Hop': { equipment: NONE },
  IT_Band_and_Glute_Stretch: { equipment: NONE },
  Intermediate_Groin_Stretch: { equipment: NONE },
  Intermediate_Hip_Flexor_and_Quad_Stretch: { equipment: NONE },
  Peroneals_Stretch: { equipment: NONE },
  Posterior_Tibialis_Stretch: { equipment: NONE },
  Quad_Stretch: { equipment: NONE },
  Seated_Hamstring_and_Calf_Stretch: { equipment: NONE },
  Standing_Hamstring_and_Calf_Stretch: { equipment: NONE },
  'On-Your-Back_Quad_Stretch': { equipment: NONE },
  Standing_Elevated_Quad_Stretch: { equipment: NONE },
  Platform_Hamstring_Slides: { equipment: NONE },
  Standing_Biceps_Stretch: { equipment: NONE },

  // A hidden-kit rule read wrong: the bench or box is not the kit.
  Crunches: { equipment: NONE },
  'Flat_Bench_Leg_Pull-In': { equipment: NONE },
  'Decline_Push-Up': { equipment: NONE },
  'Push-Ups_With_Feet_Elevated': { equipment: NONE },
  'Incline_Push-Up': { equipment: NONE },
  Weighted_Crunches: { equipment: ['medicine_ball'] },
  Barbell_Rear_Delt_Row: { equipment: ['barbell'] },
  One_Arm_Floor_Press: { equipment: ['barbell'] },
  Inverted_Row: { equipment: ['barbell'] },
  Elevated_Back_Lunge: { equipment: ['barbell'] },
  Lying_Leg_Curls: { equipment: ['gym_machines'] },
  Machine_Bench_Press: { equipment: ['gym_machines'] },
  Low_Cable_Triceps_Extension: { equipment: ['gym_machines'] },
  Cable_Internal_Rotation: { equipment: ['gym_machines'] },
  'Full_Range-Of-Motion_Lat_Pulldown': { equipment: ['gym_machines'] },
  Speed_Band_Overhead_Triceps: { equipment: ['bands'] },
  'One-Arm_Side_Laterals': { equipment: ['dumbbell'] },
  'Standing_Palm-In_One-Arm_Dumbbell_Press': { equipment: ['dumbbell'] },
  Bench_Jump: { equipment: ['box'] },
  'Step-up_with_Knee_Raise': { equipment: ['box'] },
  Barbell_Step_Ups: { equipment: ['barbell', 'box'] },
  Dumbbell_Step_Ups: { equipment: ['box', 'dumbbell'] },
  Barbell_Squat_To_A_Bench: { equipment: ['barbell', 'bench'] },
  Hyperextensions_With_No_Hyperextension_Bench: { equipment: ['bench'] },
  // The dip of a jerk, not dip bars.
  Jerk_Dip_Squat: { equipment: ['barbell'] },

  // Cardio is done for time.
  Bicycling_Stationary: { unit: 'seconds', equipment: ['gym_machines'] },
  Elliptical_Trainer: { unit: 'seconds', equipment: ['gym_machines'] },
  Jogging_Treadmill: { unit: 'seconds', equipment: ['gym_machines'] },
  Recumbent_Bike: { unit: 'seconds', equipment: ['gym_machines'] },
  Rowing_Stationary: { unit: 'seconds', equipment: ['gym_machines'] },
  Running_Treadmill: { unit: 'seconds', equipment: ['gym_machines'] },
  Stairmaster: { unit: 'seconds', equipment: ['gym_machines'] },
  Step_Mill: { unit: 'seconds', equipment: ['gym_machines'] },
  Walking_Treadmill: { unit: 'seconds', equipment: ['gym_machines'] },
  Trail_Running_Walking: { unit: 'seconds', equipment: NONE },

  // The next glute-ham raise the muscle match reached for once the
  // bodyweight one was kept off (DN-174), for the same reason.
  'Floor_Glute-Ham_Raise': { excludeFromMuscleMatch: true },

  // "Squats - With Bands" is the bands-only one; this is under a barbell.
  Squat_with_Bands: { name: 'Barbell squat with bands' },
};
