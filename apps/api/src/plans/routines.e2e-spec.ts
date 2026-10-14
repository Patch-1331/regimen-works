import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  createRoutineSchema,
  DEFAULT_PLAN_ID,
  editableRoutineSchema,
  globalRoutineSummarySchema,
  ROUTINE_EXPORT_FORMAT,
  routineArchiveResultSchema,
  routineSaveResultSchema,
  routineSummarySchema,
  setupOptionsSchema,
} from '@regimen-works/shared';
import { z } from 'zod';
import { asUser, createE2eApp } from '../test-support/e2e-app';
import { upsertJustWods } from './just-wods';
import { testPrisma } from '../test-support/database';

/**
 * Authoring a routine through HTTP (DN-145), end to end: write it, find it in
 * your list and the setup picker, start it -- and nobody else can do any of
 * that with it.
 *
 * The admin case is here rather than in the service spec because it is a
 * claim about the route: `POST /routines` is the personal tier whoever calls
 * it, the same way `POST /exercises` is.
 */
jest.mock('@clerk/backend', () => ({
  verifyToken: jest.fn((token: string) => {
    if (token.startsWith('admin_'))
      return Promise.resolve({ sub: token, isAdmin: true });
    if (token.startsWith('user_')) return Promise.resolve({ sub: token });
    return Promise.reject(new Error('invalid token'));
  }),
}));

let app: INestApplication<App>;

let seq = 0;
let ALICE: string;
let BOB: string;
let ADMIN: string;

beforeEach(async () => {
  seq += 1;
  ALICE = `user_alice_${seq}`;
  BOB = `user_bob_${seq}`;
  ADMIN = `admin_root_${seq}`;
  // The picker is never empty in a real database; Just WODs is always there.
  await upsertJustWods(testPrisma());
});

beforeAll(async () => {
  process.env.CLERK_SECRET_KEY = 'sk_test_not_a_real_key';
  app = await createE2eApp();
});

afterAll(async () => {
  await app.close();
});

function http() {
  return request(app.getHttpServer());
}

const routine = {
  name: 'Two-day pull',
  summary: null,
  scheduleMode: 'fixed',
  days: [1, 4].map((dayOfWeek) => ({
    dayOfWeek,
    lines: [
      {
        movementGroup: 'pull',
        exerciseId: null,
        sets: 4,
        reps: 6,
        repsMax: 10,
        toFailure: false,
        restSeconds: 120,
      },
    ],
  })),
};

async function author(user: string) {
  const res = await http()
    .post('/routines')
    .set(...asUser(user))
    .send(routine)
    .expect(201);
  return routineSummarySchema.parse(res.body);
}

async function listed(user: string) {
  const res = await http()
    .get('/routines')
    .set(...asUser(user))
    .expect(200);
  return z.array(routineSummarySchema).parse(res.body);
}

async function picker(user: string) {
  const res = await http()
    .get('/setup')
    .set(...asUser(user))
    .expect(200);
  return setupOptionsSchema.parse(res.body).programs.map((p) => p.id);
}

function start(user: string, planId: string) {
  return http()
    .post('/setup')
    .set(...asUser(user))
    .send({
      planId,
      trainingDays: null,
      weeks: 8,
      startDate: new Date().toISOString().slice(0, 10),
      defaultRestSeconds: null,
    });
}

it('lets an athlete build a routine, find it, and start it', async () => {
  const created = await author(ALICE);

  expect(await listed(ALICE)).toEqual([created]);
  expect(await picker(ALICE)).toContain(created.id);
  await start(ALICE, created.id).expect(201);
});

it('keeps it from a second athlete', async () => {
  const created = await author(ALICE);

  expect(await listed(BOB)).toEqual([]);
  expect(await picker(BOB)).not.toContain(created.id);
  await start(BOB, created.id).expect(404);
});

it('gives an admin a personal routine through this route, not a global one', async () => {
  const created = await author(ADMIN);

  expect(await listed(ADMIN)).toEqual([created]);
  expect(await picker(ALICE)).not.toContain(created.id);
});

it('refuses a half-written routine with the rule it broke', async () => {
  const res = await http()
    .post('/routines')
    .set(...asUser(ALICE))
    .send({ ...routine, days: [{ dayOfWeek: 1, lines: [] }] })
    .expect(400);

  expect(JSON.stringify(res.body)).toContain(
    'a training day needs at least one line',
  );
});

/**
 * Editing (DN-146). What only this layer shows is the hand-off a fork makes:
 * the picker offers the new version and stops offering the old, while the
 * athlete who started the old one keeps it.
 */
describe('editing a routine', () => {
  const heavier = {
    ...routine,
    days: routine.days.map((d) => ({
      ...d,
      lines: d.lines.map((l) => ({ ...l, sets: 5 })),
    })),
  };

  function save(user: string, id: string, body: object) {
    return http()
      .put(`/routines/${id}`)
      .set(...asUser(user))
      .send(body);
  }

  it('loads the routine as the body that wrote it', async () => {
    const created = await author(ALICE);

    const res = await http()
      .get(`/routines/${created.id}`)
      .set(...asUser(ALICE))
      .expect(200);

    expect(editableRoutineSchema.parse(res.body)).toEqual({
      id: created.id,
      routine,
      hasRuns: false,
      archived: false,
    });
  });

  it('edits in place before anyone starts it', async () => {
    const created = await author(ALICE);

    const res = await save(ALICE, created.id, heavier).expect(200);

    expect(routineSaveResultSchema.parse(res.body)).toMatchObject({
      forked: false,
      routine: { id: created.id },
    });
  });

  it('forks once it has been started, and the picker offers the new version', async () => {
    const created = await author(ALICE);
    await start(ALICE, created.id).expect(201);

    const saved = routineSaveResultSchema.parse(
      (await save(ALICE, created.id, heavier).expect(200)).body,
    );

    expect(saved.forked).toBe(true);
    const programs = await picker(ALICE);
    expect(programs).toContain(saved.routine.id);
    expect(programs).not.toContain(created.id);
    expect((await listed(ALICE)).map((r) => [r.id, r.archived])).toEqual([
      [saved.routine.id, false],
      [created.id, true],
    ]);
  });

  it('is a 404 to another athlete, to read or to save', async () => {
    const created = await author(ALICE);

    await http()
      .get(`/routines/${created.id}`)
      .set(...asUser(BOB))
      .expect(404);
    await save(BOB, created.id, heavier).expect(404);
  });

  it('refuses Just WODs', async () => {
    await save(ALICE, DEFAULT_PLAN_ID, routine).expect(403);
  });
});

describe('removing and restoring a routine', () => {
  function act(user: string, id: string, verb: 'archive' | 'unarchive') {
    return http()
      .post(`/routines/${id}/${verb}`)
      .set(...asUser(user));
  }

  it('takes it off the picker, says the run continues, and brings it back', async () => {
    const created = await author(ALICE);
    await start(ALICE, created.id).expect(201);

    const removed = routineArchiveResultSchema.parse(
      (await act(ALICE, created.id, 'archive').expect(201)).body,
    );
    expect(removed).toMatchObject({
      running: true,
      routine: { id: created.id, archived: true },
    });
    expect(await picker(ALICE)).not.toContain(created.id);

    const restored = routineSummarySchema.parse(
      (await act(ALICE, created.id, 'unarchive').expect(201)).body,
    );
    expect(restored.archived).toBe(false);
    expect(await picker(ALICE)).toContain(created.id);
  });

  it('refuses a restore into a name taken meanwhile', async () => {
    const created = await author(ALICE);
    await act(ALICE, created.id, 'archive').expect(201);
    await author(ALICE);

    await act(ALICE, created.id, 'unarchive').expect(409);
  });

  it('is a 404 to another athlete, and Just WODs cannot be removed', async () => {
    const created = await author(ALICE);

    await act(BOB, created.id, 'archive').expect(404);
    await act(BOB, created.id, 'unarchive').expect(404);
    await act(ALICE, DEFAULT_PLAN_ID, 'archive').expect(403);
  });
});

describe('the global library (DN-148)', () => {
  function admin(method: 'get' | 'post' | 'put', path: string, user: string) {
    return http()
      [method](`/admin/routines${path}`)
      .set(...asUser(user));
  }

  it('is closed to an athlete, on every admin route', async () => {
    const created = await author(ALICE);
    const routes: ['get' | 'post' | 'put', string][] = [
      ['get', ''],
      ['post', ''],
      ['get', `/${created.id}`],
      ['put', `/${created.id}`],
      ['post', `/${created.id}/archive`],
      ['post', `/${created.id}/unarchive`],
      ['post', `/${created.id}/promote`],
      ['post', '/export'],
    ];
    for (const [method, path] of routes) {
      await admin(method, path, ALICE).send(routine).expect(403);
    }
    expect(
      (await testPrisma().plan.findUniqueOrThrow({ where: { id: created.id } }))
        .ownerId,
    ).toBe(ALICE);
  });

  it('gives an athlete no way to write a global row through their own route', async () => {
    await http()
      .post('/routines')
      .set(...asUser(ALICE))
      .send({ ...routine, ownerId: null })
      .expect(400);
    await http()
      .post('/routines')
      .set(...asUser(ADMIN))
      .send({ ...routine, global: true })
      .expect(400);
    expect(
      await testPrisma().plan.count({ where: { name: routine.name } }),
    ).toBe(0);
  });

  it('publishes a routine an admin writes to every athlete', async () => {
    const res = await admin('post', '', ADMIN).send(routine).expect(201);
    const created = routineSummarySchema.parse(res.body);

    expect(await picker(BOB)).toContain(created.id);
    expect(await listed(ADMIN)).toEqual([]);
    const global = z
      .array(globalRoutineSummarySchema)
      .parse((await admin('get', '', ADMIN).expect(200)).body);
    expect(global.map((r) => [r.id, r.builtIn])).toEqual([
      [DEFAULT_PLAN_ID, true],
      [created.id, false],
    ]);
  });

  it("promotes the admin's own routine, and a second athlete is offered it", async () => {
    const created = await author(ADMIN);
    await start(ADMIN, created.id).expect(201);

    await admin('post', `/${created.id}/promote`, ADMIN).expect(201);

    expect(await picker(BOB)).toContain(created.id);
    expect(await picker(ADMIN)).toContain(created.id);
    expect(await listed(ADMIN)).toEqual([]);
  });

  it('manages a global routine: edit, archive, restore', async () => {
    const created = routineSummarySchema.parse(
      (await admin('post', '', ADMIN).send(routine).expect(201)).body,
    );

    const loaded = editableRoutineSchema.parse(
      (await admin('get', `/${created.id}`, ADMIN).expect(200)).body,
    );
    expect(loaded.routine).toEqual(routine);
    await admin('put', `/${created.id}`, ADMIN)
      .send({ ...routine, name: 'Two-day pull, heavy' })
      .expect(200);
    await admin('post', `/${created.id}/archive`, ADMIN).expect(201);
    expect(await picker(BOB)).not.toContain(created.id);
    await admin('post', `/${created.id}/unarchive`, ADMIN).expect(201);
    expect(await picker(BOB)).toContain(created.id);
  });

  it('refuses every change to Just WODs', async () => {
    await admin('get', `/${DEFAULT_PLAN_ID}`, ADMIN).expect(404);
    await admin('put', `/${DEFAULT_PLAN_ID}`, ADMIN).send(routine).expect(403);
    await admin('post', `/${DEFAULT_PLAN_ID}/archive`, ADMIN).expect(403);
    await admin('post', `/${DEFAULT_PLAN_ID}/promote`, ADMIN).expect(404);
  });
});

describe('copying a global routine (DN-149)', () => {
  function library(user: string, path = '') {
    return http()
      .get(`/routines/library${path}`)
      .set(...asUser(user));
  }

  async function publish() {
    const res = await http()
      .post('/admin/routines')
      .set(...asUser(ADMIN))
      .send(routine)
      .expect(201);
    return routineSummarySchema.parse(res.body);
  }

  it('lets an athlete copy a global routine into their own, and leaves it be', async () => {
    const source = await publish();

    const offered = z
      .array(routineSummarySchema)
      .parse((await library(ALICE).expect(200)).body);
    expect(offered.map((r) => r.id)).toEqual([source.id]);

    const prefill = createRoutineSchema.parse(
      (await library(ALICE, `/${source.id}`).expect(200)).body,
    );
    expect(prefill).toEqual(routine);

    const res = await http()
      .post('/routines')
      .set(...asUser(ALICE))
      .send({ ...prefill, name: `${prefill.name} (copy)` })
      .expect(201);
    const copy = routineSummarySchema.parse(res.body);

    expect(copy.id).not.toBe(source.id);
    expect(await listed(ALICE)).toEqual([copy]);
    const stored = await testPrisma().plan.findUniqueOrThrow({
      where: { id: source.id },
    });
    expect([stored.ownerId, stored.name]).toEqual([null, routine.name]);
  });

  it("never reads anyone's own routine, nor Just WODs", async () => {
    const bobs = await author(BOB);
    const alices = await author(ALICE);

    for (const id of [bobs.id, alices.id, DEFAULT_PLAN_ID]) {
      await library(ALICE, `/${id}`).expect(404);
    }
    expect((await library(ALICE).expect(200)).body).toEqual([]);
  });
});

describe('exporting global routines (DN-150)', () => {
  function exporting(user: string, ids: string[]) {
    return http()
      .post('/admin/routines/export')
      .set(...asUser(user))
      .send({ ids });
  }

  async function publish(name: string) {
    const res = await http()
      .post('/admin/routines')
      .set(...asUser(ADMIN))
      .send({ ...routine, name })
      .expect(201);
    return routineSummarySchema.parse(res.body);
  }

  it('gives an admin the ticked routines as create bodies in one file', async () => {
    const a = await publish('Alpha');
    const b = await publish('Beta');

    const res = await exporting(ADMIN, [b.id, a.id]).expect(200);

    expect(res.body).toEqual({
      format: ROUTINE_EXPORT_FORMAT,
      version: 1,
      routines: [
        { ...routine, name: 'Alpha' },
        { ...routine, name: 'Beta' },
      ],
    });
  });

  it('is closed to an athlete', async () => {
    const a = await publish('Alpha');
    await exporting(ALICE, [a.id]).expect(403);
  });

  it("will not export a personal routine, anyone's, or Just WODs", async () => {
    const alices = await author(ALICE);
    const admins = await author(ADMIN);
    for (const id of [alices.id, admins.id, DEFAULT_PLAN_ID]) {
      await exporting(ADMIN, [id]).expect(404);
    }
  });
});
