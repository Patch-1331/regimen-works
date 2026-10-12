import {
  MATCH_THRESHOLD,
  MATCH_WEIGHTS,
  matchScore,
  muscleMatch,
  muscleMatchTargets,
  muscleMatchWhere,
  swapCandidatesWhere,
  swapSections,
  type MatchableExercise,
} from './muscle-match';

/**
 * The muscle-match substitute (DN-169), on fixtures shaped like the real
 * library's rows. The real library is held to it by
 * `src/seed/muscle-match-gaps.spec.ts`.
 */

const ex = (
  key: string,
  overrides: Partial<MatchableExercise> = {},
): MatchableExercise => ({
  id: key,
  key,
  equipment: [],
  unit: 'reps',
  category: 'strength',
  level: 'beginner',
  primaryMuscles: ['chest'],
  secondaryMuscles: ['shoulders', 'triceps'],
  force: 'push',
  mechanic: 'compound',
  movementGroup: null,
  curated: false,
  archivedAt: null,
  ...overrides,
});

const nothing = new Set<string>();

// Pressing
const barbellBench = ex('Barbell_Bench_Press', {
  equipment: ['barbell', 'bench'],
});
const pushUps = ex('Pushups', {
  curated: true,
  movementGroup: 'push_horizontal',
});
const dumbbellBench = ex('Dumbbell_Bench_Press', {
  equipment: ['dumbbell', 'bench'],
});
const militaryPress = ex('Standing_Military_Press', {
  equipment: ['barbell'],
  primaryMuscles: ['shoulders'],
  secondaryMuscles: ['triceps'],
});
const handstandPushUp = ex('Handstand_Push-Ups', {
  level: 'expert',
  primaryMuscles: ['shoulders'],
  secondaryMuscles: ['triceps'],
});
const pikePushUp = ex('rw-pike-push-up', {
  curated: true,
  primaryMuscles: ['shoulders'],
  secondaryMuscles: ['triceps', 'chest'],
});

// Pulling and hinging
const bentOverRow = ex('Bent_Over_Barbell_Row', {
  equipment: ['barbell'],
  primaryMuscles: ['middle_back'],
  secondaryMuscles: ['biceps', 'lats', 'shoulders'],
  force: 'pull',
});
const invertedRow = ex('Inverted_Row', {
  primaryMuscles: ['middle_back'],
  secondaryMuscles: ['biceps', 'lats', 'shoulders'],
  force: 'pull',
});
const superman = ex('Superman', {
  primaryMuscles: ['lower_back'],
  secondaryMuscles: ['glutes', 'hamstrings'],
  force: 'static',
  unit: 'seconds',
});
const deadlift = ex('Barbell_Deadlift', {
  equipment: ['barbell'],
  level: 'intermediate',
  primaryMuscles: ['lower_back'],
  secondaryMuscles: ['calves', 'forearms', 'glutes', 'hamstrings', 'lats'],
  force: 'pull',
});
const gluteBridge = ex('Butt_Lift_Bridge', {
  primaryMuscles: ['glutes'],
  secondaryMuscles: ['hamstrings'],
  force: 'push',
  mechanic: 'isolation',
});

// Holds
const ballPlank = ex('Stability_Ball_Plank', {
  equipment: ['stability_ball'],
  unit: 'seconds',
  primaryMuscles: ['abdominals'],
  secondaryMuscles: [],
  force: 'static',
});
const crunch = ex('Crunches', {
  primaryMuscles: ['abdominals'],
  secondaryMuscles: [],
  force: 'static',
});
const plank = ex('Plank', {
  unit: 'seconds',
  primaryMuscles: ['abdominals'],
  secondaryMuscles: [],
  force: 'static',
});

const library = [
  barbellBench,
  pushUps,
  dumbbellBench,
  militaryPress,
  handstandPushUp,
  pikePushUp,
  bentOverRow,
  invertedRow,
  superman,
  deadlift,
  gluteBridge,
  ballPlank,
  crunch,
  plank,
];

const match = (target: MatchableExercise, owned = nothing) =>
  muscleMatch(target, library, owned)?.key ?? null;

describe('muscleMatch', () => {
  it('drops a barbell bench press to a push-up for an athlete with nothing', () => {
    expect(match(barbellBench)).toBe('Pushups');
  });

  it('keeps the press loaded for an athlete with dumbbells and a bench', () => {
    // A perfect score either way; the one keeping the prescribed bench wins
    // the tie before the curated push-up can.
    expect(match(barbellBench, new Set(['dumbbell', 'bench']))).toBe(
      'Dumbbell_Bench_Press',
    );
  });

  it('drops a bent-over row to an inverted row', () => {
    expect(match(bentOverRow)).toBe('Inverted_Row');
  });

  it('never hands a military press over as a handstand push-up', () => {
    // The closer match on muscles, and expert to the press's beginner: an
    // automatic swap is never harder.
    expect(matchScore(militaryPress, handstandPushUp)).toBeGreaterThan(
      matchScore(militaryPress, pikePushUp),
    );
    expect(match(militaryPress)).toBe('rw-pike-push-up');
    expect(muscleMatch(militaryPress, [handstandPushUp], nothing)).toBeNull();
  });

  it('finds nothing for a barbell deadlift, rather than something loose', () => {
    // The superman is a hold and the bridge works the glutes first; neither
    // is a deadlift, so the movement stays as written.
    expect(match(deadlift)).toBeNull();
  });

  it('never turns a hold into a rep exercise', () => {
    expect(match(ballPlank)).toBe('Plank');
    expect(muscleMatch(ballPlank, [crunch], nothing)).toBeNull();
  });

  it('never crosses from strength to a stretch or a jump', () => {
    const stretch = ex('Chest_Stretch', { category: 'stretching' });
    const jump = ex('Clap_Push_Up', { category: 'plyometrics' });
    expect(muscleMatch(barbellBench, [stretch, jump], nothing)).toBeNull();
    // The lifting categories are all strength.
    const powerlifting = ex('Floor_Press', { category: 'powerlifting' });
    expect(muscleMatch(barbellBench, [powerlifting], nothing)?.key).toBe(
      'Floor_Press',
    );
  });

  it('only offers what the athlete can perform', () => {
    expect(
      muscleMatch(barbellBench, [dumbbellBench], new Set(['dumbbell'])),
    ).toBeNull();
  });

  it('never offers an archived row, a row with no muscles, or the movement itself', () => {
    const archived = ex('Old_Push_Up', { archivedAt: new Date() });
    const undescribed = ex('My_Push_Up', {
      key: null,
      primaryMuscles: [],
      secondaryMuscles: [],
    });
    expect(
      muscleMatch(barbellBench, [archived, undescribed, barbellBench], nothing),
    ).toBeNull();
  });

  it('matches nothing for a movement with no muscles to match on', () => {
    expect(
      muscleMatch(
        ex('My_Bench', { equipment: ['barbell'], primaryMuscles: [] }),
        library,
        nothing,
      ),
    ).toBeNull();
  });

  it('gives the same pick whatever order the rows come in', () => {
    const twins = [
      ex('B_Push_Up'),
      ex('A_Push_Up'),
      ex('C_Push_Up', { curated: true }),
    ];
    const forwards = muscleMatch(barbellBench, twins, nothing);
    const backwards = muscleMatch(barbellBench, [...twins].reverse(), nothing);
    expect(forwards?.key).toBe('C_Push_Up');
    expect(backwards?.key).toBe('C_Push_Up');
    expect(muscleMatch(barbellBench, twins.slice(0, 2), nothing)?.key).toBe(
      'A_Push_Up',
    );
    expect(
      muscleMatch(barbellBench, twins.slice(0, 2).reverse(), nothing)?.key,
    ).toBe('A_Push_Up');
  });

  it('prefers the movement’s own group on a tie', () => {
    const target = ex('Ring_Push_Up', {
      equipment: ['suspension_trainer'],
      movementGroup: 'push_horizontal',
    });
    const outside = ex('A_Push_Up', { curated: true });
    const inside = ex('Z_Push_Up', { movementGroup: 'push_horizontal' });
    expect(muscleMatch(target, [outside, inside], nothing)?.key).toBe(
      'Z_Push_Up',
    );
  });
});

describe('swapSections', () => {
  // Around a barbell bench press: a curated push-up that loads differently, a
  // perfect bodyweight twin, a harder push-up, a harder press needing kit.
  const kneePushUp = ex('rw-knee-push-up', {
    curated: true,
    mechanic: 'isolation',
  });
  const declinePushUp = ex('Decline_Push_Up');
  const archerPushUp = ex('Archer_Push_Up', { level: 'expert' });
  const ringFly = ex('Ring_Fly', {
    equipment: ['suspension_trainer'],
    level: 'expert',
  });
  const pool = [...library, kneePushUp, declinePushUp, archerPushUp, ringFly];
  const keys = (rows: MatchableExercise[]) => rows.map((e) => e.key);

  it('splits the matches into what can be done, what is harder, and what needs kit', () => {
    const sections = swapSections(barbellBench, pool, nothing);
    expect(keys(sections.main)).toEqual([
      'Pushups',
      'rw-knee-push-up',
      'Decline_Push_Up',
    ]);
    expect(keys(sections.harder)).toEqual(['Archer_Push_Up']);
    expect(keys(sections.needsEquipment)).toEqual(['Dumbbell_Bench_Press']);
  });

  it('puts curated moves first, ahead of a better score', () => {
    expect(matchScore(barbellBench, declinePushUp)).toBeGreaterThan(
      matchScore(barbellBench, kneePushUp),
    );
    const { main } = swapSections(barbellBench, pool, nothing);
    expect(main.indexOf(kneePushUp)).toBeLessThan(main.indexOf(declinePushUp));
  });

  it('moves a match into the main list once its kit is listed', () => {
    const sections = swapSections(
      barbellBench,
      pool,
      new Set(['dumbbell', 'bench']),
    );
    expect(keys(sections.main)).toContain('Dumbbell_Bench_Press');
    expect(sections.needsEquipment).toEqual([]);
  });

  it('offers a harder move needing unlisted kit nowhere', () => {
    const all = Object.values(swapSections(barbellBench, pool, nothing)).flat();
    expect(all).not.toContain(ringFly);
    expect(
      keys(
        swapSections(barbellBench, pool, new Set(['suspension_trainer']))
          .harder,
      ),
    ).toContain('Ring_Fly');
  });

  it('agrees with the automatic swap on the main list', () => {
    // Different orders -- the panel puts curated first, the automatic swap
    // the best score -- over the same rows.
    const { main } = swapSections(barbellBench, pool, nothing);
    expect(main).toContain(muscleMatch(barbellBench, pool, nothing));
  });

  it("offers the movement's own group whatever the score, sorted by level and kit", () => {
    // The hinge group: a bridge and a Romanian deadlift share no prime mover.
    const bridge = ex('Butt_Lift_Bridge', {
      movementGroup: 'hinge',
      primaryMuscles: ['glutes'],
      secondaryMuscles: ['hamstrings'],
      mechanic: 'isolation',
    });
    const rdl = ex('Romanian_Deadlift', {
      movementGroup: 'hinge',
      equipment: ['barbell'],
      level: 'intermediate',
      primaryMuscles: ['hamstrings'],
      secondaryMuscles: ['calves', 'glutes', 'lower_back'],
      force: 'pull',
    });
    const superman = ex('Superman', {
      movementGroup: 'hinge',
      unit: 'seconds',
      primaryMuscles: ['lower_back'],
      secondaryMuscles: ['glutes', 'hamstrings'],
      force: 'static',
    });
    expect(matchScore(bridge, rdl)).toBeLessThan(MATCH_THRESHOLD);

    const pool = [bridge, rdl, superman];
    expect(keys(swapSections(bridge, pool, nothing).main)).toEqual([
      'Superman',
    ]);
    expect(
      keys(swapSections(bridge, pool, new Set(['barbell'])).harder),
    ).toEqual(['Romanian_Deadlift']);
    // By score within the group: the superman shares more with the deadlift.
    expect(keys(swapSections(rdl, pool, nothing).main)).toEqual([
      'Superman',
      'Butt_Lift_Bridge',
    ]);
    // The automatic swap keeps to the muscle rules.
    expect(muscleMatch(rdl, pool, nothing)).toBeNull();
  });

  it('offers nothing for a movement with no muscles', () => {
    const sections = swapSections(
      ex('My_Bench', { equipment: ['barbell'], primaryMuscles: [] }),
      pool,
      nothing,
    );
    expect(Object.values(sections).flat()).toEqual([]);
  });
});

describe('the threshold', () => {
  it('cannot be cleared by a candidate sharing no muscle', () => {
    // What makes `muscleMatchWhere` safe to load by shared muscle.
    expect(MATCH_THRESHOLD).toBeGreaterThan(
      MATCH_WEIGHTS.force + MATCH_WEIGHTS.mechanic,
    );
  });

  it('weighs a perfect match at exactly 1', () => {
    expect(matchScore(barbellBench, pushUps)).toBeCloseTo(1);
  });
});

describe('muscleMatchTargets', () => {
  const movement = (
    exercise: MatchableExercise,
    fallbackExerciseId: string | null = null,
  ) => ({ exercise: { ...exercise, fallbackExerciseId } });

  it('asks only about what cannot be done and has no fallback and has muscles', () => {
    const targets = muscleMatchTargets(
      [
        movement(pushUps),
        movement(barbellBench),
        movement(bentOverRow, 'Inverted_Row'),
        movement(
          ex('My_Bench', { equipment: ['barbell'], primaryMuscles: [] }),
        ),
      ],
      nothing,
    );
    expect(targets.map((t) => t.key)).toEqual(['Barbell_Bench_Press']);
  });

  it('asks about nothing on the common day', () => {
    expect(
      muscleMatchTargets([movement(pushUps), movement(crunch)], nothing),
    ).toEqual([]);
  });
});

describe('muscleMatchWhere', () => {
  it('loads candidates in the targets’ units, kit and muscles', () => {
    const where = muscleMatchWhere(
      [barbellBench, ballPlank],
      new Set(['bar', 'dumbbell']),
    );
    expect(where.unit.in.sort()).toEqual(['reps', 'seconds']);
    expect(where.NOT.equipment.hasSome).not.toContain('bar');
    expect(where.NOT.equipment.hasSome).not.toContain('dumbbell');
    expect(where.NOT.equipment.hasSome).toContain('barbell');
    expect(where.OR[0]?.primaryMuscles?.hasSome.sort()).toEqual([
      'abdominals',
      'chest',
      'shoulders',
      'triceps',
    ]);
  });
});

describe('swapCandidatesWhere', () => {
  it('loads candidates whatever kit they need', () => {
    expect(JSON.stringify(swapCandidatesWhere(barbellBench))).not.toContain(
      'NOT',
    );
  });

  it("loads the movement's own group, whatever the muscles say", () => {
    expect(swapCandidatesWhere(pushUps).OR).toContainEqual({
      movementGroup: 'push_horizontal',
    });
    expect(swapCandidatesWhere(barbellBench).OR).toHaveLength(1);
  });
});
