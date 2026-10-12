import {
  checklistKind,
  movementGroup,
  movementPattern,
} from '@regimen-works/shared';
import { checklistEntries, entrySteps } from '../../prisma/checklist-seed';
import { loadLibrary } from '../../prisma/library';
import { curation } from '../../prisma/library/curation';
import { nameKey, SCHEMA_WORDS } from './library';
import {
  mismatchedSubstituteUnits,
  unreachableSubstitutes,
} from './substitute-guard';

/**
 * The library that actually ships, built from its three files the way the
 * seed builds it (DN-167), and held to what the scheduler needs of it.
 *
 * `library.spec.ts` pins what the import's rules *are*; this pins that the
 * committed files obey them. Everything here would otherwise first be
 * checked by a deploy.
 */

const library = loadLibrary();
const { exercises } = library;
const byKey = new Map(exercises.map((e) => [e.key, e]));

/** A group's members, in the order the panel lists them. */
const members = (group: string) =>
  exercises
    .filter((e) => e.movementGroup === group)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

describe('the exercise library', () => {
  it('is today’s 64: 26 dataset twins and 38 of the app’s own', () => {
    // DN-167 moves the library onto the import and adds nothing; the rest of
    // the dataset is DN-168's. A count that moves here is a curation entry
    // that let something in early.
    expect(exercises).toHaveLength(64);
    expect(exercises.filter((e) => e.source === 'dataset')).toHaveLength(26);
    expect(exercises.filter((e) => e.source === 'own')).toHaveLength(38);
  });

  describe('what every exercise carries', () => {
    it('has a key, a level and a category', () => {
      const missing = exercises
        .filter((e) => !e.key || !e.level || !e.category)
        .map((e) => e.name);
      expect(missing).toEqual([]);
    });

    it('has its muscles, bar the one with none to name', () => {
      // Deep breathing works the diaphragm, which the dataset's seventeen
      // muscles do not include (Todd, DN-167). Named here so that any other
      // row left empty -- which the matcher would read as "cannot be
      // matched" -- still fails.
      const undescribed = exercises
        .filter((e) => e.primaryMuscles.length === 0)
        .map((e) => e.key);
      expect(undescribed).toEqual(['rw-deep-breathing']);
    });

    it('keys the app’s own exercises rw-, and the twins by the dataset’s id', () => {
      const own = exercises.filter((e) => e.source === 'own');
      expect(own.every((e) => e.key.startsWith('rw-'))).toBe(true);
      expect(
        exercises.filter(
          (e) => e.source === 'dataset' && e.key.startsWith('rw-'),
        ),
      ).toEqual([]);
    });

    it('holds no two names that are the same movement', () => {
      // What `nameKey` was written to catch (DN-157): "Pushups" beside
      // "Push-up" is one movement in two rows, and the athlete's history
      // splits between them.
      const seen = new Map<string, string>();
      const clashes: string[] = [];
      for (const e of exercises) {
        const earlier = seen.get(nameKey(e.name));
        if (earlier) clashes.push(`${earlier} / ${e.name}`);
        seen.set(nameKey(e.name), e.name);
      }
      expect(clashes).toEqual([]);
    });

    it('renames each twin only once, from the name it has today', () => {
      // `formerly` is what finds the row before it has a key. Two twins
      // claiming one old name would both resolve to the same row.
      const formerly = exercises.flatMap((e) =>
        e.formerly ? [e.formerly] : [],
      );
      expect(new Set(formerly).size).toBe(formerly.length);
      expect(exercises.filter((e) => e.source === 'own' && e.formerly)).toEqual(
        [],
      );
    });
  });

  it('leaves the specialist kit out, by name and with a reason', () => {
    // ADR-0007 decision 9. A dataset entry both curated in and left out
    // does not build at all; this says the list is the one that was agreed.
    expect(library.leftOut.length).toBeGreaterThanOrEqual(35);
    expect(library.leftOut.every((l) => l.reason.length > 0)).toBe(true);
    expect(library.leftOut.map((l) => l.key)).toContain('Farmers_Walk');
  });

  it('gives every equipment movement a one-step fall to bodyweight', () => {
    // Failure prints the offenders, so the message is the fix: which movement,
    // what it needs, and where its fallback stops short. The guard reads
    // names; the key is the one that does not change.
    const guarded = exercises.map((e) => ({ ...e, name: e.key }));
    expect(unreachableSubstitutes(guarded)).toEqual([]);
  });

  it('gives every equipment movement a fall counted in its own unit', () => {
    // The carries (DN-113) are the first timed movements that need equipment,
    // so this is the first library where the fallback could arrive meaning
    // something else: the prescribed count carries over unchanged.
    const guarded = exercises.map((e) => ({ ...e, name: e.key }));
    expect(mismatchedSubstituteUnits(guarded)).toEqual([]);
  });

  it('puts every movement on a movementGroup the rest of the app knows', () => {
    // A typo here would reach the database and then the athlete: the row
    // lands in a group nothing else recognises, `SkillLevelsService` refuses
    // to write a choice for it, and the Stats panel labels it with the raw
    // slug. The import refuses an unknown group too; this says so before a
    // deploy does.
    const groups = [
      ...new Set(exercises.map((e) => e.movementGroup).filter(Boolean)),
    ];
    const unknown = groups.filter(
      (group) => !movementGroup.safeParse(group).success,
    );
    expect(unknown).toEqual([]);
  });

  it('numbers each movementGroup from zero with no gaps and no ties', () => {
    // Display order only since DN-139 -- no choice resolves through it -- but
    // a tie still makes the order of two movements in the panel depend on row
    // order, which is a list that reshuffles itself between loads.
    const byGroup = new Map<string, number[]>();
    for (const e of exercises) {
      if (!e.movementGroup || e.sortOrder === null) continue;
      byGroup.set(e.movementGroup, [
        ...(byGroup.get(e.movementGroup) ?? []),
        e.sortOrder,
      ]);
    }

    for (const [group, orders] of byGroup) {
      const sorted = [...orders].sort((a, b) => a - b);
      expect({ group, orders: sorted }).toEqual({
        group,
        orders: sorted.map((_, i) => i),
      });
    }
  });

  describe('the group defaults (DN-139, and DN-158 to DN-163 folded in)', () => {
    const groups = [
      ...new Set(exercises.flatMap((e) => e.movementGroup ?? [])),
    ];

    it('declares exactly one default per movementGroup', () => {
      // What a program slot resolves to for an athlete who has chosen nothing.
      // A group with no default has its rows dropped from a prescribed day,
      // and the failure reads as a program that lost a movement rather than
      // as a library missing a flag.
      const counts = groups.map((group) => [
        group,
        members(group).filter((e) => e.isGroupDefault).length,
      ]);
      expect(counts.filter(([, count]) => count !== 1)).toEqual([]);
    });

    it('makes each default one an athlete without equipment can do', () => {
      // A default that needs kit drops the group's movements from a
      // prescribed day for an athlete who does not own it (DN-139). One group
      // cannot: every member of the rope pair needs the rope (DN-115), so
      // there is no bodyweight member to declare. Its default's way out is
      // its fallback instead, which needs nothing -- the most a group with
      // no bodyweight member can say.
      const stranded = groups.flatMap((group) => {
        const declared = members(group).find((e) => e.isGroupDefault)!;
        if (declared.equipment.length === 0) return [];
        const anyBodyweight = members(group).some(
          (e) => e.equipment.length === 0,
        );
        const fallback = declared.fallback
          ? byKey.get(declared.fallback)
          : undefined;
        if (!anyBodyweight && fallback?.equipment.length === 0) return [];
        return [
          `${group}: ${declared.name} needs ${declared.equipment.join(', ')}`,
        ];
      });
      expect(stranded).toEqual([]);
    });
  });

  describe('the prose an athlete actually reads (DN-141)', () => {
    /**
     * Every schema identifier that is also, or contains, an ordinary English
     * word a coaching cue would want. These are the ones a project-wide
     * rename can walk into a sentence without anything failing: the string
     * still compiles, the seed still writes it, and the athlete is told to
     * hold their body in one `movementGroup`.
     */
    it('never puts a schema identifier in an instruction', () => {
      // DN-134 renamed `line` to `movementGroup` across the repo and caught
      // five instructions on the way past -- among them "knees, hips and
      // shoulders form a straight movementGroup", which is the sentence
      // telling the athlete not to arch their lower back. They shipped, and
      // nothing noticed for nine days, because a corrupted sentence is still a
      // valid string. Over every step as stored, dataset and own alike.
      const offenders = exercises
        .flatMap((e) =>
          e.instructions.flatMap((step, i) =>
            SCHEMA_WORDS.filter((word) => step.includes(word)).map(
              (word) => `${e.name} step ${i + 1}: "${word}"`,
            ),
          ),
        )
        .sort();

      expect(offenders).toEqual([]);
    });

    it('nor in the copy a checklist entry carries of its own', () => {
      const offenders = checklistEntries
        .flatMap((c) =>
          entrySteps(c).flatMap((step) =>
            SCHEMA_WORDS.filter((word) => step.includes(word)).map(
              (word) => `${c.kind} ${c.exercise}: "${word}"`,
            ),
          ),
        )
        .sort();

      expect(offenders).toEqual([]);
    });

    it('gives every exercise something to read', () => {
      expect(
        exercises.filter((e) => e.instructions.length === 0).map((e) => e.key),
      ).toEqual([]);
    });
  });

  describe('the merged squat and hinge groups (DN-140)', () => {
    const memberKeys = (group: string) => members(group).map((e) => e.key);

    it('holds the bodyweight and the equipment squats in one group', () => {
      // The whole point of the merge: an athlete looking at a dumbbell can
      // swap a bodyweight squat for a goblet squat, because legality is group
      // membership (`assertLegalTarget`) and they are now in one group.
      expect(memberKeys('squat')).toEqual([
        'Bodyweight_Squat',
        'rw-reverse-lunge',
        'rw-assisted-pistol',
        'rw-pistol-squat',
        'Goblet_Squat',
        'rw-dumbbell-front-squat',
        'rw-box-step-up',
      ]);
    });

    it('holds the bodyweight and the equipment hinges in one group', () => {
      expect(memberKeys('hinge')).toEqual([
        'Butt_Lift_Bridge',
        'Single_Leg_Glute_Bridge',
        'Superman',
        'rw-single-leg-superman',
        'Romanian_Deadlift',
        'rw-single-leg-romanian-deadlift',
        'rw-kettlebell-swing',
      ]);
    });

    it('keeps the thruster and the box jump out of every group', () => {
      // A thruster is a squat *and* an overhead press, so a squat slot
      // resolving to one silently doubles the pressing volume of a day that
      // already presses; a box jump is plyometric, so "3x8 squat" done as box
      // jumps is a different session. Both stay usable by name in an authored
      // WOD; what they stop being is a substitute.
      const orphans = ['rw-dumbbell-thruster', 'Front_Box_Jump'].map((key) =>
        byKey.get(key)!,
      );
      expect(orphans.map((e) => e.movementGroup)).toEqual([null, null]);
      // Still reachable for an athlete without the kit, which is what keeps
      // them safe to leave in the pool.
      expect(orphans.every((e) => Boolean(e.fallback))).toBe(true);
    });

    it('retires the split group names from the enum', () => {
      for (const retired of ['squat_loaded', 'squat_box', 'hinge_loaded']) {
        expect(movementGroup.safeParse(retired).success).toBe(false);
      }
    });
  });

  it('is actually being read — the guard is not passing an empty list', () => {
    // Without this, a loader that returned nothing would leave a green suite
    // that asserts nothing about anything.
    expect(exercises.some((e) => e.equipment.length > 0)).toBe(true);
    // And a timed equipment movement, which is what gives the unit check
    // something to be wrong about (DN-113).
    expect(
      exercises.some((e) => e.equipment.length > 0 && e.unit === 'seconds'),
    ).toBe(true);
  });

  /**
   * The rope pair (DN-115). The group is what lets the swap panel put both in
   * front of an athlete who owns the rope. What keeps it a group of its own
   * is that *both* members need the rope, so there is no bodyweight member
   * to merge it into.
   */
  describe('the group where every member needs equipment', () => {
    it('puts both rope movements on cardio_rope, and nothing else', () => {
      expect(members('cardio_rope').map((e) => e.equipment)).toEqual([
        ['jump_rope'],
        ['jump_rope'],
      ]);
    });

    it('keeps a bodyweight way off cardio_rope on both members', () => {
      const stranded = members('cardio_rope')
        .filter((e) => {
          const fallback = e.fallback ? byKey.get(e.fallback) : undefined;
          return (
            !fallback ||
            fallback.equipment.length > 0 ||
            fallback.movementGroup === 'cardio_rope'
          );
        })
        .map((e) => e.name);
      expect(stranded).toEqual([]);
    });
  });

  /**
   * What DN-113 added. The loaded upper-body movements are deliberately in no
   * bodyweight group: `pull` and `push_horizontal` are ordered by how much of
   * your own weight you move, and a dumbbell row by what you loaded.
   */
  describe('the loaded pulling, pressing and carries', () => {
    const added = [
      'One-Arm_Dumbbell_Row',
      'Dumbbell_Floor_Press',
      'rw-farmer-carry',
      'rw-suitcase-carry',
    ].map((key) => byKey.get(key)!);

    it('keeps them off every movement group', () => {
      expect(added.map((e) => e.movementGroup)).toEqual([
        null,
        null,
        null,
        null,
      ]);
    });

    it('tags each with one piece of equipment, not two', () => {
      // `isPerformable` requires *every* tag, so ['dumbbell', 'kettlebell']
      // reads as "needs both".
      expect(added.map((e) => e.equipment)).toEqual([
        ['dumbbell'],
        ['dumbbell'],
        ['dumbbell'],
        ['dumbbell'],
      ]);
    });

    it('counts the carries in seconds', () => {
      // A carry is really measured in distance, which `Exercise.unit` has no
      // word for. Seconds is the honest half; reps would not be a carry.
      const carries = exercises.filter((e) => e.name.endsWith('carry'));
      expect(carries).toHaveLength(2);
      expect(carries.every((e) => e.unit === 'seconds')).toBe(true);
    });
  });

  describe('the equipment the dataset words get wrong', () => {
    it('keeps the kit our movements have always used', () => {
      // The dataset's goblet squat is a kettlebell, its Romanian deadlift a
      // barbell, and its box jump and rope "other". The curation says what
      // they need in our catalog's words.
      expect(
        [
          'Goblet_Squat',
          'Romanian_Deadlift',
          'Front_Box_Jump',
          'Rope_Jumping',
        ].map((key) => byKey.get(key)!.equipment),
      ).toEqual([['dumbbell'], ['dumbbell'], ['box'], ['jump_rope']]);
    });

    it('hangs the pull-ups and the hanging raises from the bar', () => {
      // The bar rule (`HANGS`), on the dataset's "body only" and ours alike.
      for (const key of [
        'Pullups',
        'Chin-Up',
        'rw-negative-pull-up',
        'rw-hanging-knee-raise',
        'rw-toes-to-bar',
      ]) {
        expect([key, byKey.get(key)!.equipment]).toEqual([key, ['bar']]);
      }
    });
  });

  describe('the warm-up and cool-down lists (DN-172)', () => {
    it('points every entry at a movement the library holds', () => {
      // The seed throws on one it cannot find; this says so before a deploy.
      expect(checklistEntries.filter((c) => !byKey.has(c.exercise))).toEqual(
        [],
      );
    });

    it('puts a movement on each checklist at most once', () => {
      const keys = checklistEntries.map((c) => `${c.kind} ${c.exercise}`);
      expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([]);
    });

    it('speaks only the checklist and pattern words the app knows', () => {
      for (const c of checklistEntries) {
        expect(checklistKind.options).toContain(c.kind);
        if (c.pattern !== null) {
          expect(movementPattern.options).toContain(c.pattern);
        }
      }
    });

    it('warms up with the squat the squat group prescribes', () => {
      expect(byKey.get('Bodyweight_Squat')?.movementGroup).toBe('squat');
      expect(
        checklistEntries.find(
          (c) => c.exercise === 'Bodyweight_Squat' && c.kind === 'warmup',
        )?.instructions,
      ).toMatch(/not a set to work at/);
    });

    it('keeps the cross-body copy on the shoulder stretch’s cool-down', () => {
      // The dataset's one line says nothing about holding the stretch; the
      // copy the row had moved onto its entry when it became a twin.
      expect(
        checklistEntries.find(
          (c) => c.exercise === 'Shoulder_Stretch' && c.kind === 'cooldown',
        )?.instructions,
      ).toMatch(/Hold twenty to thirty seconds/);
    });

    it('gives both checklists a filler for a day nothing else matches', () => {
      // A cardio day matches no entry; the filler is all it gets.
      for (const kind of checklistKind.options) {
        const filler = checklistEntries.some(
          (c) => c.kind === kind && c.pattern === null,
        );
        expect([kind, filler]).toEqual([kind, true]);
      }
    });
  });

  it('curates nothing the files do not hold', () => {
    // `buildLibrary` refuses this outright; asserted here as well so the
    // failure names the file to fix rather than a stack trace.
    expect(Object.keys(curation).filter((key) => !byKey.has(key))).toEqual([]);
  });
});
