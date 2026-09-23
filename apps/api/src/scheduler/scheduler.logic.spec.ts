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
  // 2026-08-17 is a Monday, so these seven run Mon(1) through Sun(0).
  const MONDAY = '2026-08-17';
  const week = [
    ['2026-08-17', 1, 'Monday'],
    ['2026-08-18', 2, 'Tuesday'],
    ['2026-08-19', 3, 'Wednesday'],
    ['2026-08-20', 4, 'Thursday'],
    ['2026-08-21', 5, 'Friday'],
    ['2026-08-22', 6, 'Saturday'],
    ['2026-08-23', 0, 'Sunday'],
  ] as const;

  // The numbering is the whole contract of the column, and an off-by-one here
  // is invisible at every other layer: a schedule simply shifts by a day.
  it.each(week)('numbers %s as %i (%s), matching getUTCDay', (date, day) => {
    expect(new Date(`${date}T00:00:00Z`).getUTCDay()).toBe(day);
  });

  it.each(week)('trains on %s when %i is picked', (date, day) => {
    expect(isRestDay(date, [day])).toBe(false);
  });

  it.each(week)('rests on %s when %i is not picked', (date, day) => {
    const everyOtherDay = week.map(([, d]) => d).filter((d) => d !== day);
    expect(isRestDay(date, everyOtherDay)).toBe(true);
  });

  it('rests on the days between a Mon/Wed/Fri week', () => {
    const monWedFri = [1, 3, 5];
    expect(isRestDay('2026-08-17', monWedFri)).toBe(false); // Mon
    expect(isRestDay('2026-08-18', monWedFri)).toBe(true); // Tue
    expect(isRestDay('2026-08-19', monWedFri)).toBe(false); // Wed
    expect(isRestDay('2026-08-22', monWedFri)).toBe(true); // Sat
  });

  it('does not care how much of the week has already been trained', () => {
    // The whole point of the change: a Monday is a training day whether it is
    // the first session of the week or the fifth. The quota this replaced
    // would have called this a rest day.
    expect(isRestDay(MONDAY, [0, 1, 2, 3, 4, 5, 6])).toBe(false);
  });

  it('rests every day when no day is picked', () => {
    // Not reachable through the schema, which requires at least one day, but
    // this is the answer that degrades safely rather than training always.
    expect(isRestDay(MONDAY, [])).toBe(true);
  });
});

describe('applyRememberedChoice', () => {
  type FakeExercise = ExerciseWithLine & { name: string };
  const member = (
    id: string,
    name: string,
    movementGroup: string | null,
    options: { equipment?: string[]; isGroupDefault?: boolean } = {},
  ): FakeExercise => ({
    id,
    name,
    movementGroup,
    equipment: options.equipment ?? [],
    isGroupDefault: options.isGroupDefault ?? false,
  });

  const kneePushUp = member('knee', 'Knee push-up', 'push_horizontal', {
    isGroupDefault: true,
  });
  const pushUp = member('push-up', 'Push-up', 'push_horizontal');
  const ringPushUp = member('ring', 'Ring push-up', 'push_horizontal', {
    equipment: ['rings'],
  });
  const airSquat = member('air-squat', 'Air squat', 'squat', {
    isGroupDefault: true,
  });
  const pistolSquat = member('pistol', 'Pistol squat', 'squat');
  const burpee = member('burpee', 'Burpee', null);

  const LIBRARY = [
    kneePushUp,
    pushUp,
    ringPushUp,
    airSquat,
    pistolSquat,
    burpee,
  ];
  const byId = new Map(LIBRARY.map((e) => [e.id, e]));

  const apply = (
    movements: { reps: number; exercise: FakeExercise }[],
    chosen: [string, string][] = [],
    owned: string[] = ['rings'],
  ) => applyRememberedChoice(movements, new Map(chosen), byId, new Set(owned));

  it('substitutes a movement for the one the athlete chose in its group', () => {
    const result = apply(
      [{ reps: 10, exercise: pushUp }],
      [['push_horizontal', 'knee']],
    );
    expect(result[0].exercise).toBe(kneePushUp);
    expect(result[0].reps).toBe(10); // reps untouched — only the exercise changes
  });

  it('leaves a movement unchanged when its exercise is in no group', () => {
    const result = apply(
      [{ reps: 15, exercise: burpee }],
      [['push_horizontal', 'push-up']],
    );
    expect(result[0].exercise).toBe(burpee);
  });

  // The absent-choice path (DN-139). Unlike the prescription path, this one
  // does *not* reach for the group's declared default: a WOD has already named
  // a movement, so an athlete who has chosen nothing trains what it asked for.
  it('leaves the authored movement alone for an athlete who has chosen nothing', () => {
    const result = apply([{ reps: 5, exercise: pistolSquat }]);
    expect(result[0].exercise).toBe(pistolSquat);
  });

  // The stale-choice path: both of these reach the athlete as a movement they
  // did not pick, so they resolve the same way the absent one does.
  it("leaves it alone when the athlete's choice has been archived", () => {
    // Archived rows never reach `byId` -- `libraryVisibleTo` filtered them out
    // upstream. The stored row is left alone, so un-archiving restores it.
    const result = apply(
      [{ reps: 5, exercise: pistolSquat }],
      [['squat', 'retired-squat']],
    );
    expect(result[0].exercise).toBe(pistolSquat);
  });

  it('leaves it alone when they own nothing for their choice', () => {
    // The equipment layer downstream still has the authored movement to work
    // with, rather than the fallback of a movement they cannot do anyway.
    const result = apply(
      [{ reps: 10, exercise: pushUp }],
      [['push_horizontal', 'ring']],
      [],
    );
    expect(result[0].exercise).toBe(pushUp);
  });

  it('keeps their choice when they own what it needs', () => {
    const result = apply(
      [{ reps: 10, exercise: pushUp }],
      [['push_horizontal', 'ring']],
      ['rings'],
    );
    expect(result[0].exercise).toBe(ringPushUp);
  });

  it('substitutes multiple movements independently across different groups', () => {
    const result = apply(
      [
        { reps: 10, exercise: pushUp },
        { reps: 5, exercise: airSquat },
      ],
      [
        ['push_horizontal', 'push-up'],
        ['squat', 'pistol'],
      ],
    );
    expect(result[0].exercise).toBe(pushUp);
    expect(result[1].exercise).toBe(pistolSquat);
  });
});

describe('applyEquipmentAvailability', () => {
  type FakeExercise = {
    id: string;
    name: string;
    equipment: string[];
    fallbackExerciseId: string | null;
  };

  const rowUnderTable: FakeExercise = {
    id: 'row',
    name: 'Row under table',
    equipment: [],
    fallbackExerciseId: null,
  };
  const pullUp: FakeExercise = {
    id: 'pull-up',
    name: 'Pull-up',
    equipment: ['bar'],
    fallbackExerciseId: 'row',
  };
  const burpee: FakeExercise = {
    id: 'burpee',
    name: 'Burpee',
    equipment: [],
    fallbackExerciseId: null,
  };
  const barMuscleUp: FakeExercise = {
    id: 'muscle-up',
    name: 'Bar muscle-up',
    equipment: ['bar'],
    fallbackExerciseId: null, // the data gap DN-83 exists to stop
  };
  const boxStepUp: FakeExercise = {
    id: 'step-up',
    name: 'Box step-up',
    equipment: ['box'],
    fallbackExerciseId: 'lunge',
  };
  const weightedStepUp: FakeExercise = {
    id: 'weighted-step-up',
    name: 'Weighted box step-up',
    equipment: ['box', 'dumbbell'],
    fallbackExerciseId: 'step-up',
  };
  const lunge: FakeExercise = {
    id: 'lunge',
    name: 'Lunge',
    equipment: [],
    fallbackExerciseId: null,
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
  type Tagged = { equipment: string[]; fallbackExerciseId: string | null };
  const pullUp: Tagged = { equipment: ['bar'], fallbackExerciseId: 'row' };
  const chinUp: Tagged = { equipment: ['bar'], fallbackExerciseId: 'row' };
  const burpee: Tagged = { equipment: [], fallbackExerciseId: null };
  const muscleUp: Tagged = { equipment: ['bar'], fallbackExerciseId: null };
  const doubleUnder: Tagged = {
    equipment: ['jump_rope'],
    fallbackExerciseId: 'high-knees',
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

  it('moves only the tapped row when a WOD names the same movementGroup twice', () => {
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
