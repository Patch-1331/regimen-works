import { Controller, Get } from '@nestjs/common';
import type { Me } from '@regimen-works/shared';
import {
  CurrentUser,
  CurrentUserIsAdmin,
} from '../auth/current-user.decorator';

/**
 * What the API knows about the caller (DN-92). Answered entirely from the
 * verified token, so it touches no database and costs nothing beyond the
 * guard that already ran.
 *
 * The web client reads this to decide whether to render admin surfaces at
 * all. It is not the enforcement — AdminGuard is — and a client that lies to
 * itself about this gains only a button that 403s.
 */
@Controller('me')
export class MeController {
  @Get()
  get(
    @CurrentUser() userId: string,
    @CurrentUserIsAdmin() isAdmin: boolean,
  ): Me {
    return { id: userId, isAdmin };
  }
}
