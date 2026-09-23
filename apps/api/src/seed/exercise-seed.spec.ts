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
    // adding it to the enum too, and DN-140 showed the reverse also binds:
    // retiring a group means retiring the value that named it;
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

  describe('the prose an athlete actually reads (DN-141)', () => {
    /**
     * Every schema identifier that is also, or contains, an ordinary English
     * word a coaching cue would want. These are the ones a project-wide
     * rename can walk into a sentence without anything failing: the string
     * still compiles, the seed still upserts, and the athlete is told to hold
     * their body in one `movementGroup`.
     */
    const schemaWords = [
      'movementGroup',
      'sortOrder',
      'exerciseId',
      'fallbackExerciseId',
      'isGroupDefault',
    ];

    it('never puts a schema identifier in an instruction', () => {
      // DN-134 renamed `line` to `movementGroup` across the repo and caught
      // five instructions on the way past -- among them "knees, hips and
      // shoulders form a straight movementGroup", which is the sentence
      // telling the athlete not to arch their lower back. They shipped, and
      // nothing here or in CI noticed for nine days, because a corrupted
      // sentence is still a valid string.
      //
      // `line` was both the old domain term and a common English word, so the
      // rename was safe across identifiers and unsafe across prose. That will
      // be true of the next domain word too; this is the check that survives
      // it.
      const offenders = exercises
        .flatMap((e) =>
          schemaWords
            .filter((word) => e.instructions.includes(word))
            .map((word) => `${e.name}: "${word}"`),
        )
        .sort();

      expect(offenders).toEqual([]);
    });
  });
  describe('the merged squat and hinge groups (DN-140)', () => {
    const memberNames = (group: string) =>
      exercises
        .filter((e) => e.movementGroup === group)
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
        .map((e) => e.name);

    it('holds the bodyweight and the equipment squats in one group', () => {
      // The whole point of the merge: an athlete looking at a dumbbell can
      // swap an air squat for a goblet squat, because legality is group
      // membership (`assertLegalTarget`) and they are now in one group. While
      // these were `squat_loaded` that swap was refused -- the app walling off
      // the kit in front of them.
      expect(memberNames('squat')).toEqual([
        'Air squat',
        'Reverse lunge',
        'Assisted pistol',
        'Pistol squat',
        'Goblet squat',
        'Dumbbell front squat',
        'Box step-up',
      ]);
    });

    it('holds the bodyweight and the equipment hinges in one group', () => {
      expect(memberNames('hinge')).toEqual([
        'Glute bridge',
        'Single-leg glute bridge',
        'Superman',
        'Single-leg superman',
        'Romanian deadlift',
        'Single-leg Romanian deadlift',
        'Kettlebell swing',
      ]);
    });

    it('leads each merged group with a member needing no equipment', () => {
      // Not cosmetic, and not the same claim as the default-per-group test
      // above. A group whose *declared default* needs kit drops its movements
      // from a prescribed day for an athlete who does not own it (DN-139), and
      // the merge is exactly the moment an equipment member could drift into
      // that slot -- both retiring groups declared one of their own.
      for (const group of ['squat', 'hinge']) {
        const declared = exercises.find(
          (e) => e.movementGroup === group && e.isGroupDefault,
        );
        expect(declared?.equipment ?? []).toEqual([]);
      }
    });

    it('keeps the thruster and the box jump out of every group', () => {
      // They left the squat groups rather than riding the merge in: a thruster
      // is a squat *and* an overhead press, so a squat slot resolving to one
      // silently doubles the pressing volume of a day that already presses,
      // and a box jump is plyometric, so "3x8 squat" done as box jumps is a
      // different session. Both stay in the library and stay usable by name in
      // an authored WOD; what they stop being is a substitute.
      const orphans = exercises.filter((e) =>
        ['Dumbbell thruster', 'Box jump'].includes(e.name),
      );

      expect(orphans).toHaveLength(2);
      expect(
        orphans.map((e) => `${e.name}: ${e.movementGroup ?? 'no group'}`),
      ).toEqual(['Dumbbell thruster: no group', 'Box jump: no group']);
      // Still reachable for an athlete without the kit, which is what keeps
      // them safe to leave in the pool.
      expect(orphans.every((e) => Boolean(e.fallback))).toBe(true);
    });

    it('retires the split group names from the enum', () => {
      // The seed and the enum have to move together or the other direction
      // fails silently: a row left on `squat_loaded` lands in a group nothing
      // recognises. The test above catches that from the seed's side; this
      // catches a half-done retirement from the enum's.
      for (const retired of ['squat_loaded', 'squat_box', 'hinge_loaded']) {
        expect(movementGroup.safeParse(retired).success).toBe(false);
      }
    });
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
   * The rope pair (DN-115). The group is what lets the swap panel put both in
   * front of an athlete who owns the piece — off a group it can only offer the
   * bodyweight alternative, which is the app taking away gear they have.
   *
   * One pair now, not two: DN-140 merged the box pair away. The step-up is an
   * ordinary member of `squat` and swaps to movements needing no box, and the
   * box jump is plyometric and holds no group at all. What keeps the rope pair
   * together is that *both* its members need the rope, so there is no
   * bodyweight member to merge them into — the reason the squat and hinge
   * splits died does not reach it.
   */
  describe('the groups where every member needs equipment', () => {
    const pairs = [{ movementGroup: 'cardio_rope', piece: 'jump_rope' }];

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
