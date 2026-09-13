import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { verifyToken } from '@clerk/backend';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { UserProvisioningService } from '../auth/user-provisioning.service';

// Networkless JWT verification is Clerk's job and is not what this proves;
// what matters here is that the guard runs on every route and rejects anything
// it can't verify.
jest.mock('@clerk/backend', () => ({
  verifyToken: jest.fn((token: string) => {
    if (token === 'valid-token') return Promise.resolve({ sub: 'user_alice' });
    return Promise.reject(new Error('invalid'));
  }),
}));

/**
 * Proves ClerkAuthGuard is registered globally. A guard that passes its own
 * unit tests but isn't wired as APP_GUARD would leave every route open, and
 * nothing else in the suite would notice.
 */
describe('ClerkAuthGuard wiring', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    process.env.CLERK_SECRET_KEY = 'sk_test_not_a_real_key';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
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

  it('rejects an unauthenticated read', () => {
    return request(app.getHttpServer()).get('/exercises').expect(401);
  });

  it('rejects an unauthenticated write', () => {
    return request(app.getHttpServer()).post('/today/skip').expect(401);
  });

  it('rejects an unauthenticated delete', () => {
    return request(app.getHttpServer())
      .delete('/assignments/some-id/session')
      .expect(401);
  });

  it('rejects a token it cannot verify', () => {
    return request(app.getHttpServer())
      .get('/exercises')
      .set('Authorization', 'Bearer forged-token')
      .expect(401);
  });

  it('rejects a non-bearer authorization header', () => {
    return request(app.getHttpServer())
      .get('/exercises')
      .set('Authorization', 'Basic dXNlcjpwYXNz')
      .expect(401);
  });

  it('admits a verified session token', () => {
    return request(app.getHttpServer())
      .get('/exercises')
      .set('Authorization', 'Bearer valid-token')
      .expect(200);
  });

  it('leaves the health check reachable for Render', () => {
    return request(app.getHttpServer()).get('/').expect(200);
  });

  /**
   * Clerk skips the authorized-party check entirely when the option is absent,
   * so its omission is invisible from the outside: every token still verifies,
   * including one minted for a different frontend on the same instance. The
   * only way to catch that regression is to assert the option is passed.
   */
  it('constrains verification to the configured web origins', async () => {
    process.env.WEB_ORIGIN = 'https://regimenworks.com';
    jest.mocked(verifyToken).mockClear();

    await request(app.getHttpServer())
      .get('/exercises')
      .set('Authorization', 'Bearer valid-token')
      .expect(200);

    expect(jest.mocked(verifyToken)).toHaveBeenCalledWith(
      'valid-token',
      expect.objectContaining({
        authorizedParties: ['https://regimenworks.com'],
      }),
    );

    delete process.env.WEB_ORIGIN;
  });
});
