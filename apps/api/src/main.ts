import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { NoContentInterceptor } from './common/no-content.interceptor';
import { webOrigins } from './common/origins';

async function bootstrap() {
  // Fail fast rather than start unauthenticated: ClerkAuthGuard verifies every
  // non-public route against this key, so an unset one would mean a service
  // that rejects everything with no obvious signal.
  if (!process.env.CLERK_SECRET_KEY) {
    throw new Error(
      'CLERK_SECRET_KEY is not set. See apps/api/.env.example — the API ' +
        'refuses to start without it so it can never serve unauthenticated ' +
        'traffic.',
    );
  }

  const app = await NestFactory.create(AppModule);

  // Response hardening. Mostly it drops `x-powered-by`, which advertises the
  // framework to anyone scanning, and adds nosniff/frame headers.
  //
  // CORP is widened to cross-origin deliberately: the default same-origin
  // policy is about embedding, and this API is *designed* to be read from the
  // separately-hosted web app. CSP stays on its default — irrelevant to JSON,
  // but `GET /` does answer as text/html.
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

  app.enableCors({ origin: webOrigins() });
  app.useGlobalInterceptors(new NoContentInterceptor());
  await app.listen(process.env.PORT ?? 3001);
}
void bootstrap();
