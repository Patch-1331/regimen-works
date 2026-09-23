import { movementGroup } from '@regimen-works/shared';
import { exercises } from '../../prisma/exercise-seed';
import {
  mismatchedSubstituteUnits,
  unreachableSubstitutes,
} from './substitute-guard';

/**
 * The guard (DN-83) run against the library that actually ships, rather than
 * against hand-written stand-ins (DN-112).
 *
 * `substitute-guard.spec.ts` pins what the rule *is*; this pins that the seed
 * obeys it. Until the array was extracted from `seed.ts` this could not be
 * written at all, so the only thing that ever checked the real data was a
 * deploy — a seeding PR could go green and fail at release.
 */

describe('the seeded exercise library', () => {
  it('gives every equipment movement a one-step fall to bodyweight', () => {
    // Failure prints the offenders, so the message is the fix: which movement,
    // what it needs, and where its fallback stops short.
    expect(unreachableSubstitutes(exercises)).toEqual([]);
  });

  it('gives every equipment movement a fall counted in its own unit', () => {
    // The carries (DN-113) are the first timed movements that need equipment,
    // so this is the first seed where the fallback could arrive meaning
    // something else: the prescribed count carries over unchanged.
    expect(mismatchedSubstituteUnits(exercises)).toEqual([]);
  });

  it('puts every movement on a movementGroup the rest of the app knows', () => {
    // `ExerciseSeed.line` is a bare string, so a typo here reaches the
    // database and then the athlete: the row lands in a group nothing else
    // recognises, `SkillLevelsService` refuses to write a choice for it, and
    // the Stats panel labels it with the raw slug. Adding a real line means
    // adding it to the enum too (DN-84 added squat_loaded and hinge_loaded);
    // this is what says so out loud.
    const lines = [
      ...new Set(exercises.map((e) => e.movementGroup).filter(Boolean)),
    ];
    const unknown = lines.filter(
      (group) => !movementGroup.safeParse(group).success,
    );
    expect(unknown).toEqual([]);
  });

  it('numbers each movementGroup from zero with no gaps and no ties', () => {
    // Display order only since DN-139 -- no choice resolves through it -- but
    // a tie still makes the order of two movements in the panel depend on row
    // order, which is a list that reshuffles itself between loads.
    const byLine = new Map<string, number[]>();
    for (const e of exercises) {
      if (!e.movementGroup || e.sortOrder === undefined) continue;
      byLine.set(e.movementGroup, [
        ...(byLine.get(e.movementGroup) ?? []),
        e.sortOrder,
      ]);
    }

    for (const [movementGroup, orders] of byLine) {
      const sorted = [...orders].sort((a, b) => a - b);
      expect({ movementGroup, orders: sorted }).toEqual({
        movementGroup,
        orders: sorted.map((_, i) => i),
      });
    }
  });

  it('declares exactly one default per movementGroup', () => {
    // What a program slot resolves to for an athlete who has chosen nothing
    // (DN-139), which is every group of every new athlete since DN-86. A group
    // with no default has its rows dropped from a prescribed day, and the
    // failure reads as a program that lost a movement rather than as a seed
    // missing a flag. Two defaults cannot reach the database -- a partial
    // unique index refuses them -- so only the absent case needs catching here.
    const defaults = new Map<string, number>();
    for (const e of exercises) {
      if (!e.movementGroup) continue;
      defaults.set(
        e.movementGroup,
        (defaults.get(e.movementGroup) ?? 0) + (e.isGroupDefault ? 1 : 0),
      );
    }

    expect([...defaults].filter(([, count]) => count !== 1)).toEqual([]);
  });

  it('is actually being read — the guard is not passing an empty list', () => {
    // Without this, deleting the import above would leave a green test that
    // asserts nothing about anything.
    expect(exercises.length).toBeGreaterThan(40);
    expect(exercises.some((e) => (e.equipment ?? []).length > 0)).toBe(true);
    // And that a timed equipment movement is in there at all, which is what
    // gives the unit check above something to be wrong about (DN-113).
    expect(
      exercises.some(
        (e) => (e.equipment ?? []).length > 0 && e.unit === 'seconds',
      ),
    ).toBe(true);
  });

  /**
   * What DN-113 added, as properties rather than as a list to eyeball.
   *
   * The loaded upper-body movements are deliberately in no bodyweight group:
   * `pull` and `push_horizontal` are ordered by how much of your own weight
   * you move, and a dumbbell row is ordered by what you loaded. Mixing them
   * would put two different questions in one panel.
   */
  /**
   * The two pairs that share a piece of kit (DN-115). A line is what lets the
   * swap panel put both in front of an athlete who owns the piece — off a
   * line it can only offer the bodyweight alternative, which is the app
   * taking away gear they have.
   */
  describe('the groups where every member needs equipment', () => {
    const pairs = [
      { movementGroup: 'cardio_rope', piece: 'jump_rope' },
      { movementGroup: 'squat_box', piece: 'box' },
    ];

    it.each(pairs)(
      'puts both $piece movements on $movementGroup',
      ({ movementGroup }) => {
        const members = exercises
          .filter((e) => e.movementGroup === movementGroup)
          .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
        expect(members.map((e) => e.sortOrder)).toEqual([0, 1]);
      },
    );

    it.each(pairs)(
      'needs $piece on every member of $movementGroup',
      ({ movementGroup, piece }) => {
        // What makes these groups different from every other one: there is
        // nothing in them an athlete without the piece can do. The way out is
        // the alternative, not another member, which is the case below.
        const members = exercises.filter(
          (e) => e.movementGroup === movementGroup,
        );
        expect(members.map((e) => e.equipment)).toEqual([[piece], [piece]]);
      },
    );

    it.each(pairs)(
      'keeps a bodyweight way off $movementGroup on both members',
      ({ movementGroup }) => {
        // `unreachableSubstitutes` already says this across the whole library.
        // Said again here because it is the property that makes the groups safe
        // to add: an athlete who owns neither piece is no worse off than before.
        const byName = new Map(exercises.map((e) => [e.name, e]));
        const stranded = exercises
          .filter((e) => e.movementGroup === movementGroup)
          .filter((e) => {
            const fallback = e.fallback ? byName.get(e.fallback) : undefined;
            return (
              !fallback ||
              (fallback.equipment ?? []).length > 0 ||
              fallback.movementGroup === movementGroup
            );
          })
          .map((e) => e.name);
        expect(stranded).toEqual([]);
      },
    );
  });

  describe('the loaded pulling, pressing and carries', () => {
    const added = [
      'Dumbbell row',
      'Dumbbell floor press',
      'Farmer carry',
      'Suitcase carry',
    ];

    it('seeds all four', () => {
      const names = new Set(exercises.map((e) => e.name));
      expect(added.filter((name) => !names.has(name))).toEqual([]);
    });

    it('keeps them off every progression movementGroup', () => {
      const onALine = exercises
        .filter((e) => added.includes(e.name) && e.movementGroup)
        .map((e) => `${e.name} on ${e.movementGroup}`);
      expect(onALine).toEqual([]);
    });

    it('tags each with one piece of equipment, not two', () => {
      // `isPerformable` requires *every* tag, so ['dumbbell', 'kettlebell']
      // reads as "needs both" — an athlete owning one of the two would be
      // refused a movement they can do.
      const overTagged = exercises
        .filter((e) => added.includes(e.name) && (e.equipment ?? []).length > 1)
        .map((e) => e.name);
      expect(overTagged).toEqual([]);
    });

    it('counts the carries in seconds', () => {
      // A carry is really measured in distance, which `Exercise.unit` has no
      // word for. Seconds is the honest half; reps would not be a carry.
      const carries = exercises.filter((e) => e.name.endsWith('carry'));
      expect(carries).toHaveLength(2);
      expect(carries.every((e) => e.unit === 'seconds')).toBe(true);
    });
  });
});
