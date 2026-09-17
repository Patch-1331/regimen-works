import { DEFAULT_EQUIPMENT, movementPattern } from '@regimen-works/shared';
import { exercises } from '../../prisma/exercise-seed';
import { wods } from '../../prisma/wod-seed';

/**
 * What the WOD library owes the athlete standing in front of it (DN-34).
 *
 * Seeded content is usually checked by reading it, which works right up to
 * the point where a property spans the whole library — "does a bodyweight
 * athlete still get a choice" is not visible in any one entry, and it is
 * exactly what the equipment work puts at risk.
 */

const exerciseByName = new Map(exercises.map((e) => [e.name, e]));

/** What the WOD is identified by: its first movement in the dominant pattern. */
function dominantMovement(wod: (typeof wods)[number]) {
  return wod.movements
    .map((m) => exerciseByName.get(m.exercise))
    .find((e) => e?.pattern === wod.dominantPattern);
}

describe('the seeded WOD library', () => {
  it('names only exercises that exist', () => {
    // The seed resolves movements by name through `idByName.get(m.exercise)!`
    // — a typo is not a seeding error, it is `undefined` handed to Prisma as
    // a foreign key.
    const unknown = wods.flatMap((w) =>
      w.movements
        .filter((m) => !exerciseByName.has(m.exercise))
        .map((m) => `"${w.name}" names "${m.exercise}"`),
    );
    expect(unknown).toEqual([]);
  });

  it('actually contains a movement in the pattern it claims to be about', () => {
    // `dominantPattern` is what `pickWod` treats as a WOD's identity — for
    // the cooldown rule today, and for the equipment floor in DN-82. A WOD
    // whose dominant pattern no movement carries is one neither can reason
    // about.
    const mismatched = wods
      .filter((w) => !dominantMovement(w))
      .map((w) => `"${w.name}" claims ${w.dominantPattern}`);
    expect(mismatched).toEqual([]);
  });

  it('claims only real movement patterns', () => {
    const unknown = [...new Set(wods.map((w) => w.dominantPattern))].filter(
      (p) => !movementPattern.safeParse(p).success,
    );
    expect(unknown).toEqual([]);
  });

  /**
   * The property DN-34 was written around: the batch has to **grow** the
   * library rather than re-cut it.
   *
   * DN-82 will drop a WOD whose dominant-pattern movement the athlete cannot
   * perform, so every equipment-led WOD added is one a bodyweight-and-bar
   * athlete may never be offered. Add only those and the equipped athlete's
   * library doubles while everyone else's stands still — which reads as
   * growth in a diff and as nothing at all on the plate.
   */
  it('leaves a day-one athlete a library that grew too', () => {
    const owned = new Set<string>(DEFAULT_EQUIPMENT);
    const performable = wods.filter((w) => {
      const movement = dominantMovement(w);
      return (movement?.equipment ?? []).every((piece) => owned.has(piece));
    });

    // Eleven was the library before DN-34, fourteen before DN-114, and this
    // athlete is now on sixteen. The floor is what stops a later batch from
    // quietly leaving them behind; raise it when a batch raises the count.
    expect(performable.length).toBeGreaterThan(15);
  });

  it('prescribes the loaded movements the seed went to the trouble of adding', () => {
    // DN-113 seeded four movements that no WOD named, so they existed in the
    // library and reached nobody: a movement is only ever put in front of an
    // athlete by a WOD, by being a rung they can choose, or by being what
    // something else falls back to (DN-114).
    const prescribed = new Set(
      wods.flatMap((w) => w.movements.map((m) => m.exercise)),
    );
    const unused = [
      'Dumbbell row',
      'Dumbbell floor press',
      'Farmer carry',
      'Suitcase carry',
    ].filter((name) => !prescribed.has(name));
    expect(unused).toEqual([]);
  });

  it('leaves a bar-less athlete a workout about pulling', () => {
    // All six pull-dominant WODs were led by the pull-up, so an athlete with
    // no bar had never been given a workout *about* pulling — their ladder
    // starts on the floor and the library had no WOD that did (DN-114).
    const barless = wods.filter(
      (w) =>
        w.dominantPattern === 'pull' &&
        (dominantMovement(w)?.equipment ?? []).length === 0,
    );
    expect(barless.length).toBeGreaterThan(0);
  });

  /**
   * Where a timed movement may be prescribed (DN-114).
   *
   * A for-time workout asks the athlete to race a clock while one of its
   * movements is itself a clock — two timers, and the app runs only one of
   * them. AMRAP and EMOM both already count a duration the athlete works
   * inside, so a carry or a hold sits in them without inventing anything.
   *
   * Not a law of nature: if timed work in a for-time is ever worth having,
   * this is the line to change, deliberately, alongside whatever runs the
   * second clock.
   */
  it('keeps seconds-counted movements out of for-time workouts', () => {
    const timedInForTime = wods
      .filter((w) => w.type === 'for_time')
      .flatMap((w) =>
        w.movements
          .filter((m) => exerciseByName.get(m.exercise)?.unit === 'seconds')
          .map((m) => `"${w.name}" prescribes ${m.exercise}`),
      );
    expect(timedInForTime).toEqual([]);
  });

  it('leads a workout with every pattern the ladders train', () => {
    // Squat and hinge led no WOD at all before DN-34 — two of the patterns
    // the progression lines are built around, and neither ever chose the
    // workout.
    const led = new Set(wods.map((w) => w.dominantPattern));
    expect([...led].sort()).toEqual(
      expect.arrayContaining([
        'cardio',
        'core',
        'hinge',
        'pull',
        'push',
        'squat',
      ]),
    );
  });
});
