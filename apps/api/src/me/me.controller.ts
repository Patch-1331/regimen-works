import { Controller, Get } from '@nestjs/common';
import type { Me } from '@regimen-works/shared';
import {
  CurrentUser,
  CurrentUserIsAdmin,
} from '../auth/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

/**
 * What the API knows about the caller (DN-92).
 *
 * Identity comes from the verified token, as it always has. `onboardedAt`
 * cannot: it is a fact the athlete established by using the app, so this now
 * costs one primary-key read (DN-15) on a row `UserProvisioningService` has
 * already guaranteed exists by the time the guard lets a request through.
 *
 * That read is the price of the setup gate being answerable from the one
 * endpoint the client already fetches on every load. The alternative was a
 * second request the client would have to make before it could render
 * anything at all, which is the same round trip in a worse place.
 *
 * The web client reads this to decide whether to render admin surfaces, and
 * whether to render the app at all rather than the first-run wizard. Neither
 * is enforcement -- AdminGuard is, and setup writes what setup writes -- and
 * a client that lies to itself about either gains a button that 403s or a
 * wizard it can walk out of.
 */
@Controller('me')
export class MeController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async get(
    @CurrentUser() userId: string,
    @CurrentUserIsAdmin() isAdmin: boolean,
  ): Promise<Me> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { onboardedAt: true },
    });
    return {
      id: userId,
      isAdmin,
      // Null for an athlete who has not finished setup -- and the same answer
      // for one whose row is somehow missing, which sends them to the wizard
      // rather than 500ing on the first screen they see.
      onboardedAt: user?.onboardedAt?.toISOString() ?? null,
    };
  }
}
