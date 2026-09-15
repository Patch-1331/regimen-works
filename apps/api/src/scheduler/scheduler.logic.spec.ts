import {
  applyEquipmentAvailability,
  applyRememberedChoice,
  applySubstitutions,
  ExerciseWithEquipment,
  ExerciseWithLine,
  getWeekRange,
  isRestDay,
  pickWod,
  RecentAssignment,
  WodCandidate,
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
  type FakeExercise = ExerciseWithEquipment & { name: string };

  const supermans: FakeExercise = {
    name: 'Supermans + reverse snow angels',
    equipment: [],
    altExerciseId: null,
  };
  const pullUp: FakeExercise = {
    name: 'Pull-up',
    equipment: ['bar'],
    altExerciseId: 'supermans',
  };
  const highKnees: FakeExercise = {
    name: 'High knees',
    equipment: [],
    altExerciseId: null,
  };
  const doubleUnder: FakeExercise = {
    name: 'Double-under',
    equipment: ['jump_rope'],
    altExerciseId: 'high-knees',
  };
  const orphan: FakeExercise = {
    name: 'Box jump',
    equipment: ['box'],
    altExerciseId: null,
  };
  const danglingAlt: FakeExercise = {
    name: 'Kettlebell swing',
    equipment: ['kettlebell'],
    altExerciseId: 'deleted-exercise',
  };
  const loaded: FakeExercise = {
    name: 'Dumbbell thruster',
    equipment: ['dumbbell', 'box'],
    altExerciseId: 'high-knees',
  };

  const exerciseById = new Map<string, FakeExercise>([
    ['supermans', supermans],
    ['high-knees', highKnees],
  ]);

  const owns = (...pieces: string[]) => new Set(pieces);

  it('leaves a movement alone when the athlete owns what it needs', () => {
    const movements = [{ reps: 10, exercise: pullUp }];
    const result = applyEquipmentAvailability(
      movements,
      owns('bar'),
      exerciseById,
    );
    expect(result[0].exercise).toBe(pullUp);
    expect(result[0].reps).toBe(10); // reps untouched, as in the layers either side
  });

  it('falls to the substitute when the athlete owns nothing for it', () => {
    const movements = [{ reps: 10, exercise: pullUp }];
    const result = applyEquipmentAvailability(movements, owns(), exerciseById);
    expect(result[0].exercise).toBe(supermans);
  });

  it('leaves an untagged movement alone, since bodyweight is the baseline', () => {
    // No tags is not "needs nothing recorded" -- it is the baseline, and an
    // athlete who owns nothing at all can still do it.
    const movements = [{ reps: 30, exercise: highKnees }];
    const result = applyEquipmentAvailability(movements, owns(), exerciseById);
    expect(result[0].exercise).toBe(highKnees);
  });

  it('needs every piece a movement is tagged with, not just one', () => {
    const movements = [{ reps: 12, exercise: loaded }];
    const result = applyEquipmentAvailability(
      movements,
      owns('dumbbell'),
      exerciseById,
    );
    expect(result[0].exercise).toBe(highKnees);
  });

  it('passes an unperformable movement through when it has no substitute', () => {
    // A data gap must not leave a hole in the movement list -- the athlete is
    // about to train. DN-83 is what stops the gap existing in the seed.
    const movements = [{ reps: 20, exercise: orphan }];
    const result = applyEquipmentAvailability(movements, owns(), exerciseById);
    expect(result[0].exercise).toBe(orphan);
  });

  it('passes through when the substitute it names is missing', () => {
    const movements = [{ reps: 20, exercise: danglingAlt }];
    const result = applyEquipmentAvailability(movements, owns(), exerciseById);
    expect(result[0].exercise).toBe(danglingAlt);
  });

  it('takes one step down the chain rather than walking it', () => {
    // supermans is itself untagged, so nothing here proves a second hop did
    // not happen -- what this pins is that the substitute is taken as given.
    const movements = [{ reps: 10, exercise: pullUp }];
    const result = applyEquipmentAvailability(movements, owns(), exerciseById);
    expect(result[0].exercise).toBe(supermans);
    expect(result[0].exercise.altExerciseId).toBeNull();
  });

  it('resolves each movement independently', () => {
    const movements = [
      { reps: 10, exercise: pullUp },
      { reps: 50, exercise: doubleUnder },
    ];
    const result = applyEquipmentAvailability(
      movements,
      owns('bar'),
      exerciseById,
    );
    expect(result[0].exercise).toBe(pullUp);
    expect(result[1].exercise).toBe(highKnees);
  });

  it('returns the same movements untouched when everything is owned', () => {
    const movements = [
      { reps: 10, exercise: pullUp },
      { reps: 50, exercise: doubleUnder },
    ];
    const result = applyEquipmentAvailability(
      movements,
      owns('bar', 'jump_rope'),
      exerciseById,
    );
    expect(result).toEqual(movements);
  });
});

describe('the three resolution layers together', () => {
  type FakeExercise = ExerciseWithLine &
    ExerciseWithEquipment & { id: string; name: string };

  const kneePushUp: FakeExercise = {
    id: 'knee',
    name: 'Knee push-up',
    line: 'push_horizontal',
    equipment: [],
    altExerciseId: null,
  };
  const supermans: FakeExercise = {
    id: 'supermans',
    name: 'Supermans + reverse snow angels',
    line: 'pull',
    equipment: [],
    altExerciseId: null,
  };
  const pullUp: FakeExercise = {
    id: 'pull-up',
    name: 'Pull-up',
    line: 'pull',
    equipment: ['bar'],
    altExerciseId: 'supermans',
  };
  const negative: FakeExercise = {
    id: 'negative',
    name: 'Negative pull-up',
    line: 'pull',
    equipment: ['bar'],
    altExerciseId: 'supermans',
  };

  const exerciseAtRung = new Map<string, FakeExercise>([
    ['pull:0', supermans],
    ['pull:1', negative],
    ['pull:3', pullUp],
  ]);
  const exerciseById = new Map<string, FakeExercise>([
    ['supermans', supermans],
    ['pull-up', pullUp],
    ['negative', negative],
    ['knee', kneePushUp],
  ]);

  function resolve(
    movements: { id: string; exercise: FakeExercise }[],
    chosenRung: Map<string, number>,
    owned: Set<string>,
    swaps: Map<string, string>,
  ) {
    return applySubstitutions(
      applyEquipmentAvailability(
        applyRememberedChoice(movements, chosenRung, exerciseAtRung),
        owned,
        exerciseById,
      ),
      swaps,
      exerciseById,
    );
  }

  it('checks equipment against the remembered choice, not the prescription', () => {
    // The WOD prescribes a movement the athlete owns the kit for; their own
    // standing choice is the one that needs a bar. Checking the prescription
    // would miss it.
    const result = resolve(
      [{ id: 'wm-1', exercise: supermans }],
      new Map([['pull', 3]]),
      new Set(),
      new Map(),
    );
    expect(result[0].exercise).toBe(supermans);
  });

  it("lets today's swap win over what the athlete owns", () => {
    // The case DN-79 calls out: the rung resolves to a bar movement, the
    // athlete owns no bar, and they have swapped that movement anyway. No
    // rope in the house is not the same as no rope in the hotel gym -- the
    // ownership setting must not argue with what they just tapped.
    const result = resolve(
      [{ id: 'wm-1', exercise: supermans }],
      new Map([['pull', 1]]),
      new Set(),
      new Map([['wm-1', 'pull-up']]),
    );
    expect(result[0].exercise).toBe(pullUp);
  });

  it('degrades the remembered choice when no swap overrides it', () => {
    const result = resolve(
      [{ id: 'wm-1', exercise: kneePushUp }],
      new Map([['pull', 1]]),
      new Set(),
      new Map(),
    );
    expect(result[0].exercise).toBe(kneePushUp); // push line, untouched by the pull rung
  });

  it('leaves the whole chain alone for an athlete who owns the bar', () => {
    const result = resolve(
      [{ id: 'wm-1', exercise: supermans }],
      new Map([['pull', 1]]),
      new Set(['bar']),
      new Map(),
    );
    expect(result[0].exercise).toBe(negative);
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
