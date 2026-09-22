import {
  DEFAULT_EQUIPMENT,
  planDetailSchema,
  type PlanDetail,
} from '@regimen-works/shared';
import { exercises } from '../../prisma/exercise-seed';
import { wods } from '../../prisma/wod-seed';
import {
  FIRST_PROGRAMS,
  FOUNDATIONS,
  PULL_UP_BUILDER,
  programMovementId,
  programSlotId,
  programWeekId,
} from './first-programs';
import { minimumViableWeeks } from './plan.logic';
import { narrowToSlot } from './program-day';

/**
 * The two authored programs (DN-24), checked against the contracts they will
 * be read under.
 *
 * Content, like the WOD library, and checked for the same reason: this is
 * written by hand and read by a deploy, so without something here the first
 * reader of a mistake is an athlete whose Thursday is wrong. Unlike a WOD, a
 * program is also a *schedule*, and most of what can be wrong with one is
 * invisible in any single row -- two pull days landing back to back is a
 * property of the week, not of either day.
 */

/** The seed as the API serves it, so `planDetailSchema` can be asked about it. */
function asDetail(program: (typeof FIRST_PROGRAMS)[number]): PlanDetail {
  return {
    ...program,
    weeks: program.weeks.map((week) => ({
      id: programWeekId(program.id, week.order),
      order: week.order,
      phase: week.phase,
      label: week.label,
      slots: week.slots.map((slot) => ({
        id: programSlotId(program.id, week.order, slot.dayOfWeek),
        dayOfWeek: slot.dayOfWeek,
        kind: slot.kind,
        priority: slot.priority,
        wodId: null,
        pattern: slot.pattern ?? null,
        wodType: slot.wodType ?? null,
        allowNamed: slot.allowNamed ?? false,
        maxTimeCapMinutes: slot.maxTimeCapMinutes ?? null,
        movements: (slot.movements ?? []).map((movement, index) => ({
          id: programMovementId(program.id, week.order, slot.dayOfWeek, index),
          order: index,
          movementGroup: movement.movementGroup,
          exerciseId: null,
          sets: movement.sets,
          reps: movement.reps,
          restSeconds: movement.restSeconds,
        })),
      })),
    })),
  };
}

const MONDAY = 1;
const TUESDAY = 2;
const WEDNESDAY = 3;
const THURSDAY = 4;
const FRIDAY = 5;

describe('the first programs', () => {
  it.each(FIRST_PROGRAMS.map((p) => [p.name, p] as const))(
    '%s satisfies planDetailSchema, and so every database CHECK it mirrors',
    (_name, program) => {
      // The refinements mirror the constraints, so parsing here is the cheap
      // half of the proof the db spec makes expensively -- and it catches the
      // whole class at once: the schedule-mode bounds, the pinned-WOD
      // biconditional, and the one no CHECK can hold, that a `movements` slot
      // prescribes something and nothing else does.
      const result = planDetailSchema.safeParse(asDetail(program));
      expect(result.error?.issues ?? []).toEqual([]);
      expect(result.success).toBe(true);
    },
  );

  it('makes every fixed program explain the week it takes over', () => {
    // A fixed program overrides the athlete's own training days and, since
    // DN-17, never offers a rest-day makeup. DN-124 says both at enrollment,
    // and both read as things done *to* the athlete unless the program says
    // why in its own words. So a fixed program without a note is unshippable
    // -- not a style rule, the missing half of a screen that already exists.
    for (const program of FIRST_PROGRAMS.filter(
      (p) => p.scheduleMode === 'fixed',
    )) {
      expect(program.scheduleNote).toEqual(expect.any(String));
    }
  });

  it('leaves the note off a program that takes nothing away', () => {
    // A flexible program keeps the athlete's days and offers the makeup, so
    // there is nothing to justify. The wizard shows the panel only when it
    // has something to put in it.
    expect(FOUNDATIONS.scheduleNote).toBeNull();
  });

  it('ships both schedule modes, because they are different code paths', () => {
    // Not a taste question. `resolveProgramDay` branches on `scheduleMode`:
    // a flexible program defers to the athlete's training days and a fixed
    // one overrides them. Shipping only one mode would leave the other branch
    // running in production with no program that reaches it.
    expect(FIRST_PROGRAMS.map((p) => p.scheduleMode).sort()).toEqual([
      'fixed',
      'flexible',
    ]);
  });

  it.each(FIRST_PROGRAMS.map((p) => [p.name, p] as const))(
    '%s has ids that stay put across deploys',
    (_name, program) => {
      // Fixed ids rather than cuids, for the reason Just WODs has them: the
      // seed runs on every deploy, and ids that moved would leave every
      // enrollment pointing at a program that no longer exists. A collision
      // between the two programs would be the same failure wearing the other
      // face -- one program's week silently overwriting the other's.
      const ids = program.weeks.flatMap((week) => [
        programWeekId(program.id, week.order),
        ...week.slots.flatMap((slot) => [
          programSlotId(program.id, week.order, slot.dayOfWeek),
          ...(slot.movements ?? []).map((_m, i) =>
            programMovementId(program.id, week.order, slot.dayOfWeek, i),
          ),
        ]),
      ]);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.every((id) => id.startsWith(program.id))).toBe(true);
    },
  );

  /**
   * DN-24's third task, and the reason `minWeeks` exists at all.
   *
   * `expandPlanWeeks` plays intro, then the core block cycled **in order**,
   * then peak, and `truncateToFit` trims from the front. A `minWeeks` below
   * intro + one whole block + peak lets an athlete choose a length that ends
   * partway through the wave -- on whichever week happens to fall last, which
   * for a rising wave is a light one. The program would finish on its easiest
   * session and call that a peak.
   */
  it.each(FIRST_PROGRAMS.map((p) => [p.name, p] as const))(
    '%s cannot be run short enough to end mid-wave',
    (_name, program) => {
      expect(program.minWeeks).toBe(minimumViableWeeks(program.weeks));
    },
  );

  it.each(FIRST_PROGRAMS.map((p) => [p.name, p] as const))(
    '%s offers a length range the picker can actually bound',
    (_name, program) => {
      expect(program.minWeeks).toBeLessThanOrEqual(program.defaultWeeks);
      expect(program.defaultWeeks).toBeLessThanOrEqual(program.maxWeeks);
    },
  );

  /**
   * The wave itself: this is what "overload" means in this app.
   *
   * Nothing measures the athlete and nothing escalates on their behalf -- the
   * core block is written to rise, and `expandPlanWeeks` replays it. So the
   * claim "the core weeks wave" is a claim about the authored data and
   * nowhere else, and this is the only place it can be checked.
   */
  it.each(FIRST_PROGRAMS.map((p) => [p.name, p] as const))(
    '%s waves across its core block',
    (_name, program) => {
      const core = program.weeks.filter((w) => w.phase === 'core');
      expect(core.length).toBeGreaterThan(1);

      // Read off the main session -- the priority-0 slot -- rather than off
      // every movement: the accessory work deliberately holds still while the
      // lines the program is about are what climb.
      const topSets = core.map((week) => {
        const main = week.slots.find((s) => s.priority === 0);
        return main?.movements?.[0].sets;
      });
      expect(topSets).toEqual([...topSets].sort((a, b) => a! - b!));
      expect(new Set(topSets).size).toBe(core.length);
    },
  );

  it.each(FIRST_PROGRAMS.map((p) => [p.name, p] as const))(
    '%s prescribes lines a day-one athlete can already train',
    (_name, program) => {
      // A prescription names a movement groups, and the athlete trains
      // whichever rung they are on -- which for a new athlete is the bottom
      // one. A line whose bottom rung needs equipment is a session an athlete
      // with a bar and a floor cannot do, and unlike a WOD there is no
      // generated fallback behind it.
      const owned = new Set<string>(DEFAULT_EQUIPMENT);
      const dayOneLines = new Set(
        exercises
          .filter(
            (e) =>
              e.rung === 0 && (e.equipment ?? []).every((p) => owned.has(p)),
          )
          .map((e) => e.movementGroup),
      );
      const unreachable = [
        ...new Set(
          program.weeks.flatMap((week) =>
            week.slots.flatMap((slot) =>
              (slot.movements ?? []).map((m) => m.movementGroup),
            ),
          ),
        ),
      ].filter((movementGroup) => !dayOneLines.has(movementGroup));
      expect(unreachable).toEqual([]);
    },
  );

  /**
   * The other half of DN-23, seen from the program side.
   *
   * DN-23 filled the pattern x format grid so that *ordinary* slot requests
   * stop relaxing. These are the first real slots to make such requests, and
   * a program whose Friday quietly gives up its pattern is a program whose
   * emphasis is a suggestion. Asserted against the day-one library for the
   * same reason DN-23 was: the athlete who owns nothing is the default.
   */
  it.each(FIRST_PROGRAMS.map((p) => [p.name, p] as const))(
    '%s asks for generated WODs the library can satisfy exactly',
    (_name, program) => {
      const exerciseByName = new Map(exercises.map((e) => [e.name, e]));
      const owned = new Set<string>(DEFAULT_EQUIPMENT);
      const dayOne = wods.filter((wod) => {
        const dominant = wod.movements
          .map((m) => exerciseByName.get(m.exercise))
          .find((e) => e?.pattern === wod.dominantPattern);
        return (dominant?.equipment ?? []).every((piece) => owned.has(piece));
      });

      const relaxing = program.weeks.flatMap((week) =>
        week.slots
          .filter((slot) => slot.kind === 'wod_generated')
          .flatMap((slot) => {
            const { relaxed } = narrowToSlot(dayOne, {
              pattern: slot.pattern ?? null,
              wodType: slot.wodType ?? null,
              allowNamed: slot.allowNamed ?? false,
              maxTimeCapMinutes: slot.maxTimeCapMinutes ?? null,
            });
            return relaxed.length > 0
              ? [`week ${week.order} day ${slot.dayOfWeek}: ${relaxed.join()}`]
              : [];
          }),
      );
      expect(relaxing).toEqual([]);
    },
  );

  describe('Pull-Up Builder', () => {
    it('is fixed, carrying neither day bound nor a suggestion', () => {
      // All three together. The CHECK refuses the bounds, but `defaultDays` is
      // not constrained -- a fixed program carrying a suggestion would be
      // offering a choice the picker will not show and the resolver will not
      // honour.
      expect(PULL_UP_BUILDER.scheduleMode).toBe('fixed');
      expect(PULL_UP_BUILDER.minDaysPerWeek).toBeNull();
      expect(PULL_UP_BUILDER.maxDaysPerWeek).toBeNull();
      expect(PULL_UP_BUILDER.defaultDays).toEqual([]);
    });

    /**
     * The reason this program is allowed to lock the week at all.
     *
     * `fixed` overrides the athlete's own training days, which is a strong
     * thing for a program to do; it earns it by needing spacing that "four
     * days a week" cannot express. If the pull days ever land on consecutive
     * days the justification is gone and the program should be flexible.
     */
    it('never puts two pull sessions on consecutive days', () => {
      const offenders = PULL_UP_BUILDER.weeks.flatMap((week) => {
        const pullDays = week.slots
          .filter((slot) =>
            slot.kind === 'movements'
              ? (slot.movements ?? []).some((m) => m.movementGroup === 'pull')
              : slot.pattern === 'pull',
          )
          .map((slot) => slot.dayOfWeek)
          .sort((a, b) => a - b);
        return pullDays
          .filter((day, i) => i > 0 && day - pullDays[i - 1] < 2)
          .map((day) => `week ${week.order} day ${day}`);
      });
      expect(offenders).toEqual([]);
    });

    it('spaces its two heavy pull days 72 hours apart', () => {
      // The specific claim the program makes, rather than the weaker one
      // above: Monday and Thursday, every core week, which is what a
      // frequency alone cannot say.
      const heavyDays = PULL_UP_BUILDER.weeks
        .filter((w) => w.phase === 'core')
        .map((week) =>
          week.slots
            .filter((slot) =>
              (slot.movements ?? []).some(
                (m) => m.movementGroup === 'pull' && m.reps === 5,
              ),
            )
            .map((slot) => slot.dayOfWeek),
        );
      expect(heavyDays).toEqual(heavyDays.map(() => [MONDAY, THURSDAY]));
    });

    it('trains four days a week, every week', () => {
      const trained = PULL_UP_BUILDER.weeks.map(
        (week) => week.slots.filter((s) => s.kind !== 'rest').length,
      );
      // The peak week trains three and rests the fourth on purpose, which is
      // the one exception and is stated rather than averaged away.
      expect(trained).toEqual([4, 4, 4, 4, 3]);
    });

    /**
     * Where a benchmark is allowed to appear, and it is one slot.
     *
     * `allowNamed` defaults false because a named WOD landing mid-progression
     * is a surprise rather than a preference -- DN-14 ranked it above pattern
     * for exactly that reason. A re-test is the case where the surprise is the
     * point: the whole program was written to arrive at it.
     */
    it('allows a benchmark only on the re-test', () => {
      const named = PULL_UP_BUILDER.weeks.flatMap((week) =>
        week.slots
          .filter((slot) => slot.allowNamed === true)
          .map((slot) => `${week.phase} day ${slot.dayOfWeek}`),
      );
      expect(named).toEqual([`peak day ${THURSDAY}`]);
    });

    it('ends on the re-test rather than after it', () => {
      const peak = PULL_UP_BUILDER.weeks.at(-1)!;
      expect(peak.phase).toBe('peak');
      expect(peak.slots.find((s) => s.dayOfWeek === FRIDAY)?.kind).toBe('rest');
    });
  });

  describe('Foundations', () => {
    it('is flexible, carrying both bounds and a suggestion', () => {
      expect(FOUNDATIONS.scheduleMode).toBe('flexible');
      expect(FOUNDATIONS.minDaysPerWeek).toBe(3);
      expect(FOUNDATIONS.maxDaysPerWeek).toBe(5);
    });

    it('authors a slot for every day it says it can be run at', () => {
      // Authoring three days while offering five would make "up to five days"
      // a lie: the extra days would resolve to nothing at all.
      const counts = FOUNDATIONS.weeks.map((w) => w.slots.length);
      expect(counts).toEqual(counts.map(() => FOUNDATIONS.maxDaysPerWeek));
    });

    /**
     * DN-24's fourth task, as data.
     *
     * `priority` is the author answering "which of these days *is* the
     * program". A tie declines to answer, so the ranking is total: any two
     * slots sharing a rank are two slots a shortened run has no way to choose
     * between.
     *
     * This checks the data only. What reads it is
     * `assignSlotsToTrainingDays` (DN-128), which lays the highest-ranked
     * sessions onto whichever days the athlete trains; the walk that proves a
     * Tue/Thu/Sat athlete gets this program rather than its leftovers lives in
     * `first-programs.db-spec.ts`.
     */
    it('ranks its days totally, with no ties to guess at', () => {
      for (const week of FOUNDATIONS.weeks) {
        const priorities = week.slots.map((s) => s.priority).sort();
        expect(priorities).toEqual([0, 1, 2, 3, 4]);
      }
    });

    it('keeps every pattern in the three days it would be run short at', () => {
      // The property the ranking exists to protect. Run at its three-day
      // minimum, the program still has to be the program -- push in both
      // directions, pull, squat, hinge and core. A ranking that dropped the
      // only hinge day would turn a whole-body program into an upper-body one
      // without saying so.
      for (const week of FOUNDATIONS.weeks) {
        const kept = week.slots.filter(
          (s) => s.priority < FOUNDATIONS.minDaysPerWeek!,
        );
        const lines = new Set(
          kept.flatMap((s) => (s.movements ?? []).map((m) => m.movementGroup)),
        );
        expect([...lines].sort()).toEqual([
          'core_dynamic',
          'core_hold',
          'core_side',
          'hinge',
          'pull',
          'push_horizontal',
          'push_vertical',
          'squat',
        ]);
      }
    });

    it('suggests exactly the days it would keep if run short', () => {
      // Otherwise the picker's own default contradicts the author's ranking:
      // an athlete who accepts the suggested days would be handed the
      // second-choice sessions on day one.
      const ranked = FOUNDATIONS.weeks[0].slots
        .filter((s) => s.priority < FOUNDATIONS.minDaysPerWeek!)
        .map((s) => s.dayOfWeek)
        .sort((a, b) => a - b);
      expect(FOUNDATIONS.defaultDays).toEqual(ranked);
      expect(ranked).toEqual([MONDAY, WEDNESDAY, FRIDAY]);
    });

    it('does not claim a goal it cannot deliver', () => {
      // Straight sets across every pattern is a way of training, not a single
      // nameable thing to finish with -- the same reason Just WODs has no
      // goal. Naming one would be the picker promising what the program does
      // not.
      expect(FOUNDATIONS.goal).toBeNull();
    });

    it('gives its conditioning day away before its strength days', () => {
      const tuesday = FOUNDATIONS.weeks[0].slots.find(
        (s) => s.dayOfWeek === TUESDAY,
      );
      expect(tuesday?.kind).toBe('wod_generated');
      expect(tuesday?.priority).toBeGreaterThanOrEqual(
        FOUNDATIONS.minDaysPerWeek!,
      );
    });
  });
});
