import type { ExerciseSeed } from '../../prisma/exercise-seed';
import {
  draftExercises,
  joinInstructions,
  mapEquipment,
  nameKey,
  renderDrafts,
  suggestPattern,
  type SourceExercise,
} from './exercise-draft';

/**
 * The drafting half of DN-157: free-exercise-db entries in, `ExerciseSeed`
 * drafts out, for a person to curate. Every case is a small hand-written
 * source entry -- nothing here reads the real dataset, which is not in the
 * repo and is not fetched by anything.
 */

const source = (overrides: Partial<SourceExercise> = {}): SourceExercise => ({
  name: 'Pushups',
  force: 'push',
  level: 'beginner',
  mechanic: 'compound',
  equipment: 'body only',
  primaryMuscles: ['chest'],
  secondaryMuscles: ['shoulders', 'triceps'],
  instructions: ['Lie face down.', 'Press up.'],
  category: 'strength',
  ...overrides,
});

describe('mapEquipment', () => {
  it('reads "body only" and a missing value as needing nothing', () => {
    expect(mapEquipment(source({ equipment: 'body only' }))).toEqual({
      ok: true,
      equipment: [],
    });
    expect(mapEquipment(source({ equipment: null }))).toEqual({
      ok: true,
      equipment: [],
    });
  });

  it('maps the pieces our catalog has a word for', () => {
    expect(mapEquipment(source({ equipment: 'dumbbell' }))).toEqual({
      ok: true,
      equipment: ['dumbbell'],
    });
    expect(mapEquipment(source({ equipment: 'kettlebells' }))).toEqual({
      ok: true,
      equipment: ['kettlebell'],
    });
  });

  it('refuses a barbell rather than calling it a bar', () => {
    // `bar` in our catalog is a pull-up bar. The near-miss in spelling is
    // exactly how a back squat would end up prescribed to someone with a
    // doorway bar.
    expect(mapEquipment(source({ equipment: 'barbell' }))).toEqual({
      ok: false,
      reason: 'equipment "barbell"',
    });
  });

  it('refuses gym kit the catalog has no row for', () => {
    for (const piece of ['machine', 'cable', 'bands', 'e-z curl bar']) {
      expect(mapEquipment(source({ equipment: piece })).ok).toBe(false);
    }
  });

  it('tags a bodyweight hang with the bar the source left off', () => {
    // The source files pull-ups under "body only"; the athlete still needs
    // something to hang from, and the bar is what Settings asks about.
    for (const name of ['Pullups', 'Chin-Up', 'Hanging Leg Raise']) {
      expect(mapEquipment(source({ name }))).toEqual({
        ok: true,
        equipment: ['bar'],
        guessed: true,
      });
    }
  });
});

describe('suggestPattern', () => {
  it('reads core work from the abdominals', () => {
    expect(suggestPattern(source({ primaryMuscles: ['abdominals'] }))).toBe(
      'core',
    );
  });

  it('reads a squat from the quads and a hinge from the posterior chain', () => {
    expect(suggestPattern(source({ primaryMuscles: ['quadriceps'] }))).toBe(
      'squat',
    );
    for (const muscle of ['hamstrings', 'glutes', 'lower back']) {
      expect(suggestPattern(source({ primaryMuscles: [muscle] }))).toBe(
        'hinge',
      );
    }
  });

  it('reads pushing and pulling from the upper-body muscles', () => {
    expect(suggestPattern(source({ primaryMuscles: ['chest'] }))).toBe('push');
    expect(suggestPattern(source({ primaryMuscles: ['triceps'] }))).toBe(
      'push',
    );
    expect(suggestPattern(source({ primaryMuscles: ['lats'] }))).toBe('pull');
    expect(suggestPattern(source({ primaryMuscles: ['middle back'] }))).toBe(
      'pull',
    );
  });

  it('lets the cardio category win over the muscles', () => {
    expect(
      suggestPattern(
        source({ category: 'cardio', primaryMuscles: ['quadriceps'] }),
      ),
    ).toBe('cardio');
  });

  it('falls back to the force, then to nothing', () => {
    expect(
      suggestPattern(source({ primaryMuscles: ['forearms'], force: 'pull' })),
    ).toBe('pull');
    expect(
      suggestPattern(source({ primaryMuscles: ['neck'], force: 'static' })),
    ).toBeNull();
  });
});

describe('joinInstructions', () => {
  it('joins the steps into one paragraph of prose', () => {
    expect(
      joinInstructions(['  Lie face down. ', '', 'Press   up.\n']),
    ).toEqual({ ok: true, instructions: 'Lie face down. Press up.' });
  });

  it('refuses an entry with nothing to read', () => {
    // The seed type requires instructions: the swap panel puts moves in front
    // of people who have never done them.
    expect(joinInstructions([])).toEqual({
      ok: false,
      reason: 'no instructions',
    });
  });

  it('refuses prose holding a schema identifier (DN-141)', () => {
    expect(joinInstructions(['Keep a straight movementGroup.'])).toEqual({
      ok: false,
      reason: 'instructions name "movementGroup"',
    });
  });
});

describe('nameKey', () => {
  it('ignores case, spacing, hyphens and a plural', () => {
    expect(nameKey('Push-up')).toBe(nameKey('Pushups'));
    expect(nameKey('Air squat')).toBe(nameKey('Air  Squats'));
    expect(nameKey('Goblet squat')).not.toBe(nameKey('Air squat'));
  });
});

describe('draftExercises', () => {
  it('drafts a sentence-case seed with no grouping filled in', () => {
    const { drafts } = draftExercises(
      [source({ name: 'Decline Push-Up' })],
      [],
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0].seed).toEqual({
      name: 'Decline push-up',
      pattern: 'push',
      instructions: 'Lie face down. Press up.',
    });
  });

  it('skips anything already in the library, however it is spelled', () => {
    const { drafts, skipped } = draftExercises(
      [source({ name: 'Pushups' })],
      ['Push-up'],
    );
    expect(drafts).toEqual([]);
    expect(skipped).toEqual([
      { name: 'Pushups', reason: 'already in the library as "Push-up"' },
    ]);
  });

  it('keeps the first of two source entries with the same name', () => {
    const { drafts, skipped } = draftExercises(
      [source({ name: 'Plank' }), source({ name: 'Planks' })],
      [],
    );
    expect(drafts.map((d) => d.seed.name)).toEqual(['Plank']);
    expect(skipped).toEqual([
      { name: 'Planks', reason: 'duplicate of "Plank" in the source' },
    ]);
  });

  it('reports every skip with its reason', () => {
    const { skipped } = draftExercises(
      [
        source({ name: 'Barbell Squat', equipment: 'barbell' }),
        source({ name: 'Mystery Move', instructions: [] }),
      ],
      [],
    );
    expect(skipped).toEqual([
      { name: 'Barbell Squat', reason: 'equipment "barbell"' },
      { name: 'Mystery Move', reason: 'no instructions' },
    ]);
  });

  it('counts a static hold in seconds and says it guessed', () => {
    const { drafts } = draftExercises(
      [source({ name: 'Plank', force: 'static' })],
      [],
    );
    expect(drafts[0].seed.unit).toBe('seconds');
    expect(drafts[0].notes.join(' ')).toMatch(/seconds/);
  });

  it('notes every suggestion so the curator knows what to check', () => {
    const { drafts } = draftExercises([source({ name: 'Pullups' })], []);
    const notes = drafts[0].notes.join(' ');
    expect(notes).toMatch(/pattern/);
    expect(notes).toMatch(/bar/);
  });

  it('flags stretching as possible cool-down content', () => {
    const { drafts } = draftExercises(
      [source({ name: 'Calf Stretch', category: 'stretching' })],
      [],
    );
    expect(drafts[0].notes.join(' ')).toMatch(/cooldown/);
  });

  it('drafts fields the seed type accepts, and nothing else', () => {
    // A compile-time check as much as a runtime one: a draft is meant to be
    // pasted into `exercises`, where the seed spec then names what is missing.
    const { drafts } = draftExercises(
      [source({ name: 'Goblet Squat', equipment: 'kettlebells' })],
      [],
    );
    const pasted: Partial<ExerciseSeed> = drafts[0].seed;
    expect(Object.keys(pasted).sort()).toEqual(
      ['equipment', 'instructions', 'name', 'pattern'].sort(),
    );
  });
});

describe('renderDrafts', () => {
  it('writes a typed module with each note above its entry', () => {
    const out = renderDrafts(
      draftExercises([source({ name: 'Pullups' })], []),
      { source: 'free-exercise-db@abc123' },
    );
    expect(out).toContain(
      "import type { ExerciseSeed } from './exercise-seed';",
    );
    expect(out).toContain('export const drafts: Partial<ExerciseSeed>[] = [');
    expect(out).toContain('free-exercise-db@abc123');
    expect(out).toMatch(/\/\/ [^\n]*pattern[^\n]*\n[\s\S]*name: "Pullups"/);
  });

  it('lists the skips at the top so nothing is dropped silently', () => {
    const out = renderDrafts(
      draftExercises([source({ name: 'Leg Press', equipment: 'machine' })], []),
      { source: 'x' },
    );
    expect(out).toContain('Leg Press: equipment "machine"');
  });
});
