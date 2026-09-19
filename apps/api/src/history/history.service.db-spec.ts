import type { SessionMovement } from '@regimen-works/shared';
import type { PrismaService } from '../prisma/prisma.service';
import { testPrisma } from '../test-support/database';
import {
  createAssignment,
  createSession,
  createUser,
  createWod,
} from '../test-support/fixtures';
import { HistoryService } from './history.service';

/**
 * Which days count as training, and what happens to the ones that cannot be
 * read (DN-89).
 *
 * `history.logic.spec.ts` pins the shape of the answer. This is the half that
 * needs a real database: the session snapshot is a jsonb column holding rows
 * written by older versions of this app, and the rule about what to do with
 * one that no longer parses is not testable against a mock that hands back
 * whatever the test put in.
 */

function service(): HistoryService {
  return new HistoryService(testPrisma() as unknown as PrismaService);
}

function snapshot(overrides: Partial<SessionMovement> = {}): SessionMovement {
  return {
    wodMovementId: 'wm-1',
    planSlotMovementId: null,
    sets: null,
    restSeconds: null,
    order: 0,
    reps: 30,
    repScheme: [],
    isSwapped: false,
    prescribedName: null,
    prescribedReason: null,
    exercise: {
      id: 'chin-up',
      name: 'Chin-up',
      unit: 'reps',
      line: 'pull',
      rung: 1,
    },
    ...overrides,
  };
}

/** A finished workout on a given date, snapshotted as `movements`. */
async function trainedDay(
  userId: string,
  date: string,
  options: { movements?: unknown; status?: string; wodName?: string } = {},
) {
  const wod = await createWod(options.wodName ? { name: options.wodName } : {});
  const assignment = await createAssignment(userId, {
    date,
    wodId: wod.id,
    status: 'completed',
  });
  return createSession(userId, assignment.id, {
    status: options.status ?? 'completed',
    movements: options.movements ?? [snapshot()],
  });
}

describe('HistoryService.movements', () => {
  it('reads the days the athlete actually trained', async () => {
    const user = await createUser();
    await trainedDay(user.id, '2026-09-10', { wodName: 'Cindy' });
    await trainedDay(user.id, '2026-09-14');

    const history = await service().movements(user.id);

    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      exerciseId: 'chin-up',
      sessions: 2,
      total: 60,
      firstTrained: '2026-09-10',
      lastTrained: '2026-09-14',
    });
    // Each day names the workout it came from, so the history reads as
    // training rather than as a column of numbers.
    expect(history[0].days.at(-1)!.wodName).toBe('Cindy');
  });

  it('leaves out a session that was never finished', async () => {
    // It records what was prescribed that day and nothing about how much of it
    // was done. Counting it would report training that may not have happened,
    // which is the one thing this screen must not do.
    const user = await createUser();
    await trainedDay(user.id, '2026-09-14', { status: 'in_progress' });
    await trainedDay(user.id, '2026-09-15', { status: 'abandoned' });

    expect(await service().movements(user.id)).toEqual([]);
  });

  it('reads one athlete history without reaching for another', async () => {
    const user = await createUser();
    const mallory = await createUser();
    await trainedDay(mallory.id, '2026-09-14');

    expect(await service().movements(user.id)).toEqual([]);
    expect(await service().movements(mallory.id)).toHaveLength(1);
  });

  it('says nothing about a session snapshotted before the column existed', async () => {
    // Empty reads as "not recorded", never as "trained no movements" — a WOD
    // always has movements, so there is no honest history to show for it.
    const user = await createUser();
    await trainedDay(user.id, '2026-09-14', { movements: [] });

    expect(await service().movements(user.id)).toEqual([]);
  });

  it('drops a snapshot it cannot read rather than failing the whole history', async () => {
    // The column is jsonb written by this app, but by older versions of it.
    // A history that throws tells the athlete nothing about the days that are
    // fine — the same quiet degrading every resolution layer does.
    const user = await createUser();
    await trainedDay(user.id, '2026-09-10', {
      movements: [{ wodMovementId: 'wm-1', order: 0 }],
    });
    await trainedDay(user.id, '2026-09-14');

    const history = await service().movements(user.id);

    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      sessions: 1,
      lastTrained: '2026-09-14',
    });
  });

  it('carries what the equipment layer replaced, and what the athlete swapped', async () => {
    const user = await createUser();
    await trainedDay(user.id, '2026-09-14', {
      movements: [
        snapshot({
          exercise: {
            id: 'row',
            name: 'Row under table',
            unit: 'reps',
            line: null,
            rung: null,
          },
          prescribedName: 'Pull-up',
          prescribedReason: 'equipment',
        }),
        snapshot({ wodMovementId: 'wm-2', isSwapped: true }),
      ],
    });

    const byId = new Map(
      (await service().movements(user.id)).map((h) => [h.exerciseId, h]),
    );
    expect(byId.get('row')!.days[0]).toMatchObject({
      prescribedName: 'Pull-up',
      prescribedReason: 'equipment',
    });
    expect(byId.get('chin-up')!.days[0]).toMatchObject({
      isSwapped: true,
      prescribedName: null,
    });
  });
});
