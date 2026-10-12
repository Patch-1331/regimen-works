import { createHash } from 'node:crypto';

import {
  assertPinned,
  buildLibrary,
  hiddenKit,
  mapEquipment,
  nameKey,
  PINNED_SHA256,
  sentenceCase,
  suggestPattern,
  type Correction,
  type Curation,
  type SourceExercise,
} from './library';

/**
 * The rules the library is built by (DN-167): small hand-written entries in,
 * a library or a list of everything wrong out. `exercise-library.spec.ts`
 * holds the committed files to these rules; this pins what the rules are.
 */

const source = (overrides: Partial<SourceExercise> = {}): SourceExercise => ({
  id: 'Pushups',
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

const own = (overrides: Partial<SourceExercise> = {}): SourceExercise =>
  source({ id: 'rw-knee-push-up', name: 'Knee push-up', ...overrides });

const build = ({
  dataset = [source()],
  owned = [],
  curation = { Pushups: { pattern: 'push' } },
  corrections = {},
  leftOut = {},
}: {
  dataset?: SourceExercise[];
  owned?: SourceExercise[];
  curation?: Record<string, Curation>;
  corrections?: Record<string, Correction>;
  leftOut?: Record<string, string>;
} = {}) =>
  buildLibrary({ dataset, own: owned, curation, corrections, leftOut });

/** A dataset entry nobody has curated. */
const chinUp = (overrides: Partial<SourceExercise> = {}) =>
  source({
    id: 'Chin-Up',
    name: 'Chin-Up',
    force: 'pull',
    primaryMuscles: ['lats'],
    ...overrides,
  });

describe('assertPinned', () => {
  it('refuses any file but the pinned one', () => {
    expect(() => assertPinned(Buffer.from('[]'))).toThrow(
      /is not free-exercise-db/,
    );
  });

  it('says what it is checking against', () => {
    // The real file is checked by the library spec, which loads it; here the
    // constant just has to be a sha256 for the comparison to mean anything.
    expect(PINNED_SHA256).toMatch(/^[0-9a-f]{64}$/);
    expect(createHash('sha256').update('[]').digest('hex')).not.toBe(
      PINNED_SHA256,
    );
  });
});

describe('mapEquipment', () => {
  it('reads "body only" and a missing value as needing nothing', () => {
    expect(mapEquipment(source({ equipment: 'body only' }))).toEqual([]);
    expect(mapEquipment(source({ equipment: null }))).toEqual([]);
  });

  it('maps the pieces our catalog has a word for', () => {
    expect(mapEquipment(source({ equipment: 'dumbbell' }))).toEqual([
      'dumbbell',
    ]);
    expect(mapEquipment(source({ equipment: 'kettlebells' }))).toEqual([
      'kettlebell',
    ]);
    expect(mapEquipment(source({ equipment: 'exercise ball' }))).toEqual([
      'stability_ball',
    ]);
  });

  it('maps a barbell to the barbell, never to the bar', () => {
    // `bar` in our catalog is a pull-up bar. The near-miss in spelling is
    // exactly how a back squat would end up prescribed to someone with a
    // doorway bar. DN-166 gave the barbell a catalog row of its own.
    expect(mapEquipment(source({ equipment: 'barbell' }))).toEqual(['barbell']);
    expect(mapEquipment(source({ equipment: 'e-z curl bar' }))).toEqual([
      'barbell',
    ]);
  });

  it('refuses "other", which names nothing', () => {
    expect(mapEquipment(source({ equipment: 'other' }))).toBeNull();
  });

  it('tags a bodyweight hang with the bar the source left off', () => {
    expect(
      mapEquipment(source({ name: 'Pullups', equipment: 'body only' })),
    ).toEqual(['bar']);
    expect(
      mapEquipment(
        source({ name: 'Hanging Leg Raise', equipment: 'body only' }),
      ),
    ).toEqual(['bar']);
    expect(
      mapEquipment(source({ name: 'Toes-to-bar', equipment: 'body only' })),
    ).toEqual(['bar']);
    // Only on "body only": a weighted pull-up's word is what it says.
    expect(
      mapEquipment(source({ name: 'Weighted Pull Ups', equipment: 'other' })),
    ).toBeNull();
  });
});

describe('hiddenKit', () => {
  const kit = (name: string, steps: string[], word: string[] = []) =>
    hiddenKit(source({ name, instructions: steps }), word as never);

  it('finds the bench and the box the word left off, in the name or the steps', () => {
    expect(kit('Dumbbell Bench Press', ['Lie back.'], ['dumbbell'])).toEqual([
      'bench',
    ]);
    expect(kit('Box Squat', ['Set a box behind you.'], ['barbell'])).toEqual([
      'box',
    ]);
    expect(kit('Crunch', ['Sit on a flat bench.'])).toEqual(['bench']);
  });

  it('finds dip bars in a dip, bar a dip on a bench, a machine or the rings', () => {
    expect(kit('Dips - Triceps Version', ['Hold yourself up.'])).toEqual([
      'dip_bars',
    ]);
    expect(kit('Knee Raise', ['Hold yourself on parallel bars.'])).toEqual([
      'dip_bars',
    ]);
    expect(kit('Bench Dips', ['Hands on the bench.'])).toEqual(['bench']);
    expect(kit('Ring Dips', ['Hold the rings.'])).toEqual([]);
  });

  it('hangs a bodyweight move from the bar its steps name', () => {
    expect(kit('Wind Sprints', ['Hang from a pull-up bar.'])).toEqual(['bar']);
    // A loaded move's word already says what it needs.
    expect(kit('Curl', ['Stand by the chin-up bar.'], ['dumbbell'])).toEqual(
      [],
    );
  });

  it('adds nothing the word already gave', () => {
    expect(kit('Bench Dips', ['On a bench.'], ['bench'])).toEqual([]);
  });
});

describe('suggestPattern', () => {
  const guess = (overrides: Partial<SourceExercise>) =>
    suggestPattern(source(overrides));

  it('reads cardio from the category, whatever the muscles', () => {
    expect(guess({ category: 'cardio', primaryMuscles: ['quadriceps'] })).toBe(
      'cardio',
    );
  });

  it('reads the rest from the first primary muscle', () => {
    expect(guess({ primaryMuscles: ['abdominals'] })).toBe('core');
    expect(guess({ primaryMuscles: ['quadriceps', 'chest'] })).toBe('squat');
    expect(guess({ primaryMuscles: ['hamstrings'] })).toBe('hinge');
    expect(guess({ primaryMuscles: ['triceps'], force: 'pull' })).toBe('push');
    expect(guess({ primaryMuscles: ['lats'] })).toBe('pull');
  });

  it('falls back to the force, then to no pattern at all', () => {
    expect(guess({ primaryMuscles: ['forearms'], force: 'pull' })).toBe('pull');
    expect(guess({ primaryMuscles: ['neck'], force: 'static' })).toBeNull();
  });
});

describe('nameKey', () => {
  it('ignores case, spacing, hyphens and a plural', () => {
    expect(nameKey('Push-up')).toBe(nameKey('Pushups'));
    expect(nameKey('Air squat')).toBe(nameKey('Air  Squats'));
    expect(nameKey('Goblet squat')).not.toBe(nameKey('Air squat'));
  });
});

describe('sentenceCase', () => {
  it('writes the dataset’s title case in the library’s house style', () => {
    expect(sentenceCase('Decline Push-Up')).toBe('Decline push-up');
    expect(sentenceCase('  Butt Lift  (Bridge) ')).toBe('Butt lift (bridge)');
  });
});

describe('buildLibrary', () => {
  it('curates what the curation names, under a sentence-case name', () => {
    const library = build({
      curation: {
        Pushups: { pattern: 'push', formerly: 'Push-up' },
      },
    });

    expect(library.exercises).toEqual([
      expect.objectContaining({
        key: 'Pushups',
        name: 'Pushups',
        formerly: 'Push-up',
        source: 'dataset',
        equipment: [],
        primaryMuscles: ['chest'],
        level: 'beginner',
        category: 'strength',
        unit: 'reps',
        movementGroup: null,
        sortOrder: null,
        isGroupDefault: false,
        curated: true,
      }),
    ]);
  });

  it('brings the rest of the dataset in uncurated, with derived values', () => {
    const library = build({
      dataset: [
        source(),
        chinUp(),
        source({
          id: 'Plank',
          name: 'Plank',
          force: 'static',
          primaryMuscles: ['abdominals'],
        }),
      ],
    });
    expect(library.exercises.map((e) => [e.key, e.curated])).toEqual([
      ['Pushups', true],
      ['Chin-Up', false],
      ['Plank', false],
    ]);
    expect(library.exercises[1]).toMatchObject({
      name: 'Chin-up',
      pattern: 'pull',
      unit: 'reps',
      equipment: ['bar'],
      movementGroup: null,
      sortOrder: null,
      isGroupDefault: false,
      scalable: false,
    });
    expect(library.exercises[1].fallback).toBeUndefined();
    // A static hold is timed.
    expect(library.exercises[2]).toMatchObject({
      pattern: 'core',
      unit: 'seconds',
    });
  });

  it('adds hidden kit to the uncurated, and lists it', () => {
    const library = build({
      dataset: [
        source(),
        source({
          id: 'Dumbbell_Bench_Press',
          name: 'Dumbbell Bench Press',
          equipment: 'dumbbell',
        }),
      ],
    });
    expect(library.exercises[1].equipment).toEqual(['dumbbell', 'bench']);
    expect(library.hiddenKit).toEqual([
      { key: 'Dumbbell_Bench_Press', added: ['bench'] },
    ]);
  });

  it('never adds hidden kit to a curated entry', () => {
    const library = build({
      dataset: [source({ instructions: ['Feet up on a bench.'] })],
    });
    expect(library.exercises[0].equipment).toEqual([]);
    expect(library.hiddenKit).toEqual([]);
  });

  it('lets a correction say what the derived values get wrong', () => {
    const library = build({
      dataset: [
        source(),
        chinUp({ equipment: 'other', instructions: ['Feet on a bench.'] }),
      ],
      corrections: {
        'Chin-Up': {
          name: 'Chin-up on rings',
          pattern: null,
          unit: 'seconds',
          equipment: ['suspension_trainer'],
        },
      },
    });
    expect(library.exercises[1]).toMatchObject({
      name: 'Chin-up on rings',
      pattern: null,
      unit: 'seconds',
      equipment: ['suspension_trainer'],
      curated: false,
    });
    // The correction's equipment replaces the rules, so nothing is proposed.
    expect(library.hiddenKit).toEqual([]);
  });

  it('keeps an own exercise’s name and reads its muscles in our words', () => {
    const library = build({
      owned: [own({ primaryMuscles: ['lower back'] })],
      curation: { 'rw-knee-push-up': { pattern: 'push' } },
    });
    expect(library.exercises[0]).toMatchObject({
      key: 'rw-knee-push-up',
      name: 'Knee push-up',
      source: 'own',
      primaryMuscles: ['lower_back'],
    });
  });

  it('lets the curation say what the dataset’s equipment word gets wrong', () => {
    const library = build({
      dataset: [source({ equipment: 'other' })],
      curation: { Pushups: { pattern: 'push', equipment: ['box'] } },
    });
    expect(library.exercises[0].equipment).toEqual(['box']);
  });

  it('collapses the whitespace in each step and drops empty ones', () => {
    const library = build({
      dataset: [
        source({ instructions: ['  Lie   face down. ', ' ', 'Press up.'] }),
      ],
    });
    expect(library.exercises[0].instructions).toEqual([
      'Lie face down.',
      'Press up.',
    ]);
  });

  it('reports the left-out entries by name, with their reasons', () => {
    const library = build({
      dataset: [source(), source({ id: 'Yoke_Walk', name: 'Yoke Walk' })],
      leftOut: { Yoke_Walk: 'strongman' },
    });
    expect(library.leftOut).toEqual([
      { key: 'Yoke_Walk', name: 'Yoke Walk', reason: 'strongman' },
    ]);
    expect(library.exercises.map((e) => e.key)).toEqual(['Pushups']);
  });

  describe('refusing a library that is wrong', () => {
    // One run names every problem, so each of these checks for its own line.
    const refuses = (args: Parameters<typeof build>[0], problem: RegExp) =>
      expect(() => build(args)).toThrow(problem);

    it('refuses an own key without the rw- prefix', () => {
      refuses(
        {
          owned: [own({ id: 'knee-push-up' })],
          curation: { 'knee-push-up': { pattern: 'push' } },
        },
        /"knee-push-up" needs an rw- key/,
      );
    });

    it('refuses an own exercise with no curation entry', () => {
      refuses({ owned: [own()] }, /"rw-knee-push-up" has no curation entry/);
    });

    it('refuses an own exercise shadowing a dataset entry', () => {
      refuses(
        {
          dataset: [source(), source({ id: 'rw-knee-push-up' })],
          owned: [own()],
          curation: { 'rw-knee-push-up': { pattern: 'push' } },
        },
        /shadows a dataset entry/,
      );
    });

    it('refuses a curation entry no file holds', () => {
      refuses(
        { curation: { Pushups: { pattern: null }, Nope: { pattern: null } } },
        /curation names "Nope", which no file holds/,
      );
    });

    it('refuses a left-out entry the dataset does not have, or also curates', () => {
      refuses(
        { leftOut: { Nope: 'x' } },
        /left out "Nope" is not in the dataset/,
      );
      refuses({ leftOut: { Pushups: 'x' } }, /both curated in and left out/);
    });

    it('refuses equipment it cannot read and nothing settles', () => {
      refuses(
        { dataset: [source({ equipment: 'other' })] },
        /equipment "other" needs a curation entry/,
      );
      refuses(
        { dataset: [source(), chinUp({ equipment: 'other' })] },
        /equipment "other" needs a correction/,
      );
    });

    it('refuses a correction to an entry that is missing, curated or left out', () => {
      refuses(
        { corrections: { Nope: { pattern: null } } },
        /correction "Nope" is not in the dataset/,
      );
      refuses(
        { corrections: { Pushups: { pattern: null } } },
        /"Pushups" is curated/,
      );
      refuses(
        {
          dataset: [source(), chinUp()],
          corrections: { 'Chin-Up': { pattern: null } },
          leftOut: { 'Chin-Up': 'x' },
        },
        /"Chin-Up" is both corrected and left out/,
      );
    });

    it('refuses words our enums do not have in a correction', () => {
      refuses(
        {
          dataset: [source(), chinUp()],
          corrections: { 'Chin-Up': { pattern: 'twirl' } },
        },
        /unknown pattern "twirl"/,
      );
      refuses(
        {
          dataset: [source(), chinUp()],
          corrections: { 'Chin-Up': { equipment: ['sled' as never] } },
        },
        /unknown equipment "sled"/,
      );
    });

    it('refuses words our enums do not have', () => {
      refuses(
        { dataset: [source({ primaryMuscles: ['spleen'] })] },
        /unknown primary muscle "spleen"/,
      );
      refuses(
        { dataset: [source({ level: 'elite' })] },
        /unknown level "elite"/,
      );
      refuses(
        { curation: { Pushups: { pattern: 'twirl' } } },
        /unknown pattern "twirl"/,
      );
      refuses(
        {
          curation: { Pushups: { pattern: null, movementGroup: 'squat_box' } },
        },
        /unknown movement group "squat_box"/,
      );
    });

    it('refuses a fallback outside the library', () => {
      refuses(
        { curation: { Pushups: { pattern: null, fallback: 'Nope' } } },
        /fallback "Nope" is not in the library/,
      );
    });

    it('refuses a "formerly" on an own exercise, which keeps its name', () => {
      refuses(
        {
          owned: [own()],
          curation: {
            Pushups: { pattern: null },
            'rw-knee-push-up': { pattern: null, formerly: 'Knee pushup' },
          },
        },
        /an own exercise keeps its name/,
      );
    });

    it('refuses an exercise with nothing to read', () => {
      // The swap panel puts moves in front of people who have never done
      // them, so the copy has to exist before the move does.
      refuses(
        { dataset: [source({ instructions: [' '] })] },
        /no instructions/,
      );
    });
  });
});
