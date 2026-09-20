import {
  DEFAULT_EQUIPMENT,
  movementPattern,
  wodType,
} from '@regimen-works/shared';
import { exercises } from '../../prisma/exercise-seed';
import { wods } from '../../prisma/wod-seed';
import { narrowToSlot } from '../plans/program-day';

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

    // Eleven was the library before DN-34, fourteen before DN-114, sixteen
    // before DN-23, and this athlete is now on thirty-seven. The floor is
    // what stops a later batch from quietly leaving them behind; raise it
    // when a batch raises the count.
    expect(performable.length).toBeGreaterThan(36);
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

  /**
   * The property DN-23 was written around: a slot asks for a pattern **and a
   * format**, so the library is a grid rather than a list.
   *
   * Ten of the twenty-four cells were empty before this batch -- tabata
   * existed only for cardio, squat and hinge had no EMOM -- and an empty cell
   * is a slot the library cannot satisfy however many WODs sit in the other
   * cells. Four more were empty for a day-one athlete specifically, their
   * only entries led by a rope, a box, a kettlebell and a pair of dumbbells,
   * which DN-82's equipment floor then drops.
   *
   * Asserted against `DEFAULT_EQUIPMENT` rather than the full kit for the
   * same reason the count above is: the athlete who owns nothing is the one a
   * content batch is most likely to leave behind, and they are the default.
   */
  describe('the pattern x format grid', () => {
    // Read off the enums rather than written out, so the grid cannot quietly
    // shrink. A hand-kept list that loses an entry does not fail -- it just
    // stops checking that pattern or that format, and every case below goes
    // on passing while covering less. A pattern added to the enum instead
    // fails here on the day it is added, which is the day to seed for it.
    const PATTERNS = movementPattern.options;
    const FORMATS = wodType.options;

    const owned = new Set<string>(DEFAULT_EQUIPMENT);
    /**
     * The pool as the scheduler builds it: everything a day-one athlete can
     * perform, benchmarks included. `narrowToSlot` is what excludes the named
     * ones, so handing it a pre-filtered list would be testing the filter
     * this spec wrote rather than the one production runs.
     */
    const dayOne = wods.filter((w) =>
      (dominantMovement(w)?.equipment ?? []).every((piece) => owned.has(piece)),
    );
    const dayOneUnnamed = dayOne.filter((w) => !w.isNamed);

    it('offers a day-one athlete an unnamed WOD in every cell', () => {
      const empty = PATTERNS.flatMap((pattern) =>
        FORMATS.filter(
          (type) =>
            !dayOneUnnamed.some(
              (w) => w.dominantPattern === pattern && w.type === type,
            ),
        ).map((type) => `${pattern}/${type}`),
      );
      expect(empty).toEqual([]);
    });

    /**
     * DN-23's last task, and the one DN-14 made checkable at all.
     *
     * Before the reporting landed, "does the ladder still relax?" could only
     * be answered by reading the library and counting. Now the function says
     * so itself, and an empty cell fails here as a named pattern/format pair
     * rather than as a WOD that looks fine until an athlete is handed it.
     */
    it('never relaxes an ordinary slot request', () => {
      const relaxing = PATTERNS.flatMap((pattern) =>
        FORMATS.flatMap((type) =>
          // A 30-minute cap is the library's own ceiling, so it constrains
          // nothing here; both are checked because a slot that sets no cap
          // and one that sets a generous one are equally ordinary.
          [null, 30].flatMap((maxTimeCapMinutes) => {
            const { relaxed } = narrowToSlot(dayOne, {
              pattern,
              wodType: type,
              allowNamed: false,
              maxTimeCapMinutes,
            });
            return relaxed.length > 0
              ? [
                  `${pattern}/${type} cap ${maxTimeCapMinutes}: ${relaxed.join()}`,
                ]
              : [];
          }),
        ),
      );
      expect(relaxing).toEqual([]);
    });

    it('keeps every WOD inside the thirty-minute cap', () => {
      // The ceiling the whole library is written to, and what makes a slot
      // that sets no cap equivalent to one that sets a generous one. A WOD
      // over it is also a session longer than any athlete agreed to when
      // they opened Today.
      const overlong = wods
        .filter((w) => w.timeCapMinutes > 30)
        .map((w) => `"${w.name}" caps at ${w.timeCapMinutes}`);
      expect(overlong).toEqual([]);
    });

    it('still relaxes when the slot asks for something the library really lacks', () => {
      // The ladder has not been defanged: it is the library that grew. A cap
      // below anything seeded still walks it, which is what keeps the test
      // above meaningful rather than vacuous.
      const { relaxed } = narrowToSlot(dayOne, {
        pattern: 'squat',
        wodType: 'tabata',
        allowNamed: false,
        maxTimeCapMinutes: 1,
      });
      expect(relaxed).toEqual(['maxTimeCapMinutes']);
    });

    it('gives every cell a second WOD wherever the format allows it', () => {
      // One WOD in a cell is a slot that hands over the same workout every
      // time it comes round, and `pickWod`'s cooldown has nothing to choose
      // between. Counted across all equipment, since an equipped athlete's
      // variety is the point of the kit.
      const thin = PATTERNS.flatMap((pattern) =>
        FORMATS.filter(
          (type) =>
            wods.filter(
              (w) =>
                !w.isNamed && w.dominantPattern === pattern && w.type === type,
            ).length < 2,
        ).map((type) => `${pattern}/${type}`),
      );
      expect(thin).toEqual([]);
    });
  });
});
