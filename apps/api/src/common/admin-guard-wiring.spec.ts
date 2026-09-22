import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { UserProvisioningService } from '../auth/user-provisioning.service';
import { AdminOnly } from './admin-only.decorator';
import { Public } from './public.decorator';

// Three callers, told apart by token. `admin-token` carries the custom claim
// the Clerk JWT template fills from publicMetadata; `athlete-token` is a
// perfectly valid session that simply doesn't; `stale-token` carries the claim
// as the string "true", which is what a misconfigured template emits and what
// a truthiness check would wave through.
jest.mock('@clerk/backend', () => ({
  verifyToken: jest.fn((token: string) => {
    if (token === 'admin-token')
      return Promise.resolve({ sub: 'user_admin', isAdmin: true });
    if (token === 'athlete-token')
      return Promise.resolve({ sub: 'user_alice' });
    if (token === 'stale-token')
      return Promise.resolve({ sub: 'user_bob', isAdmin: 'true' });
    return Promise.reject(new Error('invalid'));
  }),
}));

/**
 * All that is left of the fixture the guard shipped with (DN-92).
 *
 * The guard arrived before any route it could protect, so every case below was
 * once pointed here. DN-25 added the real ones, and the cases that can be made
 * against `/admin/exercises` now are. This pairing survives because no real
 * route has it and none should: a route cannot be both open to everyone and
 * closed to all but admins, and what that does is worth pinning rather than
 * leaving to be discovered the first time someone writes it by accident.
 */
@Controller('test-admin')
class AdminFixtureController {
  @Get('public')
  @Public()
  @AdminOnly()
  publicAndAdmin() {
    return { ok: true };
  }
}

/** A complete exercise body, so a write that gets through the guard succeeds. */
const BODY = {
  name: 'Air squat',
  pattern: 'squat',
  equipment: [],
  scalable: false,
  unit: 'reps',
  instructions: null,
  movementGroup: null,
  rung: null,
  fallbackExerciseId: null,
  phase: null,
};

/**
 * Proves AdminGuard is registered globally and acts only where it's marked.
 *
 * The same reasoning as ClerkAuthGuard's wiring spec, one step sharper: an
 * AdminGuard that passes its own unit tests but isn't wired as APP_GUARD
 * leaves every @AdminOnly() route open to any signed-in athlete, and the route
 * still looks guarded in the source.
 */
describe('AdminGuard wiring', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    process.env.CLERK_SECRET_KEY = 'sk_test_not_a_real_key';
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [AdminFixtureController],
    })
      .overrideProvider(PrismaService)
      .useValue({
        $connect: jest.fn(),
        $disconnect: jest.fn(),
        exercise: {
          findMany: jest.fn().mockResolvedValue([]),
          // The name-collision check, answering "nothing is called that".
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({ id: 'ex-1', ...BODY }),
        },
      })
      .overrideProvider(UserProvisioningService)
      .useValue({ ensure: jest.fn().mockResolvedValue(undefined) })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('lets an admin write the shared library', () => {
    return request(app.getHttpServer())
      .post('/admin/exercises')
      .set('Authorization', 'Bearer admin-token')
      .send(BODY)
      .expect(201);
  });

  it('refuses a signed-in athlete', () => {
    return request(app.getHttpServer())
      .post('/admin/exercises')
      .set('Authorization', 'Bearer athlete-token')
      .send(BODY)
      .expect(403);
  });

  it('refuses an unauthenticated caller before it ever asks about admin', () => {
    return request(app.getHttpServer())
      .post('/admin/exercises')
      .send(BODY)
      .expect(401);
  });

  // A template emitting "true" as a string is the realistic misconfiguration,
  // and truthiness would read it as admin.
  it('refuses a claim that is not the boolean true', () => {
    return request(app.getHttpServer())
      .post('/admin/exercises')
      .set('Authorization', 'Bearer stale-token')
      .send(BODY)
      .expect(403);
  });

  // @AdminOnly() sits on the controller class, so the routes it covers are
  // whatever the class holds — including ones added after it was written.
  it('closes every route on the admin controller, not just the one', () => {
    return request(app.getHttpServer())
      .post('/admin/exercises/ex-1/archive')
      .set('Authorization', 'Bearer athlete-token')
      .expect(403);
  });

  /**
   * The second admin controller (DN-26), which is the case this spec exists
   * for: `@AdminOnly()` is a decorator someone has to remember, and a new
   * admin controller without it type-checks, reads as guarded, and is open.
   *
   * Only the refusals are asserted here. They never reach the service, so
   * this stays a wiring spec rather than a second copy of the WOD rules —
   * the admissions are proved end to end in `wod-library-write.e2e-spec.ts`.
   */
  it('refuses a signed-in athlete every route on the admin WOD controller', async () => {
    const http = request(app.getHttpServer());

    await http
      .post('/admin/wods')
      .set('Authorization', 'Bearer athlete-token')
      .send({})
      .expect(403);
    await http
      .patch('/admin/wods/wod-1')
      .set('Authorization', 'Bearer athlete-token')
      .send({})
      .expect(403);
    await http
      .post('/admin/wods/wod-1/archive')
      .set('Authorization', 'Bearer athlete-token')
      .expect(403);
    await http
      .post('/admin/wods/wod-1/unarchive')
      .set('Authorization', 'Bearer athlete-token')
      .expect(403);
  });

  // 403 rather than 400: the guard runs before the body is ever read, so an
  // empty body is not what any of the above is reporting.
  it('closes the admin WOD routes before validating anything', () => {
    return request(app.getHttpServer())
      .post('/admin/wods')
      .set('Authorization', 'Bearer admin-token')
      .send({})
      .expect(400);
  });

  it('leaves unmarked routes alone for every signed-in caller', () => {
    return request(app.getHttpServer())
      .get('/exercises')
      .set('Authorization', 'Bearer athlete-token')
      .expect(200);
  });

  it('fails loudly rather than admitting anyone on a @Public() admin route', () => {
    return request(app.getHttpServer()).get('/test-admin/public').expect(500);
  });
});
