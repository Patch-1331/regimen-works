import { testPrisma, withSeparateConnections } from '../test-support/database';
import { createUser } from '../test-support/fixtures';
import { SettingsService } from './settings.service';
import type { PrismaClient } from '@prisma/client';
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

function service(client: PrismaClient = testPrisma()): SettingsService {
  return new SettingsService(client as unknown as PrismaService);
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
      equipment: ['bar'],
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
      equipment: ['bar'],
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
      equipment: ['bar'],
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
      equipment: ['bar'],
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
      equipment: ['bar'],
    });
  });

  it('treats an empty patch as a read', async () => {
    const user = await createUser();
    await service().update(user.id, { warmupCooldownEnabled: true });

    expect(await service().update(user.id, {})).toEqual({
      warmupCooldownEnabled: true,
      autoStopAtCapEnabled: true,
      equipment: ['bar'],
    });
  });

  it('creates a row on an empty patch rather than failing', async () => {
    const user = await createUser();

    expect(await service().update(user.id, {})).toEqual({
      warmupCooldownEnabled: false,
      autoStopAtCapEnabled: true,
      equipment: ['bar'],
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
      equipment: ['bar'],
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

/**
 * Equipment ownership (DN-78), which is the first list-valued setting the app
 * has had -- so the cases worth having are the ones a boolean never raised:
 * what a replacement does to what was there, and whether owning nothing
 * survives the round trip or is read back as the default.
 */
describe('SettingsService equipment ownership', () => {
  it('starts a new athlete at the assumed baseline rather than at nothing', async () => {
    // DN-81: the only default that changes no existing athlete's workouts.
    // Defaulting to owning nothing would silently drop the whole pull ladder
    // to its substitutes for everyone who never opens the screen.
    const user = await createUser();

    expect((await service().get(user.id)).equipment).toEqual(['bar']);
  });

  it('gives a freshly created row the same baseline the defaults claim', async () => {
    // Same drift guard as the toggles above: nothing links DEFAULTS to the
    // column default, so a user with no row and a user with an empty one must
    // read alike.
    const withoutRow = await createUser();
    const withRow = await createUser();
    await testPrisma().scheduleRule.create({ data: { userId: withRow.id } });

    expect((await service().get(withoutRow.id)).equipment).toEqual(
      (await service().get(withRow.id)).equipment,
    );
  });

  it('replaces the whole set rather than adding to it', async () => {
    // There is no add or remove verb: the screen sends what the athlete owns.
    const user = await createUser();
    await service().update(user.id, { equipment: ['bar', 'jump_rope'] });

    const settings = await service().update(user.id, { equipment: ['box'] });

    expect(settings.equipment).toEqual(['box']);
  });

  it('stores owning nothing as owning nothing, not as the default', async () => {
    // An athlete with no equipment at all is a real answer, and the empty
    // array is how they say it -- reading it back as ['bar'] would hand them
    // bar movements they cannot do.
    const user = await createUser();

    const settings = await service().update(user.id, { equipment: [] });

    expect(settings.equipment).toEqual([]);
    expect((await service().get(user.id)).equipment).toEqual([]);
  });

  it('leaves the set alone when a patch does not mention it', async () => {
    const user = await createUser();
    await service().update(user.id, { equipment: ['dumbbell', 'kettlebell'] });

    const settings = await service().update(user.id, {
      warmupCooldownEnabled: true,
    });

    expect(settings.equipment).toEqual(['dumbbell', 'kettlebell']);
  });

  it('keeps the order the athlete sent, since the column is a list', async () => {
    const user = await createUser();

    const settings = await service().update(user.id, {
      equipment: ['kettlebell', 'bar'],
    });

    expect(settings.equipment).toEqual(['kettlebell', 'bar']);
  });

  it('does not report one athlete equipment as another', async () => {
    const user = await createUser();
    const other = await createUser();
    await service().update(other.id, { equipment: ['box', 'dumbbell'] });

    expect((await service().get(user.id)).equipment).toEqual(['bar']);
  });

  it('drops a stored piece the catalog no longer has', async () => {
    // Writes are validated at the controller, so the way this happens is a
    // piece leaving the catalog after an athlete ticked it. "You no longer
    // own it" beats a 500 on the settings screen.
    const user = await createUser();
    await testPrisma().scheduleRule.create({
      data: { userId: user.id, equipment: ['bar', 'sandbag'] },
    });

    expect((await service().get(user.id)).equipment).toEqual(['bar']);
  });
});

describe('SettingsService.update under concurrency', () => {
  it('settles rather than 500ing when two toggles arrive at once', async () => {
    // An athlete with no rule row yet, so every call takes the create leg.
    // This one is safe and was never broken: Prisma compiles it to
    // INSERT ... ON CONFLICT DO UPDATE, unlike the session start that lost
    // that compilation to an empty update leg (DN-105). The test pins it
    // there -- a change that costs this upsert its ON CONFLICT fails here
    // rather than in production. Separate connections because calls on the
    // shared client serialise and would prove nothing.
    const user = await createUser();

    const outcomes = await withSeparateConnections(4, (clients) =>
      Promise.allSettled(
        clients.map((client) =>
          service(client).update(user.id, { warmupCooldownEnabled: true }),
        ),
      ),
    );

    const rejected = outcomes.filter((o) => o.status === 'rejected');
    expect(rejected.map((o) => String(o.reason))).toEqual([]);
    expect(await testPrisma().scheduleRule.count()).toBe(1);
    expect((await storedRule(user.id))?.warmupCooldownEnabled).toBe(true);
  });
});
