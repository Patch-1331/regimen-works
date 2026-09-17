import {
  ExerciseWithLine,
  RecentAssignment,
  WodCandidate,
  applyEquipmentAvailability,
  applyEquipmentFloor,
  applyRememberedChoice,
  applySubstitutions,
  dominantMovement,
  getWeekRange,
  isRestDay,
  pickWod,
  unperformableSubstituteIds,
} from './scheduler.logic';

const cindy: WodCandidate = {
  id: '1',
  name: 'Cindy',
  type: 'amrap',
  dominantPattern: 'pull',
};
const chalkLine: WodCandidate = {
  id: '2',
  name: 'Chalk Line',
  type: 'for_time',
  dominantPattern: 'cardio',
};
const coreCindy: WodCandidate = {
  id: '3',
  name: 'Core Cindy',
  type: 'amrap',
  dominantPattern: 'core',
};
const rungByRung: WodCandidate = {
  id: '4',
  name: 'Rung by Rung',
  type: 'amrap',
  dominantPattern: 'pull',
};

const library = [cindy, chalkLine, coreCindy, rungByRung];
const always0 = () => 0; // deterministic rng: always picks pool[0]

describe('pickWod', () => {
  it('picks from the full library when there is no history', () => {
    const result = pickWod(library, [], '2026-08-23', 5, always0);
    expect(library).toContainEqual(result);
  });

  it('excludes WODs sharing a name or dominant pattern used within the cooldown window', () => {
    const history: RecentAssignment[] = [{ date: '2026-08-22', wod: cindy }];
    // cindy and rungByRung are both "pull" — both should be excluded within a 5-day cooldown
    const result = pickWod(library, history, '2026-08-23', 5, always0);
    expect(result.dominantPattern).not.toBe('pull');
  });

  it('ignores history outside the cooldown window', () => {
    const history: RecentAssignment[] = [{ date: '2026-08-01', wod: cindy }];
    // 22 days before "today" — well outside a 5-day cooldown, so pull is fair game again
    const result = pickWod(library, history, '2026-08-23', 5, always0);
    expect(library.map((w) => w.id)).toContain(result.id);
  });

  it('falls back to excluding only the exact last WOD when cooldown empties the pool', () => {
    // A library where every WOD shares one of two patterns; cooldown after a "pull" WOD
    // would normally exclude every "pull" WOD — here that's everything except chalkLine.
    const smallLibrary = [cindy, rungByRung];
    const history: RecentAssignment[] = [{ date: '2026-08-22', wod: cindy }];
    const result = pickWod(smallLibrary, history, '2026-08-23', 5, always0);
    expect(result.name).not.toBe('Cindy');
    expect(result.name).toBe('Rung by Rung');
  });

  it('returns the only candidate when the library has just one WOD', () => {
    const result = pickWod(
      [cindy],
      [{ date: '2026-08-22', wod: cindy }],
      '2026-08-23',
      5,
      always0,
    );
    expect(result).toEqual(cindy);
  });

  it("prefers a different WOD type than yesterday's when the pool allows it", () => {
    // History has no pattern/name overlap with chalkLine or coreCindy, but yesterday was
    // "for_time" (chalkLine) — the alternation rule should steer toward "amrap".
    const history: RecentAssignment[] = [
      { date: '2026-08-22', wod: chalkLine },
    ];
    const twoWodPool = [chalkLine, coreCindy];
    const result = pickWod(twoWodPool, history, '2026-08-23', 5, always0);
    expect(result.type).toBe('amrap');
  });
});

describe('getWeekRange', () => {
  it('returns Monday–Sunday for a mid-week date', () => {
    // 2026-08-19 is a Wednesday
    expect(getWeekRange('2026-08-19')).toEqual({
      start: '2026-08-17',
      end: '2026-08-23',
    });
  });

  it('handles a Sunday correctly (end of its own week, not start of the next)', () => {
    expect(getWeekRange('2026-08-23')).toEqual({
      start: '2026-08-17',
      end: '2026-08-23',
    });
  });

  it('handles a Monday correctly', () => {
    expect(getWeekRange('2026-08-17')).toEqual({
      start: '2026-08-17',
      end: '2026-08-23',
    });
  });
});

describe('isRestDay', () => {
  it('is false while under the weekly cap', () => {
    expect(isRestDay(4, 5)).toBe(false);
  });

  it('is true once the weekly cap is reached', () => {
    expect(isRestDay(5, 5)).toBe(true);
  });

  it('is true if somehow over the cap', () => {
    expect(isRestDay(6, 5)).toBe(true);
  });
});

describe('applyRememberedChoice', () => {
  type FakeExercise = ExerciseWithLine & { name: string };
  const kneePushUp: FakeExercise = {
    name: 'Knee push-up',
    line: 'push_horizontal',
  };
  const pushUp: FakeExercise = { name: 'Push-up', line: 'push_horizontal' };
  const diamondPushUp: FakeExercise = {
    name: 'Diamond push-up',
    line: 'push_horizontal',
  };
  const airSquat: FakeExercise = { name: 'Air squat', line: 'squat' };
  const pistolSquat: FakeExercise = { name: 'Pistol squat', line: 'squat' };
  const burpee: FakeExercise = { name: 'Burpee', line: null };

  const exerciseAtRung = new Map<string, FakeExercise>([
    ['push_horizontal:0', kneePushUp],
    ['push_horizontal:1', pushUp],
    ['push_horizontal:2', diamondPushUp],
    ['squat:0', airSquat],
    ['squat:3', pistolSquat],
  ]);

  it('substitutes a movement for the exercise at the current rung on its line', () => {
    const movements = [{ reps: 10, exercise: pushUp }];
    const currentRung = new Map([['push_horizontal', 0]]);
    const result = applyRememberedChoice(
      movements,
      currentRung,
      exerciseAtRung,
    );
    expect(result[0].exercise).toBe(kneePushUp);
    expect(result[0].reps).toBe(10); // reps untouched — only the exercise changes
  });

  it('leaves a movement unchanged when its exercise has no tracked line', () => {
    const movements = [{ reps: 15, exercise: burpee }];
    const currentRung = new Map([['push_horizontal', 2]]);
    const result = applyRememberedChoice(
      movements,
      currentRung,
      exerciseAtRung,
    );
    expect(result[0].exercise).toBe(burpee);
  });

  it('leaves a movement unchanged when its line has no recorded rung', () => {
    const movements = [{ reps: 5, exercise: pistolSquat }];
    const currentRung = new Map<string, number>(); // no squat entry at all
    const result = applyRememberedChoice(
      movements,
      currentRung,
      exerciseAtRung,
    );
    expect(result[0].exercise).toBe(pistolSquat);
  });

  it('leaves a movement unchanged when no exercise exists at that line+rung', () => {
    const movements = [{ reps: 5, exercise: airSquat }];
    const currentRung = new Map([['squat', 99]]); // no exercise seeded at squat:99
    const result = applyRememberedChoice(
      movements,
      currentRung,
      exerciseAtRung,
    );
    expect(result[0].exercise).toBe(airSquat);
  });

  it('substitutes multiple movements independently across different lines', () => {
    const movements = [
      { reps: 10, exercise: pushUp },
      { reps: 5, exercise: airSquat },
    ];
    const currentRung = new Map([
      ['push_horizontal', 2],
      ['squat', 3],
    ]);
    const result = applyRememberedChoice(
      movements,
      currentRung,
      exerciseAtRung,
    );
    expect(result[0].exercise).toBe(diamondPushUp);
    expect(result[1].exercise).toBe(pistolSquat);
  });
});

describe('applyEquipmentAvailability', () => {
  type FakeExercise = {
    id: string;
    name: string;
    equipment: string[];
    altExerciseId: string | null;
  };

  const rowUnderTable: FakeExercise = {
    id: 'row',
    name: 'Row under table',
    equipment: [],
    altExerciseId: null,
  };
  const pullUp: FakeExercise = {
    id: 'pull-up',
    name: 'Pull-up',
    equipment: ['bar'],
    altExerciseId: 'row',
  };
  const burpee: FakeExercise = {
    id: 'burpee',
    name: 'Burpee',
    equipment: [],
    altExerciseId: null,
  };
  const barMuscleUp: FakeExercise = {
    id: 'muscle-up',
    name: 'Bar muscle-up',
    equipment: ['bar'],
    altExerciseId: null, // the data gap DN-83 exists to stop
  };
  const boxStepUp: FakeExercise = {
    id: 'step-up',
    name: 'Box step-up',
    equipment: ['box'],
    altExerciseId: 'lunge',
  };
  const weightedStepUp: FakeExercise = {
    id: 'weighted-step-up',
    name: 'Weighted box step-up',
    equipment: ['box', 'dumbbell'],
    altExerciseId: 'step-up',
  };
  const lunge: FakeExercise = {
    id: 'lunge',
    name: 'Lunge',
    equipment: [],
    altExerciseId: null,
  };

  const substituteById = new Map<string, FakeExercise>([
    ['row', rowUnderTable],
    ['lunge', lunge],
    ['step-up', boxStepUp],
  ]);

  const owning = (...pieces: string[]) => new Set(pieces);

  it('leaves a movement alone when the athlete owns what it needs', () => {
    const movements = [{ reps: 10, exercise: pullUp }];
    const result = applyEquipmentAvailability(
      movements,
      owning('bar'),
      substituteById,
    );
    expect(result[0].exercise).toBe(pullUp);
  });

  it('falls to the alternative when the athlete owns nothing for it', () => {
    const movements = [{ reps: 10, exercise: pullUp }];
    const result = applyEquipmentAvailability(
      movements,
      owning('jump_rope'),
      substituteById,
    );
    expect(result[0].exercise).toBe(rowUnderTable);
    expect(result[0].reps).toBe(10); // reps untouched — only the exercise changes
  });

  it('passes an untagged movement through for an athlete who owns nothing', () => {
    // Bodyweight is the absence of a tag rather than a piece of the catalog
    // (DN-77), so "needs nothing" has to survive "owns nothing".
    const movements = [{ reps: 15, exercise: burpee }];
    const result = applyEquipmentAvailability(
      movements,
      owning(),
      substituteById,
    );
    expect(result[0].exercise).toBe(burpee);
  });

  it('requires every piece a movement is tagged with, not just one', () => {
    const movements = [{ reps: 12, exercise: weightedStepUp }];
    const result = applyEquipmentAvailability(
      movements,
      owning('box'),
      substituteById,
    );
    expect(result[0].exercise).toBe(boxStepUp);
  });

  it('takes the substitute as given rather than walking the chain again', () => {
    // One step, not a walk: this athlete owns no box either, and the step-up
    // still stands. "Every alternative is performable on the baseline" is a
    // property the seed owes (DN-83), not one recomputed per athlete per day.
    const movements = [{ reps: 12, exercise: weightedStepUp }];
    const result = applyEquipmentAvailability(
      movements,
      owning(),
      substituteById,
    );
    expect(result[0].exercise).toBe(boxStepUp);
  });

  it('leaves a movement unchanged when it has no alternative at all', () => {
    // A hole in the movement list is worse than a movement the athlete has to
    // sort out themselves, so the gap passes through rather than throwing.
    const movements = [{ reps: 5, exercise: barMuscleUp }];
    const result = applyEquipmentAvailability(
      movements,
      owning(),
      substituteById,
    );
    expect(result[0].exercise).toBe(barMuscleUp);
  });

  it('leaves a movement unchanged when its alternative is missing from the map', () => {
    const movements = [{ reps: 5, exercise: pullUp }];
    const result = applyEquipmentAvailability(
      movements,
      owning(),
      new Map<string, FakeExercise>(),
    );
    expect(result[0].exercise).toBe(pullUp);
  });

  it('drops several movements independently', () => {
    const movements = [
      { reps: 10, exercise: pullUp },
      { reps: 20, exercise: burpee },
      { reps: 12, exercise: boxStepUp },
    ];
    const result = applyEquipmentAvailability(
      movements,
      owning('bar'),
      substituteById,
    );
    expect(result[0].exercise).toBe(pullUp);
    expect(result[1].exercise).toBe(burpee);
    expect(result[2].exercise).toBe(lunge);
  });
});

describe('unperformableSubstituteIds', () => {
  type Tagged = { equipment: string[]; altExerciseId: string | null };
  const pullUp: Tagged = { equipment: ['bar'], altExerciseId: 'row' };
  const chinUp: Tagged = { equipment: ['bar'], altExerciseId: 'row' };
  const burpee: Tagged = { equipment: [], altExerciseId: null };
  const muscleUp: Tagged = { equipment: ['bar'], altExerciseId: null };
  const doubleUnder: Tagged = {
    equipment: ['jump_rope'],
    altExerciseId: 'high-knees',
  };

  it('asks for nothing when the athlete owns what the WOD needs', () => {
    // The common day, and the reason the resolver can skip its second query.
    const movements = [{ exercise: pullUp }, { exercise: burpee }];
    expect(unperformableSubstituteIds(movements, new Set(['bar']))).toEqual([]);
  });

  it('asks only for the movements the athlete cannot perform', () => {
    const movements = [{ exercise: pullUp }, { exercise: doubleUnder }];
    expect(unperformableSubstituteIds(movements, new Set(['bar']))).toEqual([
      'high-knees',
    ]);
  });

  it('asks for one row when two movements share an alternative', () => {
    const movements = [{ exercise: pullUp }, { exercise: chinUp }];
    expect(unperformableSubstituteIds(movements, new Set())).toEqual(['row']);
  });

  it('skips a movement with no alternative to ask for', () => {
    const movements = [{ exercise: muscleUp }];
    expect(unperformableSubstituteIds(movements, new Set())).toEqual([]);
  });
});

describe('applySubstitutions', () => {
  type FakeExercise = { name: string };
  const chinUp: FakeExercise = { name: 'Chin-up' };
  const negative: FakeExercise = { name: 'Negative chin-up' };
  const rowUnderTable: FakeExercise = { name: 'Row under table' };

  const exerciseById = new Map<string, FakeExercise>([
    ['chin-up', chinUp],
    ['negative', negative],
    ['row', rowUnderTable],
  ]);

  it('swaps the movement the athlete tapped', () => {
    const movements = [{ id: 'm1', reps: 15, exercise: negative }];
    const result = applySubstitutions(
      movements,
      new Map([['m1', 'chin-up']]),
      exerciseById,
    );
    expect(result[0].exercise).toBe(chinUp);
    expect(result[0].reps).toBe(15); // reps untouched — only the exercise changes
  });

  it('moves only the tapped row when a WOD names the same line twice', () => {
    const movements = [
      { id: 'm1', reps: 15, exercise: negative },
      { id: 'm2', reps: 10, exercise: negative },
    ];
    const result = applySubstitutions(
      movements,
      new Map([['m2', 'chin-up']]),
      exerciseById,
    );
    expect(result[0].exercise).toBe(negative);
    expect(result[1].exercise).toBe(chinUp);
  });

  it('returns the movements untouched when nothing was swapped', () => {
    const movements = [{ id: 'm1', reps: 15, exercise: negative }];
    const result = applySubstitutions(
      movements,
      new Map<string, string>(),
      exerciseById,
    );
    expect(result).toBe(movements);
  });

  it('leaves a movement unchanged when the swapped-to exercise is missing', () => {
    const movements = [{ id: 'm1', reps: 15, exercise: negative }];
    const result = applySubstitutions(
      movements,
      new Map([['m1', 'deleted-exercise']]),
      exerciseById,
    );
    expect(result[0].exercise).toBe(negative);
  });

  it('swaps several movements independently', () => {
    const movements = [
      { id: 'm1', reps: 15, exercise: negative },
      { id: 'm2', reps: 10, exercise: negative },
    ];
    const result = applySubstitutions(
      movements,
      new Map([
        ['m1', 'chin-up'],
        ['m2', 'row'],
      ]),
      exerciseById,
    );
    expect(result[0].exercise).toBe(chinUp);
    expect(result[1].exercise).toBe(rowUnderTable);
  });
});

describe('applyEquipmentFloor', () => {
  const rope = { name: 'Rope Trick', dominantEquipment: ['jump_rope'] };
  const bell = { name: 'Swing Shift', dominantEquipment: ['kettlebell'] };
  const bodyweight = { name: 'Squat Sixty', dominantEquipment: [] };

  it('keeps a WOD whose identifying movement needs nothing', () => {
    expect(applyEquipmentFloor([bodyweight], new Set())).toEqual([bodyweight]);
  });

  it('drops one the athlete owns nothing for', () => {
    expect(applyEquipmentFloor([rope, bodyweight], new Set())).toEqual([
      bodyweight,
    ]);
  });

  it('keeps it once they own the piece', () => {
    expect(
      applyEquipmentFloor([rope, bodyweight], new Set(['jump_rope'])),
    ).toEqual([rope, bodyweight]);
  });

  it('needs every piece the movement is tagged with, not any', () => {
    const both = { name: 'Odd One', dominantEquipment: ['dumbbell', 'box'] };
    expect(
      applyEquipmentFloor([both, bodyweight], new Set(['dumbbell'])),
    ).toEqual([bodyweight]);
  });

  it('hands back the unfiltered pool rather than emptying it', () => {
    // The rule that makes this safe above `pickWod`'s relaxation ladder. An
    // athlete who owns nothing and a library that needs everything still get
    // a workout — a degraded one, carried by per-movement substitution.
    expect(applyEquipmentFloor([rope, bell], new Set())).toEqual([rope, bell]);
  });

  it('leaves an empty library empty rather than inventing a pool', () => {
    // `pickWod` throws on an empty candidate list; that is its business, and
    // the floor must not turn "no library" into something else on the way.
    expect(applyEquipmentFloor([], new Set())).toEqual([]);
  });
});

describe('dominantMovement', () => {
  const movements = [
    { exercise: { pattern: 'cardio', name: 'Double-unders' } },
    { exercise: { pattern: 'push', name: 'Push-up' } },
    { exercise: { pattern: 'cardio', name: 'Burpee' } },
  ];

  it('takes the first movement in the pattern the WOD claims', () => {
    expect(dominantMovement(movements, 'cardio')?.exercise.name).toBe(
      'Double-unders',
    );
  });

  it('finds nothing when no movement carries the claim', () => {
    expect(dominantMovement(movements, 'hinge')).toBeUndefined();
  });
});
