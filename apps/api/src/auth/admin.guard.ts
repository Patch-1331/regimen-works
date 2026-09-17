import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_ADMIN_ONLY_KEY } from '../common/admin-only.decorator';
import { AUTH_IS_ADMIN } from './clerk-auth.guard';

/**
 * Lets only an admin past a route marked @AdminOnly(), and does nothing at all
 * anywhere else (DN-92).
 *
 * Global rather than per-controller, registered after ClerkAuthGuard. Nest
 * runs global guards in registration order and before any route guard, so the
 * flag ClerkAuthGuard stashes is always there by the time this looks — and a
 * route can be closed by one decorator instead of two.
 *
 * Reads the stashed flag rather than re-reading the token: one verification
 * per request, and no chance of the two guards disagreeing about the same
 * caller.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const adminOnly = this.reflector.getAllAndOverride<boolean>(
      IS_ADMIN_ONLY_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!adminOnly) return true;

    const request = context
      .switchToHttp()
      .getRequest<Request & Record<string, unknown>>();
    const isAdmin = request[AUTH_IS_ADMIN];

    // Absent, not false. ClerkAuthGuard sets this on every request it admits,
    // so nothing here means nothing verified the caller — @AdminOnly() on a
    // @Public() route, or on a route this guard somehow outran. Throwing is
    // the only safe reading: a 403 would quietly file a wiring bug under
    // "working as intended".
    if (typeof isAdmin !== 'boolean') {
      throw new Error(
        'AdminGuard ran on an unauthenticated route — @AdminOnly() requires ClerkAuthGuard to have verified the caller.',
      );
    }

    // Says "admin only" rather than naming the flag: an athlete probing an
    // admin route learns the route exists either way, and nothing more.
    if (!isAdmin) throw new ForbiddenException('Admins only');
    return true;
  }
}
