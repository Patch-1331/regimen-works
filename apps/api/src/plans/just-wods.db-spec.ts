import { testPrisma } from '../test-support/database';
import {
  JUST_WODS_PLAN_ID,
  JUST_WODS_WEEK_ID,
  justWodsSlotId,
  upsertJustWods,
} from './just-wods';

/**
 * The deploy seed's half of DN-13.
 *
 * `UserProvisioningService` creates these rows when they are missing and then
 * leaves them alone forever, which is right for something on the request
 * path. That makes this the only writer that can correct a row already in the
 * database, so it is the only place an edit to the definition can reach an
 * existing deploy -- and the only one where "it converges" is a claim worth
 * testing rather than a restatement of ON CONFLICT DO NOTHING.
 */
describe('upsertJustWods', () => {
  it('creates the whole program from an empty database', async () => {
    await upsertJustWods(testPrisma());

    expect(
      await testPrisma().plan.findUnique({ where: { id: JUST_WODS_PLAN_ID } }),
    ).toMatchObject({ name: 'Just WODs', scheduleMode: 'flexible' });
    expect(
      await testPrisma().planSlot.count({
        where: { planWeekId: JUST_WODS_WEEK_ID },
      }),
    ).toBe(7);
  });

  it('converges when the deploy runs it again', async () => {
    await upsertJustWods(testPrisma());

    await upsertJustWods(testPrisma());

    expect(await testPrisma().plan.count()).toBe(1);
    expect(await testPrisma().planWeek.count()).toBe(1);
    expect(await testPrisma().planSlot.count()).toBe(7);
  });

  it('corrects a row that has drifted from the definition', async () => {
    // The whole reason this writer upserts rather than skipping duplicates.
    // An athlete enrolled last month must not be left on last month's
    // program: provisioning would see the rows present and change nothing.
    await upsertJustWods(testPrisma());
    await testPrisma().plan.update({
      where: { id: JUST_WODS_PLAN_ID },
      // Drifted to a *legal* row, all three fields together: the
      // Plan_schedule_mode_bounds CHECK refuses a fixed plan that still
      // carries day bounds, so a half-drift cannot be written in the first
      // place and would be testing the constraint rather than the upsert.
      data: {
        name: 'Stale name',
        scheduleMode: 'fixed',
        minDaysPerWeek: null,
        maxDaysPerWeek: null,
      },
    });
    await testPrisma().planWeek.update({
      where: { id: JUST_WODS_WEEK_ID },
      data: { phase: 'intro', label: 'Stale label' },
    });
    await testPrisma().planSlot.update({
      where: { id: justWodsSlotId(6) },
      data: { allowNamed: false, kind: 'rest' },
    });

    await upsertJustWods(testPrisma());

    expect(
      await testPrisma().plan.findUnique({ where: { id: JUST_WODS_PLAN_ID } }),
    ).toMatchObject({
      name: 'Just WODs',
      scheduleMode: 'flexible',
      minDaysPerWeek: 1,
    });
    expect(
      await testPrisma().planWeek.findUnique({
        where: { id: JUST_WODS_WEEK_ID },
      }),
    ).toMatchObject({ phase: 'core', label: null });
    expect(
      await testPrisma().planSlot.findUnique({
        where: { id: justWodsSlotId(6) },
      }),
    ).toMatchObject({ allowNamed: true, kind: 'wod_generated' });
  });

  it('leaves the rows provisioning already created alone, rather than duplicating them', async () => {
    // The two writers share ids on purpose. Whichever reaches the database
    // first wins the create; this proves the second one is an update of that
    // same row and not a second program.
    await testPrisma().plan.create({
      data: {
        id: JUST_WODS_PLAN_ID,
        name: 'Just WODs',
        summary: 'Whatever provisioning wrote first.',
        scheduleMode: 'fixed',
      },
    });

    await upsertJustWods(testPrisma());

    expect(await testPrisma().plan.count()).toBe(1);
    expect(
      await testPrisma().plan.findUnique({ where: { id: JUST_WODS_PLAN_ID } }),
    ).toMatchObject({ scheduleMode: 'flexible' });
  });
});
