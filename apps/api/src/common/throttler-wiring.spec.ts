import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { UserProvisioningService } from '../auth/user-provisioning.service';

jest.mock('@clerk/backend', () => ({
  verifyToken: jest.fn(() => Promise.resolve({ sub: 'user_alice' })),
}));

/**
 * Companion to guard-wiring.spec: proves the throttler is registered as a
 * global guard. A ThrottlerModule that is imported but whose guard is never
 * bound leaves every route unlimited, and no other test would notice.
 */
describe('ThrottlerGuard wiring', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    process.env.CLERK_SECRET_KEY = 'sk_test_not_a_real_key';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({
        $connect: jest.fn(),
        $disconnect: jest.fn(),
        $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
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

  /** Distinct IP per test: the tracker keys on it, so tests can't spend each other's budget. */
  function get(path: string, ip: string) {
    return request(app.getHttpServer())
      .get(path)
      .set('cf-connecting-ip', ip)
      .set('Authorization', 'Bearer valid-token');
  }

  it('rejects a caller past the burst limit with 429', async () => {
    const ip = '203.0.113.10';
    // The burst tier allows 40 per 10s; the 41st is over.
    for (let i = 0; i < 40; i++) {
      await get('/exercises', ip).expect(200);
    }
    await get('/exercises', ip).expect(429);
  });

  it('counts each client IP separately, so one abuser cannot lock everyone out', async () => {
    const noisy = '203.0.113.20';
    for (let i = 0; i < 41; i++) {
      await get('/exercises', noisy);
    }
    await get('/exercises', noisy).expect(429);

    // A different client is unaffected.
    await get('/exercises', '203.0.113.21').expect(200);
  });

  it('leaves the public front door unthrottled', async () => {
    // Not the health check any more -- that moved to /health in DN-76, where
    // `health-wiring.spec` proves the same exemption. This route keeps it
    // because anything pointed at the bare host still lands here.
    const ip = '203.0.113.30';
    for (let i = 0; i < 45; i++) {
      await request(app.getHttpServer())
        .get('/')
        .set('cf-connecting-ip', ip)
        .expect(200);
    }
  });
});
