import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { UserProvisioningService } from '../auth/user-provisioning.service';
import { FAILURES_BEFORE_DOWN } from './health.logic';

jest.mock('@clerk/backend', () => ({
  verifyToken: jest.fn(() => Promise.resolve({ sub: 'user_alice' })),
}));

/**
 * `GET /health` as Render and an uptime monitor see it (DN-76).
 *
 * Sibling to guard-wiring and throttler-wiring, and for the same reason: the
 * decorators on this route are load-bearing, and a route that quietly lost
 * `@Public()` or its throttle exemption would still pass every unit test while
 * reporting a healthy service as unreachable in production.
 */
describe('health check wiring', () => {
  let app: INestApplication<App>;
  let databaseUp: boolean;

  beforeAll(async () => {
    process.env.CLERK_SECRET_KEY = 'sk_test_not_a_real_key';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({
        $connect: jest.fn(),
        $disconnect: jest.fn(),
        $queryRaw: () =>
          databaseUp
            ? Promise.resolve([{ '?column?': 1 }])
            : Promise.reject(new Error('ECONNREFUSED')),
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

  beforeEach(async () => {
    // The failure counter lives on the (singleton) HealthService and survives
    // between tests, exactly as it survives between probes in production. One
    // successful probe is what clears it, so each test below starts from a
    // service that considers itself healthy rather than from whatever the
    // previous one left behind.
    databaseUp = true;
    await probe('203.0.113.39').expect(200);
  });

  const probe = (ip = '203.0.113.40') =>
    request(app.getHttpServer()).get('/health').set('cf-connecting-ip', ip);

  it('answers a probe carrying no authorization header', async () => {
    // Render's probe cannot send one. Without @Public() the global auth guard
    // 401s it, Render reads that as unhealthy, and the service never starts.
    await probe().expect(200);
  });

  it('is exempt from rate limiting', async () => {
    // Probes arrive outside the Cloudflare edge and so share one tracker key.
    // A throttled probe reads as an unhealthy service and restarts it -- a
    // restart loop caused by the check that was meant to detect one.
    const ip = '203.0.113.41';
    for (let i = 0; i < 45; i++) {
      await probe(ip).expect(200);
    }
  });

  it('answers 503 once the database has been unreachable long enough', async () => {
    // The status code is the whole contract: Render and any uptime monitor
    // judge that, so a failure described in a 200's body is a check that
    // cannot fail.
    databaseUp = false;

    for (let i = 0; i < FAILURES_BEFORE_DOWN - 1; i++) {
      await probe('203.0.113.42').expect(200);
    }
    const down = await probe('203.0.113.42').expect(503);

    expect(down.body).toMatchObject({ status: 'down', database: 'down' });
  });

  it('comes back up on its own when the database does', async () => {
    // Nothing has to restart for the check to recover -- which is the point of
    // reporting "degraded" rather than failing on the first blip. Driven all
    // the way down and back here rather than leaning on the test above, so
    // this says something whatever order the file runs in.
    const ip = '203.0.113.43';
    databaseUp = false;
    for (let i = 0; i < FAILURES_BEFORE_DOWN - 1; i++) {
      await probe(ip).expect(200);
    }
    await probe(ip).expect(503);

    databaseUp = true;

    const recovered = await probe(ip).expect(200);
    expect(recovered.body).toMatchObject({
      status: 'ok',
      consecutiveFailures: 0,
    });
  });

  it('is the path Render is configured to probe', async () => {
    // The route only matters if the blueprint points at it. Nothing else in
    // the repo connects the two, and a healthCheckPath left on `/` would
    // leave this whole change inert while every test above still passed.
    const blueprint = readFileSync(
      join(__dirname, '..', '..', '..', '..', 'render.yaml'),
      'utf8',
    );

    expect(blueprint).toContain('healthCheckPath: /health');
    await probe().expect(200);
  });
});
