/**
 * What a health probe means, decided away from Nest and away from Prisma
 * (DN-76).
 *
 * The check this replaces returned a constant string, so it proved the Node
 * process was listening and nothing else: the API could be up while Postgres
 * was unreachable, every real route 500ing, and Render's probe still green.
 *
 * Closing that gap is not simply "fail when the query fails", though. Render
 * restarts an instance whose health check goes red, so a probe that fails on
 * the first bad round-trip hands a transient, self-healing database hiccup the
 * power to restart a working service -- and a restart loop is a worse outcome
 * than a briefly degraded one. That is the trade-off this file settles.
 */

/**
 * How many probes in a row have to fail before the service calls itself down.
 *
 * Render probes roughly every few seconds, so three in a row is a database
 * that has been unreachable for long enough to be a real outage rather than a
 * blip. Tuned for a restart being expensive and a degraded minute being
 * cheap; the opposite bias would want 1.
 */
export const FAILURES_BEFORE_DOWN = 3;

/**
 * How long to wait for the round-trip before counting it as failed.
 *
 * A hung connection is the case this exists for: without a deadline the probe
 * waits as long as the driver does, Render's own probe timeout fires first,
 * and the counter above never advances -- so the threshold that is supposed to
 * tolerate blips would instead never be reached.
 */
export const PROBE_TIMEOUT_MS = 2_000;

export type HealthStatus = 'ok' | 'degraded' | 'down';

export type HealthReport = {
  /**
   * `degraded` is reported with 200. It is deliberately not a failing probe:
   * it says the last round-trip did not come back but the service has not yet
   * been unreachable for long enough to be worth restarting.
   */
  status: HealthStatus;
  database: 'up' | 'down';
  /** Failed probes in a row, including this one. Zero once one succeeds. */
  consecutiveFailures: number;
};

/**
 * The report for one probe, given whether the database answered and how many
 * probes had already failed in a row before it.
 *
 * A success resets the count rather than decrementing it: the threshold is
 * about an unbroken run of failures, and a database that answers has stopped
 * being the outage the counter was tracking.
 */
export function readHealth(
  databaseUp: boolean,
  failuresBefore: number,
): HealthReport {
  if (databaseUp) {
    return { status: 'ok', database: 'up', consecutiveFailures: 0 };
  }

  const consecutiveFailures = failuresBefore + 1;
  return {
    status: consecutiveFailures >= FAILURES_BEFORE_DOWN ? 'down' : 'degraded',
    database: 'down',
    consecutiveFailures,
  };
}

/** Whether this report should fail the probe, rather than merely describe it. */
export function isUnhealthy(report: HealthReport): boolean {
  return report.status === 'down';
}
