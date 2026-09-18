import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { UserProvisioningService } from '../auth/user-provisioning.service';

jest.mock('@clerk/backend', () => ({
  verifyToken: jest.fn((token: string) => {
    if (token === 'admin-token')
      return Promise.resolve({ sub: 'user_admin', isAdmin: true });
    if (token === 'athlete-token')
      return Promise.resolve({ sub: 'user_alice' });
    return Promise.reject(new Error('invalid'));
  }),
}));

/**
 * `/me` is what the web client reads to decide whether to render an admin
 * surface at all (DN-92). It is not the enforcement — a client that ignores it
 * finds AdminGuard instead — so what matters is that it reports the same flag
 * the guard acts on, for the same token.
 */
describe('GET /me', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    process.env.CLERK_SECRET_KEY = 'sk_test_not_a_real_key';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({ $connect: jest.fn(), $disconnect: jest.fn() })
      .overrideProvider(UserProvisioningService)
      .useValue({ ensure: jest.fn().mockResolvedValue(undefined) })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports an admin as one', () => {
    return request(app.getHttpServer())
      .get('/me')
      .set('Authorization', 'Bearer admin-token')
      .expect(200)
      .expect({ id: 'user_admin', isAdmin: true });
  });

  // A token with no `isAdmin` claim is the ordinary case and also the shape a
  // missing JWT template produces, so this pins both: absent reads as false.
  it('reports an athlete as not one', () => {
    return request(app.getHttpServer())
      .get('/me')
      .set('Authorization', 'Bearer athlete-token')
      .expect(200)
      .expect({ id: 'user_alice', isAdmin: false });
  });

  it('is not public', () => {
    return request(app.getHttpServer()).get('/me').expect(401);
  });
});
