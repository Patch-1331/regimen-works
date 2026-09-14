import { testPrisma } from '../test-support/database';
import { createUser } from '../test-support/fixtures';
import { SettingsService } from './settings.service';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * The two toggles the app exposes, and the upsert behind them.
 *
 * Small enough to look obvious, which is the reason to test it against a real
 * database rather than a mocked client: every interesting case here is about
 * what Postgres does with a partial write — which column defaults fill in,
 * what an omitted field is left as, and whether the row that comes back is
 * the row that was stored or an echo of the patch.
 */

function service(): SettingsService {
  return new SettingsService(testPrisma() as unknown as PrismaService);
}

function storedRule(userId: string) {
  return testPrisma().scheduleRule.findUnique({ where: { userId } });
}

describe('SettingsService.get', () => {
  it('answers with the defaults for an athlete who has no rule row yet', async () => {
    const user = await createUser();

    expect(await service().get(user.id)).toEqual({
      warmupCooldownEnabled: false,
      autoStopAtCapEnabled: true,
    });
  });

  it('reads back what is stored', async () => {
    const user = await createUser();
    await testPrisma().scheduleRule.create({
      data: {
        userId: user.id,
        warmupCooldownEnabled: true,
        autoStopAtCapEnabled: false,
      },
    });

    expect(await service().get(user.id)).toEqual({
      warmupCooldownEnabled: true,
      autoStopAtCapEnabled: false,
    });
  });

  it('does not report another athlete settings as this one defaults', async () => {
    const user = await createUser();
    const other = await createUser();
    await testPrisma().scheduleRule.create({
      data: {
        userId: other.id,
        warmupCooldownEnabled: true,
        autoStopAtCapEnabled: false,
      },
    });

    expect(await service().get(user.id)).toEqual({
      warmupCooldownEnabled: false,
      autoStopAtCapEnabled: true,
    });
  });

  it('reports the same values a freshly created row would hold', async () => {
    // DEFAULTS in the service mirrors the column defaults in schema.prisma.
    // Nothing links the two, so this is what catches them drifting apart:
    // a user with no row and a user with an empty row must read alike.
    const withoutRow = await createUser();
    const withRow = await createUser();
    await testPrisma().scheduleRule.create({ data: { userId: withRow.id } });

    expect(await service().get(withoutRow.id)).toEqual(
      await service().get(withRow.id),
    );
  });

  it('does not create a row just by being read', async () => {
    const user = await createUser();

    await service().get(user.id);

    expect(await storedRule(user.id)).toBeNull();
  });
});

describe('SettingsService.update', () => {
  it('creates the rule row for an athlete who has none', async () => {
    // Provisioning makes one on first sign-in, but a toggle must not 404 on a
    // user whose row is somehow absent.
    const user = await createUser();

    const settings = await service().update(user.id, {
      warmupCooldownEnabled: true,
    });

    expect(settings.warmupCooldownEnabled).toBe(true);
    expect(await storedRule(user.id)).not.toBeNull();
  });

  it('lands the fields it was not given on their column defaults', async () => {
    const user = await createUser();

    const settings = await service().update(user.id, {
      warmupCooldownEnabled: true,
    });

    expect(settings.autoStopAtCapEnabled).toBe(true);
  });

  it('applies one toggle without writing the other back', async () => {
    // A stale tab echoing what it last read must not flip the other switch.
    const user = await createUser();
    await service().update(user.id, {
      warmupCooldownEnabled: true,
      autoStopAtCapEnabled: false,
    });

    const settings = await service().update(user.id, {
      warmupCooldownEnabled: false,
    });

    expect(settings).toEqual({
      warmupCooldownEnabled: false,
      autoStopAtCapEnabled: false,
    });
  });

  it('returns the stored row rather than echoing the patch', async () => {
    // With a partial body the row is the only answer that includes the
    // toggles left alone.
    const user = await createUser();
    await service().update(user.id, { autoStopAtCapEnabled: false });

    const settings = await service().update(user.id, {
      warmupCooldownEnabled: true,
    });

    expect(settings).toEqual({
      warmupCooldownEnabled: true,
      autoStopAtCapEnabled: false,
    });
  });

  it('treats an empty patch as a read', async () => {
    const user = await createUser();
    await service().update(user.id, { warmupCooldownEnabled: true });

    expect(await service().update(user.id, {})).toEqual({
      warmupCooldownEnabled: true,
      autoStopAtCapEnabled: true,
    });
  });

  it('creates a row on an empty patch rather than failing', async () => {
    const user = await createUser();

    expect(await service().update(user.id, {})).toEqual({
      warmupCooldownEnabled: false,
      autoStopAtCapEnabled: true,
    });
    expect(await storedRule(user.id)).not.toBeNull();
  });

  it('corrects the row rather than adding a second', async () => {
    const user = await createUser();

    await service().update(user.id, { warmupCooldownEnabled: true });
    await service().update(user.id, { warmupCooldownEnabled: false });

    expect(await testPrisma().scheduleRule.count()).toBe(1);
  });

  it('leaves the scheduling fields alone, which this endpoint does not expose', async () => {
    // ScheduleRule also carries maxDaysPerWeek and patternCooldownDays; the
    // settings patch must not reset them on its way past.
    const user = await createUser();
    await testPrisma().scheduleRule.create({
      data: { userId: user.id, maxDaysPerWeek: 3, patternCooldownDays: 7 },
    });

    await service().update(user.id, { warmupCooldownEnabled: true });

    const rule = await storedRule(user.id);
    expect(rule).toMatchObject({ maxDaysPerWeek: 3, patternCooldownDays: 7 });
  });

  it('writes only this athlete row', async () => {
    const user = await createUser();
    const other = await createUser();
    await service().update(other.id, {
      warmupCooldownEnabled: true,
      autoStopAtCapEnabled: false,
    });

    await service().update(user.id, { warmupCooldownEnabled: false });

    expect(await service().get(other.id)).toEqual({
      warmupCooldownEnabled: true,
      autoStopAtCapEnabled: false,
    });
  });

  it('is readable back through get', async () => {
    const user = await createUser();

    const written = await service().update(user.id, {
      autoStopAtCapEnabled: false,
    });

    expect(await service().get(user.id)).toEqual(written);
  });
});
