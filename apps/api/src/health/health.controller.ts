import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../common/public.decorator';
import { HealthService } from './health.service';
import { isUnhealthy, type HealthReport } from './health.logic';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /**
   * Render's health check target, and the uptime monitor's (DN-76).
   *
   * `@Public()` and the throttle exemption are load-bearing for the same
   * reasons they are on `AppController`: the probe cannot send an auth header,
   * and Render's probes all share one tracker key, so a throttled probe reads
   * as an unhealthy service and restarts it. Every tier has to be named --
   * a bare `@SkipThrottle()` sets `{ default: true }`, which matches nothing
   * when the tiers are named and so reads as an exemption while being none.
   *
   * 503 rather than a 200 carrying a sad body: Render and any uptime monitor
   * judge the status code, so a failure described in JSON with a 200 on it is
   * a check that still cannot fail.
   */
  @Public()
  @SkipThrottle({ burst: true, sustained: true })
  @Get()
  async check(): Promise<HealthReport> {
    const report = await this.health.check();
    if (isUnhealthy(report)) throw new ServiceUnavailableException(report);
    return report;
  }
}
