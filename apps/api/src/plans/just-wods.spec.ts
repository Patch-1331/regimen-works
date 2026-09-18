import { planDetailSchema } from '@regimen-works/shared';
import {
  JUST_WODS_PLAN,
  JUST_WODS_SLOTS,
  JUST_WODS_WEEK,
  justWodsSlotId,
} from './just-wods';

/**
 * The seed data, checked against the contract the API serves it under
 * (DN-10). Seed data is written by hand and read by a deploy, so the first
 * thing that would notice a mistake is production — unless something here
 * notices first.
 */
describe('the Just WODs program definition', () => {
  const asDetail = () => ({
    ...JUST_WODS_PLAN,
    weeks: [{ ...JUST_WODS_WEEK, slots: JUST_WODS_SLOTS }],
  });

  it('satisfies planDetailSchema, and so both database CHECKs', () => {
    // The refinements mirror the constraints, so parsing here is the cheap
    // half of the same proof the db spec makes expensively.
    const result = planDetailSchema.safeParse(asDetail());
    expect(result.error?.issues ?? []).toEqual([]);
    expect(result.success).toBe(true);
  });

  it('is flexible, so the athlete’s own training days decide which days they train', () => {
    expect(JUST_WODS_PLAN.scheduleMode).toBe('flexible');
    expect(JUST_WODS_PLAN.minDaysPerWeek).toBe(1);
    expect(JUST_WODS_PLAN.maxDaysPerWeek).toBe(7);
  });

  it('is open-ended, with no length to choose and no last day', () => {
    // All three, not one: a half-open-ended program cannot bound a picker.
    expect(JUST_WODS_PLAN.minWeeks).toBeNull();
    expect(JUST_WODS_PLAN.maxWeeks).toBeNull();
    expect(JUST_WODS_PLAN.defaultWeeks).toBeNull();
  });

  it('is global library content, owned by nobody', () => {
    expect(JUST_WODS_PLAN.ownerId).toBeNull();
  });

  it('is one core week, which is the phase that repeats', () => {
    // intro and peak play once, so a program made of them would stop.
    expect(JUST_WODS_WEEK.phase).toBe('core');
    expect(JUST_WODS_WEEK.order).toBe(0);
  });

  it('authors all seven weekdays, not just the default five', () => {
    // The plan is flexible, so which days are trained is the athlete's
    // trainingDays. Authoring Mon-Fri would hand someone who trains on
    // Saturday a day the program says nothing about.
    expect(JUST_WODS_SLOTS.map((s) => s.dayOfWeek)).toEqual([
      0, 1, 2, 3, 4, 5, 6,
    ]);
  });

  it('generates every day, pinning and prescribing nothing', () => {
    expect(JUST_WODS_SLOTS.every((s) => s.kind === 'wod_generated')).toBe(true);
    expect(JUST_WODS_SLOTS.every((s) => s.wodId === null)).toBe(true);
  });

  it('constrains nothing, which is what makes it the same pick as today', () => {
    // A null skips its axis. Every axis skipped is `pickWod` over the whole
    // visible library, which is exactly what the app does now.
    for (const slot of JUST_WODS_SLOTS) {
      expect(slot.pattern).toBeNull();
      expect(slot.wodType).toBeNull();
      expect(slot.maxTimeCapMinutes).toBeNull();
    }
  });

  it('allows named WODs, against the column default', () => {
    // The one constraint that had to be said out loud. `allowNamed` defaults
    // to false, which is right for a program built around a progression and
    // wrong for the program that is the absence of programming -- today's
    // scheduler picks across the whole library, benchmarks included, and
    // this slot has to keep doing that.
    expect(JUST_WODS_SLOTS.every((s) => s.allowNamed)).toBe(true);
  });

  it('ranks no day above another', () => {
    // priority decides which days survive when a flexible program runs at
    // fewer days than authored. Every day here is identical.
    expect(JUST_WODS_SLOTS.every((s) => s.priority === 0)).toBe(true);
  });

  it('gives every row a fixed id, which is what makes two writers safe', () => {
    expect(JUST_WODS_SLOTS.map((s) => s.id)).toEqual(
      [0, 1, 2, 3, 4, 5, 6].map(justWodsSlotId),
    );
    expect(new Set(JUST_WODS_SLOTS.map((s) => s.id)).size).toBe(7);
    expect(
      JUST_WODS_SLOTS.every((s) => s.planWeekId === JUST_WODS_WEEK.id),
    ).toBe(true);
    expect(JUST_WODS_WEEK.planId).toBe(JUST_WODS_PLAN.id);
  });
});
