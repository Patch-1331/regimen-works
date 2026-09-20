import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Options } from 'pino-http';
import { AUTH_USER_ID } from '../auth/clerk-auth.guard';

/**
 * Structured request logging for the deployed API (DN-41).
 *
 * Before this the API logged nothing but Nest's own startup lines, so the only
 * signal a running service gave was whether it answered — a 500 in production
 * left no trace anywhere anyone could read. Render captures stdout, so JSON on
 * stdout is the whole mechanism; there is no agent and no second service.
 *
 * Kept as a plain object away from `app.module.ts` so the decisions below can
 * be asserted (see `logging.config.spec.ts`). Two of them — redaction and the
 * ignored health check — are the kind that fail silently and expensively.
 */

/** Paths whose request logs are noise rather than signal. */
export const IGNORED_PATHS = ['/health'];

/**
 * Header and cookie paths scrubbed from every log line.
 *
 * Non-negotiable rather than tidy-minded: every authenticated request to this
 * API carries a Clerk session token in `authorization`, so an unredacted
 * logger writes a live credential into Render's log store on every single
 * line, where it outlives the ~60s token and is readable by anyone with
 * dashboard access.
 */
export const REDACTED = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
];

/**
 * The id a log line is correlated by.
 *
 * `cf-request-id` first for the same trust reason `ProxyAwareThrottlerGuard`
 * prefers `cf-connecting-ip`: it is written by the Cloudflare edge and cannot
 * be forged from outside, and it lets a log line here be traced back to a
 * Cloudflare event. `x-request-id` is the conventional fallback for a
 * deployment without that hop. Failing both, one is generated, so every
 * request has an id even locally.
 */
export function requestId(req: IncomingMessage): string {
  const headers = req.headers;
  const cloudflare = headers['cf-request-id'];
  if (typeof cloudflare === 'string' && cloudflare) return cloudflare;

  const conventional = headers['x-request-id'];
  if (typeof conventional === 'string' && conventional) return conventional;

  return randomUUID();
}

/**
 * The fields worth having on a request log beyond pino-http's own.
 *
 * `userId` is read from where `ClerkAuthGuard` stashes it. The timing works
 * and is worth stating: pino-http opens the request before any guard runs, but
 * the completion line is emitted at response time, long after the guard has
 * written the id — so an authenticated request is attributed and an
 * unauthenticated one simply has no `userId`, which is itself the useful
 * distinction.
 */
export function requestProps(req: IncomingMessage): Record<string, unknown> {
  const userId = (req as unknown as Record<string, unknown>)[AUTH_USER_ID];
  return typeof userId === 'string' ? { userId } : {};
}

/** Whether this request's completion line should be written at all. */
export function isIgnored(req: IncomingMessage): boolean {
  const path = (req.url ?? '').split('?')[0];
  return IGNORED_PATHS.includes(path);
}

/**
 * Raw JSON in production, pretty lines locally, nothing at all under test.
 *
 * The production/local split is the point of the transport: JSON is what makes
 * Render's log search worth using and is unreadable in a terminal, while
 * `pino-pretty` is a devDependency, so asking for it in production would be
 * asking for a module that is not installed.
 *
 * `test` is silenced rather than prettified. The e2e and wiring suites drive
 * hundreds of real requests through this middleware, and a run that prints
 * every one of them buries the failure it was meant to show. The config is
 * still exercised there -- redaction and the ignore rule are asserted directly
 * below, not inferred from output nobody reads.
 */
export function loggerParams(
  nodeEnv = process.env.NODE_ENV,
): Options<IncomingMessage, ServerResponse> {
  const production = nodeEnv === 'production';
  const testing = nodeEnv === 'test';

  return {
    level: testing ? 'silent' : production ? 'info' : 'debug',
    genReqId: requestId,
    customProps: requestProps,
    redact: REDACTED,
    // Render probes /health continuously; unignored it drowns every real
    // request in the log view, which is the failure mode that makes people
    // stop reading logs at all.
    autoLogging: { ignore: isIgnored },
    transport: production || testing ? undefined : { target: 'pino-pretty' },
  };
}
