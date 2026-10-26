import {
  MATCH_THRESHOLD,
  alternativeSuggestions,
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
  excludeFromMuscleMatch: false,
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

describe('a movement kept off the muscle match (DN-174)', () => {
  // Real rows. Each pair shares the prime mover, the force and the mechanic,
  // and the bad pick is the only candidate clearing the threshold -- so no
  // reweighting moves it down, and a person has to say no.
  const clean = ex('Clean', {
    equipment: ['barbell'],
    category: 'olympic_weightlifting',
    level: 'intermediate',
    primaryMuscles: ['hamstrings'],
    secondaryMuscles: [
      'calves',
      'forearms',
      'glutes',
      'lower_back',
      'quadriceps',
      'shoulders',
      'traps',
    ],
    force: 'pull',
  });
  const gluteHamRaise = ex('Natural_Glute_Ham_Raise', {
    level: 'intermediate',
    primaryMuscles: ['hamstrings'],
    secondaryMuscles: ['calves', 'glutes', 'lower_back'],
    force: 'pull',
    excludeFromMuscleMatch: true,
  });
  const snowAngels = ex('rw-supermans-reverse-snow-angels', {
    curated: true,
    movementGroup: 'pull',
    primaryMuscles: ['middle_back'],
    secondaryMuscles: ['lower_back', 'shoulders', 'traps'],
    force: 'pull',
    excludeFromMuscleMatch: true,
  });
  const pool = [clean, gluteHamRaise, bentOverRow, snowAngels];
  const keys = (rows: MatchableExercise[]) => rows.map((e) => e.key);

  it('would otherwise clear the threshold', () => {
    expect(matchScore(clean, gluteHamRaise)).toBeGreaterThan(MATCH_THRESHOLD);
    expect(matchScore(bentOverRow, snowAngels)).toBeGreaterThan(
      MATCH_THRESHOLD,
    );
  });

  it('never hands a clean over as a glute-ham raise', () => {
    expect(muscleMatch(clean, pool, nothing)).toBeNull();
  });

  it('never hands a row over as snow angels', () => {
    expect(muscleMatch(bentOverRow, pool, nothing)).toBeNull();
  });

  it('leaves both out of the swap panel', () => {
    for (const target of [clean, bentOverRow]) {
      const all = Object.values(swapSections(target, pool, nothing)).flat();
      expect(keys(all)).toEqual([]);
    }
  });

  it('still reaches its own group', () => {
    const pullUp = ex('Pullups', {
      curated: true,
      movementGroup: 'pull',
      equipment: ['bar'],
      primaryMuscles: ['lats'],
      secondaryMuscles: ['biceps', 'middle_back'],
      force: 'pull',
    });
    expect(keys(swapSections(pullUp, [snowAngels], nothing).main)).toEqual([
      'rw-supermans-reverse-snow-angels',
    ]);
    // A group mate the muscles would also pick.
    const mate = { ...bentOverRow, movementGroup: 'pull' };
    expect(muscleMatch(mate, [snowAngels], nothing)?.key).toBe(
      'rw-supermans-reverse-snow-angels',
    );
  });

  it('leaves the next-best match standing', () => {
    expect(muscleMatch(bentOverRow, [...pool, invertedRow], nothing)?.key).toBe(
      'Inverted_Row',
    );
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

describe('alternativeSuggestions (DN-205)', () => {
  // A movement still being written: no key, no id yet, and only what its
  // author has said about it so far.
  const draft = (overrides: Partial<MatchableExercise> = {}) =>
    ex('', {
      equipment: ['dumbbell'],
      primaryMuscles: ['shoulders'],
      secondaryMuscles: ['triceps'],
      category: null,
      level: null,
      ...overrides,
    });
  const bodyweight = library.filter((e) => e.equipment.length === 0);
  const suggest = (target: MatchableExercise, limit = 3) =>
    alternativeSuggestions(target, bodyweight, limit).map((e) => e.key);

  it('ranks by the automatic swap’s score, best first', () => {
    // Undescribed difficulty proves nothing either way, so the harder
    // handstand push-up is offered -- a person is choosing, not the app.
    expect(suggest(draft())).toEqual(['Handstand_Push-Ups', 'rw-pike-push-up']);
  });

  it('never suggests a harder movement where both levels are known', () => {
    expect(suggest(draft({ level: 'beginner' }))).toEqual(['rw-pike-push-up']);
  });

  it('keeps to the draft’s category class when it names one', () => {
    expect(suggest(draft({ category: 'stretching' }))).toEqual([]);
  });

  it('suggests only movements counted in the same unit', () => {
    const hold = draft({
      unit: 'seconds',
      primaryMuscles: ['abdominals'],
      secondaryMuscles: [],
      force: 'static',
    });
    expect(suggest(hold)).toEqual(['Plank']);
  });

  it('suggests nothing for a draft with no prime mover yet', () => {
    expect(suggest(draft({ primaryMuscles: [] }))).toEqual([]);
  });

  it('stops at the limit', () => {
    expect(suggest(draft(), 1)).toEqual(['Handstand_Push-Ups']);
  });
});
