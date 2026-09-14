import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { App } from 'supertest/types';
import { AppModule } from '../app.module';
import { NoContentInterceptor } from '../common/no-content.interceptor';

/**
 * The application under e2e test, wired the way `main.ts` wires it.
 *
 * The global pieces live in `bootstrap()` rather than in `AppModule`, so a
 * plain `Test.createTestingModule({ imports: [AppModule] })` app is missing
 * them — most importantly `NoContentInterceptor`, without which every
 * "absent" endpoint answers 200-with-no-body instead of 204 and an e2e suite
 * would cheerfully assert the wrong contract. Anything added to bootstrap's
 * global wiring belongs here too.
 *
 * Helmet and CORS are deliberately not replicated: they shape response
 * headers for a browser, and asserting them here would be testing the two
 * libraries rather than this API.
 */
export async function createE2eApp(): Promise<INestApplication<App>> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication<INestApplication<App>>();
  app.useGlobalInterceptors(new NoContentInterceptor());
  await app.init();
  return app;
}

/**
 * A bearer header the stubbed `verifyToken` accepts (see `mockClerk` in the
 * e2e specs). The token is the user id, so a test can speak as someone else
 * by naming them rather than by wiring a second mock.
 */
export function asUser(userId: string): [string, string] {
  return ['Authorization', `Bearer ${userId}`];
}
