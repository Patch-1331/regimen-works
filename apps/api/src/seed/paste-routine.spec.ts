import { matchPastedMovement, parsePastedRoutine } from '@regimen-works/shared';
import { loadLibrary } from '../../prisma/library';

/**
 * The paste box's matcher against the library that actually ships (DN-152).
 *
 * The worked example is DN-131's transcription of a real routine, and the
 * table is DN-152's acceptance, reviewed line by line on 2026-10-14. It sits
 * here rather than beside the matcher because the library is built here: a
 * curation change that renames or adds an exercise can change a line's
 * answer, and this is where that should fail.
 *
 * A ✕ is a refusal -- nothing in the library, or several equally good. A ✓
 * must be the same movement, so a ✓ appearing on a ✕ line fails as surely as
 * a ✓ line losing its match.
 */

const WORKED_EXAMPLE = `Monday — Chest and Triceps
Incline Dumbbell Chest Press 3x8
Barbell Bench Press 3x8
Low Cable Fly 4x8-10
Decline Skull Crusher 4x8-10
Dips 4x8-10

Tuesday — Lower Body
Barbell Squat 5x5 @ 225
Barbell Deadlift 5x5
Dumbbell Step Ups 3x8-12
Dumbbell Lunge 3x8-12
Leg Press 3x15-20

Wednesday — Traps and Shoulders
Barbell Row 5x5
Barbell Shrug 5x5
Dumbbell Shoulder Press 5x5
Seated Dumbbell Shrug 4x12
Dumbbell Lateral Raise 4x12

Thursday — Back and Biceps
Weighted Pull Ups 5x5
Underhand Grip Lat Pulldown 3x12-15
Barbell Curl 3x12-15
Dumbbell Palms-Up Curl 3x12-15

Friday — Upper Focused
Bent Over Barbell Row 2x10-15 & 2x5-8
Floor Press 2x10-15 & 2x5-8
Neutral Grip Pull Up 1x10 & 2xfailure
Push Press 1x10 & 2x5-8
Inverted Row 3x10
Plank 3x60s rest 45s
`;

/** DN-152's acceptance table: the library name, or null for ✕. */
const EXPECTED: [string, string | null][] = [
  ['Incline Dumbbell Chest Press', 'Incline dumbbell press'],
  ['Barbell Bench Press', 'Barbell bench press - medium grip'],
  ['Low Cable Fly', null],
  ['Decline Skull Crusher', null],
  ['Dips', null],
  ['Barbell Squat', 'Barbell squat'],
  ['Barbell Deadlift', 'Barbell deadlift'],
  ['Dumbbell Step Ups', 'Dumbbell step ups'],
  ['Dumbbell Lunge', 'Dumbbell lunges'],
  ['Leg Press', 'Leg press'],
  ['Barbell Row', null],
  ['Barbell Shrug', 'Barbell shrug'],
  ['Dumbbell Shoulder Press', 'Dumbbell shoulder press'],
  ['Seated Dumbbell Shrug', 'Dumbbell shrug'],
  ['Dumbbell Lateral Raise', 'Side lateral raise'],
  ['Weighted Pull Ups', 'Weighted pull ups'],
  ['Underhand Grip Lat Pulldown', null],
  ['Barbell Curl', 'Barbell curl'],
  ['Dumbbell Palms-Up Curl', null],
  ['Bent Over Barbell Row', 'Bent over barbell row'],
  ['Floor Press', 'Floor press'],
  ['Neutral Grip Pull Up', 'Pullups'],
  ['Push Press', null],
  ['Inverted Row', 'Inverted row'],
  ['Plank', 'Plank'],
];

const { exercises } = loadLibrary();
const routine = parsePastedRoutine(WORKED_EXAMPLE);
const lines = routine.days.flatMap((d) => d.lines);

describe('pasting the worked example against the shipped library', () => {
  it('reads five weekdays, Monday to Friday', () => {
    expect(routine.scheduleMode).toBe('fixed');
    expect(routine.days.map((d) => d.dayOfWeek)).toEqual([1, 2, 3, 4, 5]);
    expect(lines.map((l) => l.name)).toEqual(EXPECTED.map(([name]) => name));
  });

  it.each(EXPECTED)('%s → %s', (pasted, expected) => {
    const result = matchPastedMovement(pasted, exercises);
    expect(result.kind === 'match' ? result.exercise.name : null).toBe(
      expected,
    );
  });

  it('accepts 18 lines and refuses 7', () => {
    const accepted = lines.filter(
      (l) => matchPastedMovement(l.name, exercises).kind === 'match',
    );
    expect(accepted).toHaveLength(18);
  });
});
