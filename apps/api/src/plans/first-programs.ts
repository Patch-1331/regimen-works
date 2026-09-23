import type { PrismaClient } from '@prisma/client';
import type {
  MovementPattern,
  PlanPhase,
  PlanSlotKind,
  MovementGroup,
  ScheduleMode,
  WodType,
} from '@regimen-works/shared';

/**
 * The first two real programs (DN-24).
 *
 * Authored here rather than in `prisma/` because these are plans, and the one
 * plan that already existed -- Just WODs -- is authored in this directory
 * with its upsert beside it. The shape is deliberately the same: exported
 * data with nothing happening on import, and one function that writes it, so
 * a spec can read the programs without a database and exercise the write with
 * one.
 *
 * Two programs, one **fixed** and one **flexible**, because they are not two
 * flavours of the same thing: a fixed program's slot layout *is* its
 * schedule, and a flexible one defers to the athlete's own training days.
 * `resolveProgramDay` genuinely branches on that, and until now only the
 * flexible path had a program to run.
 *
 * ## Ids are written down, not generated
 *
 * Same reason as Just WODs: the seed runs on every deploy, and a program
 * whose ids moved would orphan every enrollment pointing at it. With the ids
 * fixed, re-seeding updates the rows an athlete is already running.
 *
 * ## What is deliberately *not* here
 *
 * No third program. Two cover both schedule modes, both slot kinds that carry
 * content, and both ends of the length range; a third would be more content
 * to keep current without exercising a path the first two miss.
 */

/** A prescribed movement. `line` rather than a specific exercise, so the day
 * resolves through whichever movement the athlete has chosen for themselves. */
type MovementSeed = {
  movementGroup: MovementGroup;
  sets: number;
  /** Seconds on a held movement, where the group's unit says so -- `core_hold`
   * is counted the way a WOD counts a plank, not in repetitions. */
  reps: number;
  restSeconds: number;
};

type SlotSeed = {
  /** 0 = Sunday … 6 = Saturday, the numbering the whole app uses. */
  dayOfWeek: number;
  kind: PlanSlotKind;
  priority: number;
  pattern?: MovementPattern;
  wodType?: WodType;
  allowNamed?: boolean;
  maxTimeCapMinutes?: number;
  movements?: MovementSeed[];
};

type WeekSeed = {
  order: number;
  phase: PlanPhase;
  label: string | null;
  slots: SlotSeed[];
};

type ProgramSeed = {
  id: string;
  name: string;
  summary: string;
  goal: string | null;
  scheduleNote: string | null;
  scheduleMode: ScheduleMode;
  minDaysPerWeek: number | null;
  maxDaysPerWeek: number | null;
  defaultDays: number[];
  minWeeks: number;
  maxWeeks: number;
  defaultWeeks: number;
  weeks: WeekSeed[];
};

const MONDAY = 1;
const TUESDAY = 2;
const WEDNESDAY = 3;
const THURSDAY = 4;
const FRIDAY = 5;

/**
 * The wave both programs are built on: three core weeks that differ only in
 * how many sets the main lines carry.
 *
 * This is the whole mechanism behind authored overload. `expandPlanWeeks`
 * cycles the core block **in order**, so a block that already waves replays
 * the wave -- 3, 4, 5, 3, 4, 5 -- and a program gets harder because its
 * author wrote it that way rather than because anything measured the athlete.
 *
 * Reps stay put and sets move, because sets are the honest thing to add when
 * the movement itself is the progression: an athlete on a harder movement is
 * doing harder work at the same 5 reps, and adding reps on top would be two
 * progressions fighting over the same session.
 */
const WAVE = [3, 4, 5];

/**
 * Pull-Up Builder -- fixed, four days, pull emphasis, ending in a re-test.
 *
 * ## Why this one is allowed to lock the week
 *
 * `fixed` is a strong claim: it overrides the athlete's own training days, so
 * a program only earns it by needing spacing that "four days a week" cannot
 * express. This one does. The two pull sessions are Monday and Thursday --
 * **72 hours apart, and never on consecutive days** -- because the pulling
 * muscles are what the whole program is about and the day after a heavy pull
 * day is the one day they must not be trained again. Tuesday and Friday sit
 * in the gaps on purpose: they are what the athlete does *instead of* pulling.
 *
 * An athlete who picked Mon/Tue/Wed/Thu from a flexible version of this
 * program would be pulling on Monday and Thursday too -- and also, without
 * meaning to, on Wednesday, because Wednesday's slot is a pull day in a
 * four-day week. Locking the layout is the only way to say the real rule.
 *
 * ## The re-test
 *
 * The peak week's Thursday is the one slot in either program with
 * `allowNamed: true`. Everywhere else a benchmark landing mid-programme is
 * the surprise the default exists to prevent -- but a re-test *is* a
 * benchmark, and this is the day the program was written to arrive at. The
 * Friday after it is authored rest, because there is nothing left to add.
 */
export const PULL_UP_BUILDER: ProgramSeed = {
  id: 'plan_pull_up_builder',
  name: 'Pull-Up Builder',
  summary: 'Four days a week, built around two pull sessions and the rest.',
  // A goal is what *finishing* gets you. Phrased against where the athlete
  // starts rather than against a bar they are assumed not to clear: the app
  // does not score anybody, and a goal that reads as a verdict on today would
  // be scoring them in the picker before they have trained once.
  goal: 'More pull-ups than you started the six weeks with.',
  // The reason the week is locked, said before it is locked (DN-124). Written
  // as the program's design rather than as a rule the athlete is under: the
  // gap is a training decision, and an athlete who knows why Wednesday is off
  // has been let in on the programming rather than fenced out of it.
  scheduleNote:
    'Two heavy pull days, 48 hours apart. The gap is what makes the second one heavy.',
  scheduleMode: 'fixed',
  // Both null and `defaultDays` empty: the migration's CHECK holds fixed and
  // flexible apart, and the slot layout above already answers which days.
  minDaysPerWeek: null,
  maxDaysPerWeek: null,
  defaultDays: [],
  // Intro + one whole wave + peak. Below this the run ends partway through
  // the block, on whichever week of the wave happens to fall last.
  minWeeks: 5,
  // Six plays the wave once and then opens it again for a single light week
  // before the peak, which is a deload in the right place rather than an
  // accident -- the prototype's six weeks, and a good six.
  defaultWeeks: 6,
  // Three whole waves. Past that the block has stopped being a wave and
  // become a habit, which is what Just WODs is for.
  maxWeeks: 12,
  weeks: [
    {
      order: 0,
      phase: 'intro',
      label: 'Settling in',
      slots: pullUpWeek(3),
    },
    ...WAVE.map((sets, i) => ({
      order: i + 1,
      phase: 'core' as const,
      // Only the top of the wave is worth saying out loud on a calendar
      // preview; "week 2" is all there is to say about the other two.
      label: sets === 5 ? 'Top of the wave' : null,
      slots: pullUpWeek(sets),
    })),
    {
      order: 4,
      phase: 'peak',
      label: 'Re-test',
      slots: [
        {
          dayOfWeek: MONDAY,
          kind: 'movements',
          priority: 0,
          movements: [
            // Heavier and shorter than any core week: five sets of three with
            // three minutes between them is a strength session, not a volume
            // one. The point of the week is Thursday, and Monday is what
            // leaves something for it.
            { movementGroup: 'pull', sets: 5, reps: 3, restSeconds: 180 },
            {
              movementGroup: 'core_dynamic',
              sets: 3,
              reps: 12,
              restSeconds: 60,
            },
          ],
        },
        {
          dayOfWeek: TUESDAY,
          kind: 'movements',
          priority: 1,
          movements: [
            { movementGroup: 'squat', sets: 3, reps: 8, restSeconds: 90 },
            { movementGroup: 'hinge', sets: 3, reps: 10, restSeconds: 60 },
          ],
        },
        {
          // The re-test. A named WOD is exactly the right shape for it: a
          // benchmark is a workout whose whole purpose is to be compared with
          // the last time you did it.
          dayOfWeek: THURSDAY,
          kind: 'wod_generated',
          priority: 2,
          pattern: 'pull',
          allowNamed: true,
          maxTimeCapMinutes: 30,
        },
        {
          // Authored rest, not an unwritten day. The program is saying "you
          // are done", which is a different fact from having nothing to say.
          dayOfWeek: FRIDAY,
          kind: 'rest',
          priority: 3,
        },
      ],
    },
  ],
};

/**
 * One week of Pull-Up Builder at a given number of sets on the main lines.
 *
 * Written as a function because the four days are the same four days every
 * week and only the wave moves. Spelling each week out instead would be five
 * near-identical blocks whose differences a reader has to find by eye, and
 * where a typo on week three reads as programming.
 */
function pullUpWeek(sets: number): SlotSeed[] {
  return [
    {
      // Heavy pull. The session the program is named after.
      dayOfWeek: MONDAY,
      kind: 'movements',
      priority: 0,
      movements: [
        { movementGroup: 'pull', sets, reps: 5, restSeconds: 120 },
        { movementGroup: 'push_horizontal', sets: 3, reps: 8, restSeconds: 90 },
        { movementGroup: 'core_dynamic', sets: 3, reps: 10, restSeconds: 60 },
      ],
    },
    {
      // Legs, deliberately the day after a pull day: nothing here asks the
      // back or the arms for anything.
      dayOfWeek: TUESDAY,
      kind: 'movements',
      priority: 1,
      movements: [
        { movementGroup: 'squat', sets: 3, reps: 10, restSeconds: 90 },
        { movementGroup: 'hinge', sets: 3, reps: 12, restSeconds: 60 },
        { movementGroup: 'core_hold', sets: 3, reps: 30, restSeconds: 45 },
      ],
    },
    {
      // The second pull session, 72 hours after the first. Same line, same
      // wave, different company -- pressing overhead rather than horizontally,
      // so the two upper-body days are not the same day twice.
      dayOfWeek: THURSDAY,
      kind: 'movements',
      priority: 0,
      movements: [
        { movementGroup: 'pull', sets, reps: 5, restSeconds: 120 },
        { movementGroup: 'push_vertical', sets: 3, reps: 5, restSeconds: 90 },
        { movementGroup: 'core_side', sets: 3, reps: 20, restSeconds: 45 },
      ],
    },
    {
      // Conditioning, and the only generated day in the week.
      //
      // Cardio-dominant rather than pull-dominant, which is the whole spacing
      // rule applied to itself: Friday is the day after a heavy pull session,
      // and a pull-dominant WOD there would be a third pull day wearing a
      // conditioning label -- the very thing this program locks the week to
      // prevent. An emphasis is not a licence to put the emphasis everywhere.
      //
      // Capped at twenty minutes, and benchmark-free like every slot but the
      // re-test.
      dayOfWeek: FRIDAY,
      kind: 'wod_generated',
      priority: 2,
      pattern: 'cardio',
      allowNamed: false,
      maxTimeCapMinutes: 20,
    },
  ];
}

/**
 * Foundations -- flexible, three to five days, straight sets across every
 * pattern.
 *
 * The opposite claim to Pull-Up Builder's, and an honest one: this program
 * has no opinion about *which* days are trained, only about what happens on
 * them. An athlete who trains Tuesday and Saturday is not doing it wrong.
 *
 * ## Five days authored for a three-day minimum
 *
 * Authoring exactly three would make "up to five days" a lie. Authoring five
 * and ranking them is what lets the same program be a three-day program and a
 * five-day one: `priority` is the author saying which sessions are the
 * program and which are the extras, so a run at three days keeps
 * Monday, Wednesday and Friday -- between them every pattern the groups
 * train -- rather than whichever days happen to fall earliest in the week.
 *
 * The ranking is total rather than grouped, because a tie is the author
 * declining to answer the only question `priority` is asked.
 */
export const FOUNDATIONS: ProgramSeed = {
  id: 'plan_foundations',
  name: 'Foundations',
  summary: 'Straight sets across every pattern, three to five days a week.',
  // No single nameable thing to finish with -- this is a way of training, and
  // claiming a target it does not deliver would be worse than claiming none.
  goal: null,
  // Nothing to explain: this program's whole claim is that it fits the week
  // the athlete already has, so the week's shape is theirs and not its.
  scheduleNote: null,
  scheduleMode: 'flexible',
  minDaysPerWeek: 3,
  maxDaysPerWeek: 5,
  // Where the picker starts, not where it has to stay. Mon/Wed/Fri is the
  // three-day shape this program was written around.
  defaultDays: [MONDAY, WEDNESDAY, FRIDAY],
  minWeeks: 5,
  // Two whole waves. Eight weeks of straight sets is long enough for the
  // choice to have moved under somebody, which is the point of the program.
  defaultWeeks: 8,
  maxWeeks: 16,
  weeks: [
    {
      order: 0,
      phase: 'intro',
      label: 'Settling in',
      slots: foundationsWeek(3),
    },
    ...WAVE.map((sets, i) => ({
      order: i + 1,
      phase: 'core' as const,
      label: sets === 5 ? 'Top of the wave' : null,
      slots: foundationsWeek(sets),
    })),
    {
      order: 4,
      phase: 'peak',
      label: 'Top sets',
      // Five sets at lower reps everywhere: the same session shapes the whole
      // program has used, asked for once at the heavy end.
      slots: foundationsWeek(5, { peak: true }),
    },
  ],
};

/**
 * One week of Foundations.
 *
 * The three priority-0-to-2 days are the program: between them they cover
 * push horizontal and vertical, pull, squat, hinge and all three core lines.
 * The two ranked below are the ones a five-day athlete gets as well --
 * conditioning, and a second pass at the legs.
 */
function foundationsWeek(
  sets: number,
  { peak = false }: { peak?: boolean } = {},
): SlotSeed[] {
  // At the top of the program the reps come down rather than the sets going
  // further up: six sets of anything is a different program.
  const upperReps = peak ? 3 : 5;
  const pressReps = peak ? 5 : 8;
  const legReps = peak ? 5 : 10;

  return [
    {
      dayOfWeek: MONDAY,
      kind: 'movements',
      priority: 0,
      movements: [
        {
          movementGroup: 'push_horizontal',
          sets,
          reps: pressReps,
          restSeconds: 90,
        },
        { movementGroup: 'pull', sets, reps: upperReps, restSeconds: 120 },
        { movementGroup: 'core_dynamic', sets: 3, reps: 10, restSeconds: 60 },
      ],
    },
    {
      dayOfWeek: WEDNESDAY,
      kind: 'movements',
      priority: 1,
      movements: [
        { movementGroup: 'squat', sets, reps: legReps, restSeconds: 90 },
        { movementGroup: 'hinge', sets, reps: legReps + 2, restSeconds: 60 },
        { movementGroup: 'core_hold', sets: 3, reps: 30, restSeconds: 45 },
      ],
    },
    {
      dayOfWeek: FRIDAY,
      kind: 'movements',
      priority: 2,
      movements: [
        {
          movementGroup: 'push_vertical',
          sets,
          reps: upperReps,
          restSeconds: 90,
        },
        { movementGroup: 'pull', sets, reps: upperReps, restSeconds: 120 },
        { movementGroup: 'core_side', sets: 3, reps: 20, restSeconds: 45 },
      ],
    },
    {
      // The fourth day an athlete gets, and the first thing dropped at four.
      // Conditioning rather than more straight sets, because a program made
      // only of straight sets is missing the thing WODs are for.
      dayOfWeek: TUESDAY,
      kind: 'wod_generated',
      priority: 3,
      pattern: 'cardio',
      allowNamed: false,
      maxTimeCapMinutes: 20,
    },
    {
      // The fifth. A second pass at the legs, which is the pattern that takes
      // the extra day best.
      dayOfWeek: THURSDAY,
      kind: 'movements',
      priority: 4,
      movements: [
        { movementGroup: 'squat', sets: 3, reps: legReps, restSeconds: 90 },
        { movementGroup: 'hinge', sets: 3, reps: legReps + 2, restSeconds: 60 },
        { movementGroup: 'core_dynamic', sets: 3, reps: 12, restSeconds: 60 },
      ],
    },
  ];
}

export const FIRST_PROGRAMS: ProgramSeed[] = [PULL_UP_BUILDER, FOUNDATIONS];

/** Deterministic ids, for the reason spelled out at the top of the file. */
export function programWeekId(programId: string, order: number): string {
  return `${programId}_w${order}`;
}

export function programSlotId(
  programId: string,
  order: number,
  dayOfWeek: number,
): string {
  return `${programWeekId(programId, order)}_d${dayOfWeek}`;
}

export function programMovementId(
  programId: string,
  order: number,
  dayOfWeek: number,
  index: number,
): string {
  return `${programSlotId(programId, order, dayOfWeek)}_m${index}`;
}

/**
 * Writes both programs, updating rows that have drifted from the definitions
 * above.
 *
 * Updates rather than creates-if-missing, for the reason `upsertJustWods`
 * does: an athlete enrolled last month must not be left running last month's
 * program because the rows already existed.
 *
 * Prescriptions are deleted and rewritten per slot rather than upserted
 * row-by-row, because a week that loses a movement is an edit like any other
 * and an upsert would leave the removed row behind -- the same reason the WOD
 * seed clears `WodMovement` before writing. The delete is keyed on the slot,
 * so it cannot reach a prescription belonging to anything else.
 */
export async function upsertFirstPrograms(
  prisma: Pick<
    PrismaClient,
    'plan' | 'planWeek' | 'planSlot' | 'planSlotMovement'
  >,
): Promise<void> {
  for (const program of FIRST_PROGRAMS) {
    const { id, weeks, ...planFields } = program;
    const fields = { ...planFields, ownerId: null };
    await prisma.plan.upsert({
      where: { id },
      update: fields,
      create: { id, ...fields },
    });

    for (const week of weeks) {
      const weekId = programWeekId(id, week.order);
      const weekFields = {
        planId: id,
        order: week.order,
        phase: week.phase,
        label: week.label,
      };
      await prisma.planWeek.upsert({
        where: { id: weekId },
        update: weekFields,
        create: { id: weekId, ...weekFields },
      });

      for (const slot of week.slots) {
        const slotId = programSlotId(id, week.order, slot.dayOfWeek);
        const slotFields = {
          planWeekId: weekId,
          dayOfWeek: slot.dayOfWeek,
          kind: slot.kind,
          priority: slot.priority,
          // Written out rather than spread, so a slot that stops constraining
          // an axis has that axis cleared on an existing row instead of
          // keeping whatever the last definition put there.
          wodId: null,
          pattern: slot.pattern ?? null,
          wodType: slot.wodType ?? null,
          allowNamed: slot.allowNamed ?? false,
          maxTimeCapMinutes: slot.maxTimeCapMinutes ?? null,
        };
        await prisma.planSlot.upsert({
          where: { id: slotId },
          update: slotFields,
          create: { id: slotId, ...slotFields },
        });

        await prisma.planSlotMovement.deleteMany({
          where: { planSlotId: slotId },
        });
        const movements = slot.movements ?? [];
        for (const [index, movement] of movements.entries()) {
          await prisma.planSlotMovement.create({
            data: {
              id: programMovementId(id, week.order, slot.dayOfWeek, index),
              planSlotId: slotId,
              order: index,
              movementGroup: movement.movementGroup,
              exerciseId: null,
              sets: movement.sets,
              reps: movement.reps,
              restSeconds: movement.restSeconds,
            },
          });
        }
      }
    }
  }
}
