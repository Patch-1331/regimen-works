import { FAILURES_BEFORE_DOWN, isUnhealthy, readHealth } from './health.logic';

/**
 * The health threshold, away from Nest and Prisma (DN-76).
 *
 * The thing worth pinning down here is the bias: a probe that goes red on the
 * first bad round-trip lets a transient database hiccup restart a working
 * service, so the failure has to persist before it counts.
 */
describe('readHealth', () => {
  it('reports a healthy service when the database answers', () => {
    expect(readHealth(true, 0)).toEqual({
      status: 'ok',
      database: 'up',
      consecutiveFailures: 0,
    });
  });

  it('does not go down on the first failed round-trip', () => {
    // The whole reason this is not a bare try/catch: one blip must not be
    // enough to have Render restart an otherwise working instance.
    expect(readHealth(false, 0)).toEqual({
      status: 'degraded',
      database: 'down',
      consecutiveFailures: 1,
    });
  });

  it('stays up in the sense that matters while degraded', () => {
    expect(isUnhealthy(readHealth(false, 0))).toBe(false);
  });

  it('goes down once the failures run unbroken to the threshold', () => {
    const report = readHealth(false, FAILURES_BEFORE_DOWN - 1);

    expect(report.status).toBe('down');
    expect(report.consecutiveFailures).toBe(FAILURES_BEFORE_DOWN);
    expect(isUnhealthy(report)).toBe(true);
  });

  it('stays down while the database stays unreachable', () => {
    // Past the threshold, not merely at it -- an outage does not heal by
    // being probed more.
    expect(readHealth(false, FAILURES_BEFORE_DOWN + 5).status).toBe('down');
  });

  it('resets the count on a success rather than counting it down', () => {
    // A recovered database has stopped being the outage the counter was
    // tracking, so the next failure starts a fresh run. Decrementing would
    // leave a flapping database permanently one probe from red.
    expect(readHealth(true, FAILURES_BEFORE_DOWN - 1).consecutiveFailures).toBe(
      0,
    );
  });

  it('reports the database as up only when it answered', () => {
    expect(readHealth(true, 0).database).toBe('up');
    expect(readHealth(false, 0).database).toBe('down');
  });

  it('needs more than one failure to go down', () => {
    // Guards the constant itself: at 1 this file would still pass every case
    // above except this one, and the restart-loop bias would be gone.
    expect(FAILURES_BEFORE_DOWN).toBeGreaterThan(1);
  });
});
