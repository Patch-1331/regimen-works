import type { PrismaService } from '../prisma/prisma.service';
import { testPrisma } from '../test-support/database';
import {
  createChecklistEntry,
  createExercise,
  createUser,
  createWod,
} from '../test-support/fixtures';
import { WodsService } from './wods.service';

/**
 * The WOD library and the warm-up/cool-down checklists (DN-99, DN-107).
 *
 * Both methods here are almost entirely query. The selection rules the
 * checklists follow are pure and live in `checklist.logic.spec.ts`; what is
 * tested here is the half that file cannot see — which rows the query hands
 * it, which columns come with them, and what order anything arrives in.
 */

function service(): WodsService {
  return new WodsService(testPrisma() as unknown as PrismaService);
}

/**
 * An exercise on one checklist: the pool `getChecklists` draws from. The
 * entry serves the exercise's own pattern unless `entry` says otherwise.
 */
async function createOnChecklist(
  kind: 'warmup' | 'cooldown',
  exercise: Record<string, unknown> = {},
  entry: Record<string, unknown> = {},
) {
  const row = await createExercise(exercise);
  await createChecklistEntry(row.id, kind, { pattern: row.pattern, ...entry });
  return row;
}

/**
 * An athlete who owns no library content of their own, which is every athlete
 * until DN-25/DN-26 ship the write endpoints. Every row these tests create is
 * global, so the reads below see exactly what they saw before ownership
 * existed — the scoping's own behaviour is proved separately, at the bottom
 * of the file.
 */
const ANY_ATHLETE = 'athlete-reading-the-library';

describe('WodsService.findAll', () => {
  it('lists the library alphabetically', async () => {
    await createWod({ name: 'Fran' });
    await createWod({ name: 'Angie' });
    await createWod({ name: 'Cindy' });

    expect(
      (await service().findAll(ANY_ATHLETE)).map((wod) => wod.name),
    ).toEqual(['Angie', 'Cindy', 'Fran']);
  });

  it("puts each WOD's movements in the order they are performed", async () => {
    // Created back to front, so a result that happens to be in insertion
    // order is not mistaken for one that is ordered.
    const [first, second, third] = [
      await createExercise({ name: 'Thruster' }),
      await createExercise({ name: 'Pull-up' }),
      await createExercise({ name: 'Box jump' }),
    ];
    await createWod({
      name: 'Fran',
      movements: [
        { exerciseId: third.id, reps: 10, order: 2 },
        { exerciseId: first.id, reps: 21, order: 0 },
        { exerciseId: second.id, reps: 21, order: 1 },
      ],
    });

    const [wod] = await service().findAll(ANY_ATHLETE);

    expect(wod.movements.map((m) => m.order)).toEqual([0, 1, 2]);
    expect(wod.movements.map((m) => m.exercise.name)).toEqual([
      'Thruster',
      'Pull-up',
      'Box jump',
    ]);
  });

  it('carries the exercise on each movement, not just its id', async () => {
    // The screens render the movement's name; without the include they would
    // have only a foreign key and no way to spend another query on it.
    const exercise = await createExercise({ name: 'Wall ball' });
    await createWod({
      movements: [{ exerciseId: exercise.id, reps: 20, order: 0 }],
    });

    const [wod] = await service().findAll(ANY_ATHLETE);

    expect(wod.movements[0].exercise).toMatchObject({
      id: exercise.id,
      name: 'Wall ball',
    });
  });

  it('is empty before anything is seeded', async () => {
    expect(await service().findAll(ANY_ATHLETE)).toEqual([]);
  });
});

describe('WodsService.getChecklists', () => {
  it('splits the entries by checklist', async () => {
    await createOnChecklist('warmup', { name: 'Arm circles' });
    await createOnChecklist('cooldown', { name: 'Couch stretch' });

    const { warmup, cooldown } = await service().getChecklists(
      ANY_ATHLETE,
      'push',
    );

    expect(warmup.map((e) => e.name)).toEqual(['Arm circles']);
    expect(cooldown.map((e) => e.name)).toEqual(['Couch stretch']);
  });

  it('never offers an exercise no entry points at', async () => {
    // Every movement in the library is such a row, so this is the property
    // that keeps thrusters out of the warm-up.
    await createExercise({ name: 'Thruster' });
    await createOnChecklist('warmup', { name: 'Arm circles' });

    const { warmup, cooldown } = await service().getChecklists(
      ANY_ATHLETE,
      'push',
    );

    expect([...warmup, ...cooldown].map((e) => e.name)).toEqual([
      'Arm circles',
    ]);
  });

  it("brings the exercise's instructions along when the entry has none", async () => {
    // The one thing the checklist screens render beyond the name -- an
    // omission here reads as a checklist of bare titles.
    const stored = await createOnChecklist('warmup', {
      name: 'Arm circles',
      instructions: ['Ten each way, slowly.'],
    });

    const [move] = (await service().getChecklists(ANY_ATHLETE, 'push')).warmup;

    expect(move).toEqual({
      id: stored.id,
      name: 'Arm circles',
      pattern: 'push',
      kind: 'warmup',
      instructions: ['Ten each way, slowly.'],
    });
  });

  it("shows the entry's own instructions over the exercise's", async () => {
    // The warm-up squat is not the working-set squat: same movement, asked
    // for differently, and the workout keeps its own copy.
    const squat = await createExercise({
      name: 'Air squat',
      pattern: 'squat',
      instructions: ['Hip crease below the knee, then stand all the way up.'],
    });
    await createChecklistEntry(squat.id, 'warmup', {
      pattern: 'squat',
      instructions: ['Easy reps, a little deeper each time.'],
    });

    const [move] = (await service().getChecklists(ANY_ATHLETE, 'squat')).warmup;

    expect(move.id).toBe(squat.id);
    expect(move.instructions).toEqual([
      'Easy reps, a little deeper each time.',
    ]);
  });

  it('puts one exercise on a checklist and in a workout at once', async () => {
    // What `Exercise.phase` could not say, and why it went (DN-172).
    const squat = await createExercise({ name: 'Air squat', pattern: 'squat' });
    await createChecklistEntry(squat.id, 'warmup', { pattern: 'squat' });
    await createWod({
      name: 'Squat day',
      movements: [{ exerciseId: squat.id, reps: 50, order: 0 }],
    });

    const [wod] = await service().findAll(ANY_ATHLETE);
    const { warmup } = await service().getChecklists(ANY_ATHLETE, 'squat');

    expect(wod.movements[0].exercise.id).toBe(squat.id);
    expect(warmup.map((e) => e.id)).toEqual([squat.id]);
  });

  it("matches the day on the entry's pattern, not the exercise's", async () => {
    // Inchworms are filed as core but warm up a pull day just as well; the
    // entry is what says which day it is chosen for.
    await createOnChecklist(
      'warmup',
      { name: 'Inchworms', pattern: 'core' },
      { pattern: 'pull' },
    );

    const { warmup } = await service().getChecklists(ANY_ATHLETE, 'pull');

    expect(warmup.map((e) => e.name)).toEqual(['Inchworms']);
  });

  it("offers the moves that match the day's pattern before the generic ones", async () => {
    await createOnChecklist('warmup', { name: 'Generic', pattern: null });
    await createOnChecklist('warmup', {
      name: 'Pull specific',
      pattern: 'pull',
    });

    const { warmup } = await service().getChecklists(ANY_ATHLETE, 'pull');

    expect(warmup.map((e) => e.name)).toEqual(['Pull specific', 'Generic']);
  });

  it('keeps the order the entries were written in', async () => {
    // The query is ordered, so the list reads the same on every load rather
    // than in whatever order the table happens to return.
    for (const name of ['Jog', 'Skip', 'Shuffle']) {
      await createOnChecklist('warmup', { name, pattern: null });
    }

    const { warmup } = await service().getChecklists(ANY_ATHLETE, 'push');

    expect(warmup.map((e) => e.name)).toEqual(['Jog', 'Skip', 'Shuffle']);
  });

  it('drops a retired exercise without anyone editing the list', async () => {
    await createOnChecklist('warmup', {
      name: 'Retired',
      archivedAt: new Date(),
    });

    expect((await service().getChecklists(ANY_ATHLETE, 'push')).warmup).toEqual(
      [],
    );
  });

  it("shows an athlete their own entries and nobody else's", async () => {
    const alice = await createUser();
    const bob = await createUser();
    await createOnChecklist(
      'warmup',
      { name: 'Band pull-aparts', ownerId: alice.id },
      { ownerId: alice.id },
    );

    const forAlice = await service().getChecklists(alice.id, 'push');
    const forBob = await service().getChecklists(bob.id, 'push');

    expect(forAlice.warmup.map((e) => e.name)).toEqual(['Band pull-aparts']);
    expect(forBob.warmup).toEqual([]);
  });

  it('never resolves a global entry to an exercise the athlete cannot see', async () => {
    // Belt and braces: nothing writes such an entry today, but the read is
    // scoped on both rows so that a bad one cannot hand out someone's own
    // movement.
    const alice = await createUser();
    const bob = await createUser();
    const hers = await createExercise({
      name: 'Her move',
      ownerId: alice.id,
    });
    await createChecklistEntry(hers.id, 'warmup');

    expect((await service().getChecklists(bob.id, 'push')).warmup).toEqual([]);
  });

  it("puts an athlete's own entries before the global ones (DN-173)", async () => {
    // The checklist stops at four. Read in creation order, an athlete's
    // entries -- always written after the seed's -- would be the first cut.
    const alice = await createUser();
    for (const name of ['Global 1', 'Global 2', 'Global 3', 'Global 4']) {
      await createOnChecklist('warmup', { name, pattern: 'push' });
    }
    await createOnChecklist(
      'warmup',
      { name: 'Mine', pattern: 'push' },
      { ownerId: alice.id },
    );

    const { warmup } = await service().getChecklists(alice.id, 'push');

    expect(warmup.map((e) => e.name)).toEqual([
      'Mine',
      'Global 1',
      'Global 2',
      'Global 3',
    ]);
  });

  it("keeps an athlete's own entries in the order they set", async () => {
    const alice = await createUser();
    await createOnChecklist(
      'warmup',
      { name: 'Set second' },
      { ownerId: alice.id, sortOrder: 1 },
    );
    await createOnChecklist(
      'warmup',
      { name: 'Set first' },
      { ownerId: alice.id, sortOrder: 0 },
    );

    const { warmup } = await service().getChecklists(alice.id, 'push');

    expect(warmup.map((e) => e.name)).toEqual(['Set first', 'Set second']);
  });

  it('still prefers the day’s pattern over filler, whoever wrote it', async () => {
    const alice = await createUser();
    await createOnChecklist('warmup', { name: 'Global push', pattern: 'push' });
    await createOnChecklist(
      'warmup',
      { name: 'My filler' },
      { ownerId: alice.id, pattern: null },
    );

    const { warmup } = await service().getChecklists(alice.id, 'push');

    expect(warmup.map((e) => e.name)).toEqual(['Global push', 'My filler']);
  });

  it('shows a movement on both tiers once, as the athlete wrote it', async () => {
    // The screens key their rows by exercise id, so twice would collide.
    const alice = await createUser();
    const squat = await createExercise({ name: 'Air squat', pattern: 'squat' });
    await createChecklistEntry(squat.id, 'warmup', {
      pattern: 'squat',
      instructions: ['The seed’s warm-up copy.'],
    });
    await createChecklistEntry(squat.id, 'warmup', {
      pattern: null,
      ownerId: alice.id,
    });

    const { warmup } = await service().getChecklists(alice.id, 'squat');

    expect(warmup).toEqual([
      expect.objectContaining({ id: squat.id, pattern: null }),
    ]);
  });

  it('answers with empty lists when nothing is on either checklist', async () => {
    expect(await service().getChecklists(ANY_ATHLETE, 'push')).toEqual({
      warmup: [],
      cooldown: [],
    });
  });
});
