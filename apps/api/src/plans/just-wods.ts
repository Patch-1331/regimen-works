import type { PrismaClient } from '@prisma/client';
import { DEFAULT_PLAN_ID, DEFAULT_TRAINING_DAYS } from '@regimen-works/shared';

/**
 * Just WODs as a real program (DN-13).
 *
 * The load-bearing decision of the whole Programs design: today's behaviour
 * is seeded as a `Plan` and every athlete is enrolled in it, so `getToday`
 * keeps **one path** instead of growing an `if (enrolled) … else …` that
 * would spread into the scheduler, the today response, History and Stats.
 *
 * Fixed ids rather than cuids, because two callers create this row and
 * neither may win a race: the deploy seed, and `UserProvisioningService` on
 * an athlete's first authenticated request. With the ids written down, both
 * are `INSERT … ON CONFLICT DO NOTHING` against a known key and the second
 * one is simply a no-op. They also let provisioning enroll an athlete
 * without first reading the plan back to learn what it is called.
 */
// Re-exported from the shared package rather than declared here: the web app
// has to recognise this id too (DN-16), and an id written down twice is an id
// that can differ.
export const JUST_WODS_PLAN_ID = DEFAULT_PLAN_ID;
export const JUST_WODS_WEEK_ID = 'plan_week_just_wods';

/** Its slot for a given weekday. 0 = Sunday … 6 = Saturday, as everywhere else. */
export function justWodsSlotId(dayOfWeek: number): string {
  return `plan_slot_just_wods_${dayOfWeek}`;
}

/**
 * The plan row.
 *
 * `flexible`, so the athlete's own `trainingDays` decide which days they
 * train — the program has no opinion, which is what makes it Just WODs. The
 * bounds are 1 and 7 for the same reason `trainingDaysSchema` uses them: at
 * least one day, because an athlete who trains on no days has no app, and at
 * most the week.
 *
 * Open-ended: all three week fields are null. Just WODs never finishes, so
 * there is no length to choose and no last day to complete on — which is
 * exactly the case `resolveSlotForDate` cycles rather than running out of
 * (DN-11).
 *
 * `ownerId` is null: this is global library content, like the seeded WODs.
 */
export const JUST_WODS_PLAN = {
  id: JUST_WODS_PLAN_ID,
  name: 'Just WODs',
  summary: 'A workout a day, chosen for you from the whole library.',
  // Null on purpose. A goal is what *finishing* gets you, and this is a way
  // of training rather than a target -- there is nothing to finish.
  goal: null,
  // Null for the same reason `goal` is. The week here belongs entirely to the
  // athlete -- seven identical days, any of which they may train -- so there
  // is no layout to explain and a note would be the app taking credit for a
  // shape it did not choose.
  scheduleNote: null,
  scheduleMode: 'flexible',
  minDaysPerWeek: 1,
  maxDaysPerWeek: 7,
  defaultDays: [...DEFAULT_TRAINING_DAYS],
  minWeeks: null,
  maxWeeks: null,
  defaultWeeks: null,
  ownerId: null,
};

/**
 * One authored week, played over and over.
 *
 * `core` rather than `intro` or `peak` because those are the phases that play
 * once: a program made only of them would stop. The core block is the part
 * `expandPlanWeeks` cycles, and a block of one week cycled forever is
 * precisely what Just WODs is.
 */
export const JUST_WODS_WEEK = {
  id: JUST_WODS_WEEK_ID,
  planId: JUST_WODS_PLAN_ID,
  order: 0,
  phase: 'core',
  // No label. "Week 1" is all there is to say about a week that is every week.
  label: null,
};

/**
 * A generated slot on every weekday, with nothing constrained.
 *
 * All seven, not the five of the default training days: the plan is flexible,
 * so *which* days are trained is the athlete's `trainingDays` and not the
 * program's business. Authoring only Mon–Fri would hand an athlete who trains
 * on Saturday a day the program says nothing about, which is a worse answer
 * than the one they asked for.
 *
 * Every constraint is null and `allowNamed` is true, which together are the
 * absence of a constraint rather than a lenient one. That is the point: this
 * slot must resolve to exactly what `pickWod` does today, and today it picks
 * across the whole visible library, benchmarks included. `allowNamed` is the
 * one that had to be said out loud, because the column defaults to false —
 * a sensible default for a program written around a progression, and the
 * wrong one for the program that is the absence of programming.
 *
 * `priority` is 0 on all seven. It decides which days survive when a flexible
 * program runs at fewer days than it was authored for, and with every day
 * identical there is nothing to rank.
 */
export const JUST_WODS_SLOTS = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
  id: justWodsSlotId(dayOfWeek),
  planWeekId: JUST_WODS_WEEK_ID,
  dayOfWeek,
  kind: 'wod_generated',
  priority: 0,
  wodId: null,
  pattern: null,
  wodType: null,
  allowNamed: true,
  maxTimeCapMinutes: null,
}));

/**
 * Writes the program, updating a row that has drifted from the definition
 * above.
 *
 * The other half of the pair `UserProvisioningService` holds: that one
 * creates these rows when they are missing and never touches them again,
 * which is what a service on the request path should do. This one *updates*,
 * so an edit to the definition reaches a deploy whose rows already exist --
 * an athlete enrolled last month must not be left on last month's program.
 *
 * Takes its client as an argument so the deploy seed and a test can run the
 * same code. The seed is otherwise a script with a module-level client and no
 * exports, which is why the update path had no test before.
 */
export async function upsertJustWods(
  // The real client type rather than a hand-written shape, so a field renamed
  // on the model is a compile error here instead of a silent no-op update.
  prisma: Pick<PrismaClient, 'plan' | 'planWeek' | 'planSlot'>,
): Promise<void> {
  const { id: planId, ...planFields } = JUST_WODS_PLAN;
  await prisma.plan.upsert({
    where: { id: planId },
    update: planFields,
    create: JUST_WODS_PLAN,
  });

  const { id: weekId, ...weekFields } = JUST_WODS_WEEK;
  await prisma.planWeek.upsert({
    where: { id: weekId },
    update: weekFields,
    create: JUST_WODS_WEEK,
  });

  for (const slot of JUST_WODS_SLOTS) {
    const { id: slotId, ...slotFields } = slot;
    await prisma.planSlot.upsert({
      where: { id: slotId },
      update: slotFields,
      create: slot,
    });
  }
}
