import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  PROBE_TIMEOUT_MS,
  readHealth,
  type HealthReport,
} from './health.logic';

/**
 * The database round-trip behind the health check, plus the one piece of state
 * the threshold in `health.logic` needs: how many probes have failed in a row.
 *
 * The counter is in-process, and that is fine for the same reason the
 * throttler's storage is (see `AppModule`): this service runs at
 * `numInstances: 1`, and a deploy resetting the count to zero is the right
 * behaviour anyway -- a fresh instance has no failure history to carry.
 */
@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private consecutiveFailures = 0;

  constructor(private readonly prisma: PrismaService) {}

  async check(): Promise<HealthReport> {
    const report = readHealth(
      await this.databaseAnswers(),
      this.consecutiveFailures,
    );
    this.consecutiveFailures = report.consecutiveFailures;
    return report;
  }

  /**
   * `SELECT 1` under a deadline.
   *
   * The query is not cancelled when the deadline wins -- there is no portable
   * way to do that through the driver adapter, and it does not matter: the
   * point is that the probe answers, not that the connection is tidied up.
   */
  private async databaseAnswers(): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        this.prisma.$queryRaw`SELECT 1`.then(() => true),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), PROBE_TIMEOUT_MS);
        }),
      ]);
    } catch (error) {
      // Logged rather than swallowed: the response says only "down", and the
      // driver's message is the part that says why.
      this.logger.warn(
        `Health probe could not reach the database: ${String(error)}`,
      );
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}
