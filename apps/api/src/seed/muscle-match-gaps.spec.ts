import { loadLibrary } from '../../prisma/library';
import { muscleMatch, muscleMatchTargets } from '../scheduler/muscle-match';

/**
 * The muscle match (DN-169) over the library that ships, for an athlete who
 * owns nothing: every movement needing kit, with no hand-written fallback,
 * that finds no substitute and so stays on the plate as written.
 *
 * The list is the known gaps, checked in so that a new one fails here
 * rather than on someone's Today screen. Mostly isolation work no bodyweight
 * movement honestly stands in for -- curls, flyes, calf raises, cable and
 * machine moves -- and the heavy lifts, where a loose match would be a
 * different workout under the prescribed reps. A gap closes with a
 * hand-written fallback, or is accepted by staying on this list.
 */

/** Sorted. Remove a line when a fallback closes it. */
const KNOWN_GAPS = [
  'Advanced_Kettlebell_Windmill',
  'Alternate_Hammer_Curl',
  'Alternate_Incline_Dumbbell_Curl',
  'Alternating_Kettlebell_Row',
  'Alternating_Renegade_Row',
  'Backward_Medicine_Ball_Throw',
  'Band_Assisted_Pull-Up',
  'Band_Hip_Adductions',
  'Band_Pull_Apart',
  'Barbell_Curl',
  'Barbell_Curls_Lying_Against_An_Incline',
  'Barbell_Deadlift',
  'Barbell_Rear_Delt_Row',
  'Barbell_Seated_Calf_Raise',
  'Bent-Arm_Barbell_Pullover',
  'Bent_Over_Dumbbell_Rear_Delt_Raise_With_Head_On_Bench',
  'Bent_Over_Low-Pulley_Side_Lateral',
  'Bottoms-Up_Clean_From_The_Hang_Position',
  'Brachialis-SMR',
  'Butterfly',
  'Cable_Hammer_Curls_-_Rope_Attachment',
  'Cable_Hip_Adduction',
  'Cable_Incline_Pushdown',
  'Cable_Iron_Cross',
  'Cable_Preacher_Curl',
  'Cable_Rear_Delt_Fly',
  'Cable_Rope_Rear-Delt_Rows',
  'Cable_Seated_Lateral_Raise',
  'Cable_Wrist_Curl',
  'Calf_Press',
  'Calf_Press_On_The_Leg_Press_Machine',
  'Calf_Raise_On_A_Dumbbell',
  'Calf_Raises_-_With_Bands',
  'Car_Drivers',
  'Catch_and_Overhead_Throw',
  'Clean_Deadlift',
  'Clean_Shrug',
  'Close-Grip_EZ-Bar_Curl_with_Band',
  'Close-Grip_EZ_Bar_Curl',
  'Close-Grip_Front_Lat_Pulldown',
  'Close-Grip_Standing_Barbell_Curl',
  'Concentration_Curls',
  'Cross_Body_Hammer_Curl',
  'Donkey_Calf_Raises',
  'Double_Kettlebell_Snatch',
  'Downward_Facing_Balance',
  'Drag_Curl',
  'Dumbbell_Alternate_Bicep_Curl',
  'Dumbbell_Bicep_Curl',
  'Dumbbell_Flyes',
  'Dumbbell_Lying_One-Arm_Rear_Lateral_Raise',
  'Dumbbell_Lying_Pronation',
  'Dumbbell_Lying_Rear_Lateral_Raise',
  'Dumbbell_Lying_Supination',
  'Dumbbell_One-Arm_Upright_Row',
  'Dumbbell_Prone_Incline_Curl',
  'Dumbbell_Raise',
  'Dumbbell_Scaption',
  'Dumbbell_Seated_One-Leg_Calf_Raise',
  'EZ-Bar_Curl',
  'Elevated_Cable_Rows',
  'External_Rotation',
  'External_Rotation_with_Cable',
  'Face_Pull',
  'Finger_Curls',
  'Flat_Bench_Cable_Flyes',
  'Flexor_Incline_Dumbbell_Curls',
  'Full_Range-Of-Motion_Lat_Pulldown',
  'Gironda_Sternum_Chins',
  'Hammer_Curls',
  'High_Cable_Curls',
  'Hip_Flexion_with_Band',
  'Incline_Bench_Pull',
  'Incline_Dumbbell_Curl',
  'Incline_Hammer_Curls',
  'Incline_Inner_Biceps_Curl',
  'Internal_Rotation_with_Band',
  'Kettlebell_Figure_8',
  'Kettlebell_Halo',
  'Kettlebell_Sumo_High_Pull',
  'Kipping_Muscle_Up',
  'Kneeling_High_Pulley_Row',
  'Kneeling_Single-Arm_High_Pulley_Row',
  'Leg_Extensions',
  'Leverage_Iso_Row',
  'Low_Pulley_Row_To_Neck',
  'Lying_Cable_Curl',
  'Lying_Cambered_Barbell_Row',
  'Lying_Close-Grip_Bar_Curl_On_High_Pulley',
  'Lying_Face_Down_Plate_Neck_Resistance',
  'Lying_Face_Up_Plate_Neck_Resistance',
  'Lying_High_Bench_Barbell_Curl',
  'Lying_One-Arm_Lateral_Raise',
  'Lying_Rear_Delt_Raise',
  'Lying_Supine_Dumbbell_Curl',
  'Machine_Bicep_Curl',
  'Machine_Preacher_Curls',
  'Medicine_Ball_Full_Twist',
  'Medicine_Ball_Scoop_Throw',
  'Middle_Back_Shrug',
  'Monster_Walk',
  'Muscle_Up',
  'One-Arm_Flat_Bench_Dumbbell_Flye',
  'One-Arm_Kettlebell_Snatch',
  'One-Arm_Kettlebell_Split_Snatch',
  'One_Arm_Dumbbell_Preacher_Curl',
  'One_Arm_Lat_Pulldown',
  'Overhead_Cable_Curl',
  'Overhead_Slam',
  'Palms-Down_Dumbbell_Wrist_Curl_Over_A_Bench',
  'Palms-Down_Wrist_Curl_Over_A_Bench',
  'Palms-Up_Barbell_Wrist_Curl_Over_A_Bench',
  'Palms-Up_Dumbbell_Wrist_Curl_Over_A_Bench',
  'Plate_Pinch',
  'Preacher_Curl',
  'Preacher_Hammer_Dumbbell_Curl',
  'Pyramid',
  'Rack_Delivery',
  'Return_Push_from_Stance',
  'Reverse_Barbell_Curl',
  'Reverse_Barbell_Preacher_Curls',
  'Reverse_Cable_Curl',
  'Reverse_Flyes',
  'Reverse_Flyes_With_External_Rotation',
  'Reverse_Machine_Flyes',
  'Reverse_Plate_Curls',
  'Rocking_Standing_Calf_Raise',
  'Rocky_Pull-Ups_Pulldowns',
  'Rope_Straight-Arm_Pulldown',
  'Rowing_Stationary',
  'Seated_Bent-Over_Rear_Delt_Raise',
  'Seated_Calf_Raise',
  'Seated_Close-Grip_Concentration_Barbell_Curl',
  'Seated_Dumbbell_Curl',
  'Seated_Dumbbell_Inner_Biceps_Curl',
  'Seated_Dumbbell_Palms-Down_Wrist_Curl',
  'Seated_Dumbbell_Palms-Up_Wrist_Curl',
  'Seated_One-Arm_Dumbbell_Palms-Down_Wrist_Curl',
  'Seated_One-Arm_Dumbbell_Palms-Up_Wrist_Curl',
  'Seated_Palm-Up_Barbell_Wrist_Curl',
  'Seated_Palms-Down_Barbell_Wrist_Curl',
  'Seated_Two-Arm_Palms-Up_Low-Pulley_Wrist_Curl',
  'Shotgun_Row',
  'Side_Laterals_to_Front_Raise',
  'Side_To_Side_Chins',
  'Single-Arm_Cable_Crossover',
  'Single-Leg_Leg_Extension',
  'Single_Dumbbell_Raise',
  'Smith_Incline_Shoulder_Raise',
  'Smith_Machine_Calf_Raise',
  'Smith_Machine_One-Arm_Upright_Row',
  'Smith_Machine_Reverse_Calf_Raises',
  'Smith_Machine_Upright_Row',
  'Snatch',
  'Snatch_Shrug',
  'Spider_Curl',
  'Standing_Barbell_Calf_Raise',
  'Standing_Biceps_Cable_Curl',
  'Standing_Calf_Raises',
  'Standing_Concentration_Curl',
  'Standing_Dumbbell_Calf_Raise',
  'Standing_Dumbbell_Reverse_Curl',
  'Standing_Dumbbell_Upright_Row',
  'Standing_Inner-Biceps_Curl',
  'Standing_Low-Pulley_Deltoid_Raise',
  'Standing_Olympic_Plate_Hand_Squeeze',
  'Standing_One-Arm_Cable_Curl',
  'Standing_One-Arm_Dumbbell_Curl_Over_Incline_Bench',
  'Standing_Palms-Up_Barbell_Behind_The_Back_Wrist_Curl',
  'Standing_Two-Arm_Overhead_Throw',
  'Straight-Arm_Pulldown',
  'Straight_Raises_on_Incline_Bench',
  'Supine_Chest_Throw',
  'Supine_One-Arm_Overhead_Throw',
  'Supine_Two-Arm_Overhead_Throw',
  'Thigh_Abductor',
  'Thigh_Adductor',
  'Two-Arm_Dumbbell_Preacher_Curl',
  'Two-Arm_Kettlebell_Clean',
  'Underhand_Cable_Pulldowns',
  'Upright_Barbell_Row',
  'Upright_Cable_Row',
  'Upright_Row_-_With_Bands',
  'V-Bar_Pulldown',
  'V-Bar_Pullup',
  'Weighted_Pull_Ups',
  'Wide-Grip_Lat_Pulldown',
  'Wide-Grip_Pulldown_Behind_The_Neck',
  'Wide-Grip_Rear_Pull-Up',
  'Wide-Grip_Standing_Barbell_Curl',
  'Wrist_Rotations_with_Straight_Bar',
  'Zottman_Curl',
  'Zottman_Preacher_Curl',
];

const rows = loadLibrary().exercises.map((e) => ({
  ...e,
  id: e.key,
  archivedAt: null,
  fallbackExerciseId: e.fallback ?? null,
}));
const owned = new Set<string>();
const targets = muscleMatchTargets(
  rows.map((exercise) => ({ exercise })),
  owned,
);

describe('the muscle match over the real library (DN-169)', () => {
  it('is asked about every equipment movement with no fallback', () => {
    // Every one has muscles to match on; one without would be skipped
    // silently rather than counted as a gap.
    const unasked = rows.filter(
      (e) =>
        e.equipment.length > 0 &&
        e.fallbackExerciseId === null &&
        !targets.includes(e),
    );
    expect(unasked.map((e) => e.key)).toEqual([]);
    expect(targets.length).toBeGreaterThan(600);
  });

  it('leaves only the known gaps for an athlete who owns nothing', () => {
    const gaps = targets
      .filter((t) => muscleMatch(t, rows, owned) === null)
      .map((t) => t.key)
      .sort();
    expect(gaps).toEqual(KNOWN_GAPS);
  });

  it('hands each match over in the target’s unit, needing nothing', () => {
    for (const t of targets) {
      const m = muscleMatch(t, rows, owned);
      if (!m) continue;
      expect([t.key, m.unit, m.equipment]).toEqual([t.key, t.unit, []]);
    }
  });
});
