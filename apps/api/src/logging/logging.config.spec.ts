import type { IncomingMessage } from 'node:http';
import { AUTH_USER_ID } from '../auth/clerk-auth.guard';
import {
  IGNORED_PATHS,
  REDACTED,
  isIgnored,
  loggerParams,
  requestId,
  requestProps,
} from './logging.config';

/**
 * The decisions the request logger makes (DN-41).
 *
 * Kept away from the module wiring because two of them fail silently: an
 * unredacted logger writes a live session token to Render's log store on every
 * authenticated request, and an unignored health check buries every real
 * request under Render's own probes. Neither shows up as a broken test
 * anywhere else.
 */

function req(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return { url: '/today', headers: {}, ...overrides } as IncomingMessage;
}

describe('redaction', () => {
  it('scrubs the authorization header', () => {
    // The one that matters. Every authenticated request to this API carries a
    // Clerk session token here, so without this line the log store collects
    // live credentials.
    expect(REDACTED).toContain('req.headers.authorization');
  });

  it('scrubs cookies in both directions', () => {
    expect(REDACTED).toContain('req.headers.cookie');
    expect(REDACTED).toContain('res.headers["set-cookie"]');
  });

  it('is applied by the config, not merely declared', () => {
    // REDACTED could be perfectly correct and never passed to pino.
    expect(loggerParams('production').redact).toBe(REDACTED);
  });
});

describe('requestId', () => {
  it("prefers Cloudflare's, which cannot be forged from outside", () => {
    const id = requestId(
      req({
        headers: { 'cf-request-id': 'cf-abc', 'x-request-id': 'client-said' },
      }),
    );

    expect(id).toBe('cf-abc');
  });

  it('falls back to x-request-id where there is no Cloudflare hop', () => {
    expect(requestId(req({ headers: { 'x-request-id': 'xrid' } }))).toBe(
      'xrid',
    );
  });

  it('generates one when the request carries neither', () => {
    // Every line gets an id even locally, so a local trace reads the same way
    // a deployed one does.
    const id = requestId(req());

    expect(id).toHaveLength(36);
    expect(id).not.toBe(requestId(req()));
  });

  it('ignores a header that arrived empty', () => {
    const id = requestId(req({ headers: { 'cf-request-id': '' } }));

    expect(id).not.toBe('');
  });

  it('is what the config hands pino', () => {
    expect(loggerParams('production').genReqId).toBe(requestId);
  });
});

describe('requestProps', () => {
  it('attributes a request to the athlete the guard verified', () => {
    const authenticated = req();
    (authenticated as unknown as Record<string, unknown>)[AUTH_USER_ID] =
      'user_alice';

    expect(requestProps(authenticated)).toEqual({ userId: 'user_alice' });
  });

  it('says nothing about an unauthenticated request', () => {
    // Absent rather than present-and-empty: "no userId" is the useful
    // distinction, and a `userId: undefined` would still serialise as a key
    // in some transports while reading here as an athlete whose id failed to
    // resolve. toStrictEqual because toEqual considers the two the same.
    expect(requestProps(req())).toStrictEqual({});
    expect(Object.keys(requestProps(req()))).toHaveLength(0);
  });
});

describe('the ignored health check', () => {
  it('drops the probe Render sends continuously', () => {
    expect(isIgnored(req({ url: '/health' }))).toBe(true);
  });

  it('ignores it with a query string attached too', () => {
    expect(isIgnored(req({ url: '/health?from=uptime' }))).toBe(true);
  });

  it('keeps every real request', () => {
    expect(isIgnored(req({ url: '/today' }))).toBe(false);
    expect(isIgnored(req({ url: '/' }))).toBe(false);
  });

  it('does not drop a route that merely starts the same way', () => {
    expect(isIgnored(req({ url: '/healthy-habits' }))).toBe(false);
  });

  it('names the path the blueprint actually probes', () => {
    expect(IGNORED_PATHS).toContain('/health');
  });
});

describe('loggerParams', () => {
  it('emits raw JSON in production, which is what Render can search', () => {
    const params = loggerParams('production');

    expect(params.transport).toBeUndefined();
    expect(params.level).toBe('info');
  });

  it('prettifies locally, where JSON is unreadable', () => {
    expect(loggerParams('development').transport).toEqual({
      target: 'pino-pretty',
    });
  });

  it('says nothing at all under test', () => {
    // A suite that prints every request buries the failure it exists to show.
    const params = loggerParams('test');

    expect(params.level).toBe('silent');
    expect(params.transport).toBeUndefined();
  });
});
