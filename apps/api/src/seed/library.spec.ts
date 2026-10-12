import { createHash } from 'node:crypto';

import {
  assertPinned,
  buildLibrary,
  mapEquipment,
  nameKey,
  PINNED_SHA256,
  sentenceCase,
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
  leftOut = {},
}: {
  dataset?: SourceExercise[];
  owned?: SourceExercise[];
  curation?: Record<string, Curation>;
  leftOut?: Record<string, string>;
} = {}) => buildLibrary({ dataset, own: owned, curation, leftOut });

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
  it('lets in only what the curation names, under a sentence-case name', () => {
    const library = build({
      dataset: [source(), source({ id: 'Chin-Up', name: 'Chin-Up' })],
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
      }),
    ]);
    expect(library.undecided).toBe(1);
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
    expect(library.undecided).toBe(0);
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

    it('refuses equipment it cannot read and the curation does not settle', () => {
      refuses(
        { dataset: [source({ equipment: 'other' })] },
        /equipment "other" needs a curation entry/,
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
