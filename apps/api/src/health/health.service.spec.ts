import { Logger } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { HealthService } from './health.service';
import {
  FAILURES_BEFORE_DOWN,
  PROBE_TIMEOUT_MS,
  type HealthReport,
} from './health.logic';

/**
 * The round-trip and the counter behind it (DN-76).
 *
 * `health.logic.spec` fixes what a report means; this fixes the two things
 * only the service can get wrong -- that a probe which never comes back is
 * counted as a failure rather than waited on forever, and that the run of
 * failures is actually carried between probes.
 */
describe('HealthService', () => {
  /** A Prisma stub whose `SELECT 1` behaviour each test chooses. */
  function serviceWith(queryRaw: () => Promise<unknown>) {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    return new HealthService({
      $queryRaw: queryRaw,
    } as unknown as PrismaService);
  }

  const answers = () => Promise.resolve([{ '?column?': 1 }]);
  const refuses = () => Promise.reject(new Error('ECONNREFUSED'));
  const hangs = () => new Promise<unknown>(() => {});

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('reports ok when the database answers', async () => {
    await expect(serviceWith(answers).check()).resolves.toMatchObject({
      status: 'ok',
      database: 'up',
    });
  });

  it('counts a refused connection as a failure rather than throwing', async () => {
    // The route has to answer. An exception escaping here would be a 500 with
    // no report in it, which tells a monitor less than "degraded" does.
    await expect(serviceWith(refuses).check()).resolves.toMatchObject({
      status: 'degraded',
      consecutiveFailures: 1,
    });
  });

  it('carries the run of failures from one probe to the next', async () => {
    // The counter is the feature. Without it every probe would look like the
    // first one and the threshold could never be reached.
    const health = serviceWith(refuses);

    const reports: HealthReport[] = [];
    for (let i = 0; i < FAILURES_BEFORE_DOWN; i++) {
      reports.push(await health.check());
    }

    const expected: string[] = Array<string>(FAILURES_BEFORE_DOWN - 1).fill(
      'degraded',
    );
    expect(reports.map((r) => r.status)).toEqual([...expected, 'down']);
  });

  it('starts the run again after the database comes back', async () => {
    let up = false;
    const health = serviceWith(() => (up ? answers() : refuses()));

    await health.check();
    await health.check();
    up = true;
    await expect(health.check()).resolves.toMatchObject({
      consecutiveFailures: 0,
    });

    up = false;
    await expect(health.check()).resolves.toMatchObject({
      status: 'degraded',
      consecutiveFailures: 1,
    });
  });

  it('gives up on a query that never comes back, inside ten seconds', async () => {
    // A hung connection, which is the case the deadline exists for: without
    // it the probe waits as long as the driver does, Render's own timeout
    // fires first, and the counter never advances at all.
    //
    // Ten seconds is named here rather than PROBE_TIMEOUT_MS on purpose. A
    // test that advances by the constant it is checking passes for any value
    // of it, including one so large the deadline never fires in practice --
    // which is the mutant this wording exists to catch.
    jest.useFakeTimers();
    const health = serviceWith(hangs);

    const probe = health.check();
    await jest.advanceTimersByTimeAsync(10_000);

    await expect(probe).resolves.toMatchObject({
      status: 'degraded',
      database: 'down',
    });
  });

  it('waits long enough to survive one slow query', () => {
    // The other side of the same constant: a deadline of nothing would report
    // a healthy-but-busy database as unreachable.
    expect(PROBE_TIMEOUT_MS).toBeGreaterThanOrEqual(1_000);
    expect(PROBE_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
  });

  it('does not give up on a query that answers inside the deadline', async () => {
    jest.useFakeTimers();
    const health = serviceWith(
      () => new Promise((resolve) => setTimeout(resolve, PROBE_TIMEOUT_MS - 1)),
    );

    const probe = health.check();
    await jest.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS);

    await expect(probe).resolves.toMatchObject({ status: 'ok' });
  });
});
