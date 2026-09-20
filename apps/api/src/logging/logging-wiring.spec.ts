import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { Logger, LoggerModule } from 'nestjs-pino';
import { Writable } from 'node:stream';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { UserProvisioningService } from '../auth/user-provisioning.service';
import { AUTH_USER_ID } from '../auth/clerk-auth.guard';
import { loggerParams } from './logging.config';

jest.mock('@clerk/backend', () => ({
  verifyToken: jest.fn(() => Promise.resolve({ sub: 'user_alice' })),
}));

/**
 * What pino actually writes, and whether this app writes it at all (DN-41).
 *
 * `logging.config.spec` fixes the decisions; this fixes that they take effect.
 * A redaction path that is subtly wrong (`req.headers.Authorization`, say)
 * passes every assertion there and still writes a live session token to the
 * log store, so the only honest check is to read a real emitted line.
 */
describe('request logging', () => {
  /** Collects the JSON lines pino writes during one request. */
  function collector() {
    const lines: Record<string, unknown>[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _encoding, done) {
        for (const line of chunk.toString().trim().split('\n')) {
          if (line) lines.push(JSON.parse(line) as Record<string, unknown>);
        }
        done();
      },
    });
    return { lines, stream };
  }

  /** A probe route that stands in for a real one, with a user already stashed. */
  @Controller()
  class ProbeController {
    @Get('today')
    today(): string {
      return 'ok';
    }

    @Get('health')
    health(): string {
      return 'ok';
    }
  }

  async function appWriting(lines: ReturnType<typeof collector>) {
    const moduleRef = await Test.createTestingModule({
      imports: [
        LoggerModule.forRoot({
          pinoHttp: [{ ...loggerParams('production') }, lines.stream],
        }),
      ],
      controllers: [ProbeController],
    }).compile();

    const app = moduleRef.createNestApplication<INestApplication<App>>();
    // Stand in for ClerkAuthGuard, which is what puts the id on the request.
    app.use((req: Record<string, unknown>, _res: unknown, next: () => void) => {
      req[AUTH_USER_ID] = 'user_alice';
      next();
    });
    await app.init();
    return app;
  }

  it('never writes the session token it was handed', async () => {
    // The reason redaction is not a nicety: this header carries a live Clerk
    // credential on every authenticated request.
    const sink = collector();
    const app = await appWriting(sink);

    await request(app.getHttpServer())
      .get('/today')
      .set('Authorization', 'Bearer sk_live_pretend_this_is_real')
      .expect(200);
    await app.close();

    expect(JSON.stringify(sink.lines)).not.toContain(
      'sk_live_pretend_this_is_real',
    );
    expect(JSON.stringify(sink.lines)).toContain('[Redacted]');
  });

  it('correlates the line with the id Cloudflare gave the request', async () => {
    const sink = collector();
    const app = await appWriting(sink);

    await request(app.getHttpServer())
      .get('/today')
      .set('cf-request-id', 'cf-trace-me')
      .expect(200);
    await app.close();

    const ids = sink.lines.map(
      (line) => (line.req as { id?: string } | undefined)?.id,
    );
    expect(ids).toContain('cf-trace-me');
  });

  it('says which athlete a request belonged to', async () => {
    const sink = collector();
    const app = await appWriting(sink);

    await request(app.getHttpServer()).get('/today').expect(200);
    await app.close();

    expect(sink.lines.some((line) => line.userId === 'user_alice')).toBe(true);
  });

  it('writes nothing for the health probe', async () => {
    // Render probes it continuously. Unignored, it is most of the log volume
    // and every real request is lost in it.
    const sink = collector();
    const app = await appWriting(sink);

    await request(app.getHttpServer()).get('/health').expect(200);
    await app.close();

    expect(sink.lines.filter((line) => line.req ?? line.res)).toHaveLength(0);
  });

  it('is registered on the real application, not only in this spec', async () => {
    // Everything above would pass with LoggerModule never imported by
    // AppModule, leaving the deployed API silent.
    process.env.CLERK_SECRET_KEY = 'sk_test_not_a_real_key';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({ $connect: jest.fn(), $disconnect: jest.fn() })
      .overrideProvider(UserProvisioningService)
      .useValue({ ensure: jest.fn().mockResolvedValue(undefined) })
      .compile();

    expect(moduleRef.get(Logger, { strict: false })).toBeDefined();
  });
});
