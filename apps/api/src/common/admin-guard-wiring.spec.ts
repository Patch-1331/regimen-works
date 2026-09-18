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
 * Stands in for the library write routes DN-25 and DN-26 will add. No route in
 * the app is @AdminOnly() yet — the guard shipped ahead of the endpoints it
 * exists for — so without a fixture there would be nothing to point the
 * wiring proof at, and "the guard is registered" would rest on reading
 * app.module.ts.
 */
@Controller('test-admin')
class AdminFixtureController {
  @Get()
  @AdminOnly()
  read() {
    return { ok: true };
  }

  /**
   * The contradictory pairing, here so its behaviour is pinned rather than
   * discovered. There is no verified caller on a public route, so there is
   * nothing for the guard to judge.
   */
  @Get('public')
  @Public()
  @AdminOnly()
  publicAndAdmin() {
    return { ok: true };
  }
}

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
        exercise: { findMany: jest.fn().mockResolvedValue([]) },
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

  it('lets an admin through an @AdminOnly() route', () => {
    return request(app.getHttpServer())
      .get('/test-admin')
      .set('Authorization', 'Bearer admin-token')
      .expect(200);
  });

  it('refuses a signed-in athlete', () => {
    return request(app.getHttpServer())
      .get('/test-admin')
      .set('Authorization', 'Bearer athlete-token')
      .expect(403);
  });

  it('refuses an unauthenticated caller before it ever asks about admin', () => {
    return request(app.getHttpServer()).get('/test-admin').expect(401);
  });

  // A template emitting "true" as a string is the realistic misconfiguration,
  // and truthiness would read it as admin.
  it('refuses a claim that is not the boolean true', () => {
    return request(app.getHttpServer())
      .get('/test-admin')
      .set('Authorization', 'Bearer stale-token')
      .expect(403);
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
