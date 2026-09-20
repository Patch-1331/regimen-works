import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from './common/public.decorator';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  // Not the health check any more -- that is GET /health, which actually
  // reaches the database (DN-76). This stays public and unthrottled anyway:
  // it is the API's front door, anything pointed at the bare host still hits
  // it, and a route that answers a constant string has nothing to protect.
  //
  // The throttle exemption carries the same reasoning /health does: probes
  // arrive from outside the Cloudflare edge, so they share one tracker key,
  // and a throttled probe reads as an unhealthy service and restarts it.
  //
  // Every tier has to be named explicitly. A bare @SkipThrottle() sets
  // `{ default: true }`, which matches nothing when the tiers are named — it
  // reads as an exemption while silently being none.
  @Public()
  @SkipThrottle({ burst: true, sustained: true })
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
