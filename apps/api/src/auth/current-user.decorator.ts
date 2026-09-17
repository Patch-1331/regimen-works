import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { AUTH_IS_ADMIN, AUTH_USER_ID } from './clerk-auth.guard';

/**
 * The verified Clerk user id for this request, set by ClerkAuthGuard. Only
 * valid on routes the guard covers — a @Public() route has no user, so this
 * throws rather than handing a handler an empty string it might scope a query
 * with.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx
      .switchToHttp()
      .getRequest<Request & Record<string, unknown>>();
    const userId = request[AUTH_USER_ID];
    if (typeof userId !== 'string' || userId === '') {
      throw new Error(
        'CurrentUser used on a route without ClerkAuthGuard — every data route must be guarded.',
      );
    }
    return userId;
  },
);

/**
 * Whether the verified caller is an admin (DN-92), set by ClerkAuthGuard.
 *
 * For a handler that *shapes* its answer around admin — `/me`, which exists so
 * the UI knows whether to render an admin surface at all. Enforcement is
 * @AdminOnly() and AdminGuard; a handler branching on this to decide whether
 * to do the work is writing its own guard, and worse than the one it has.
 *
 * Throws on an unguarded route for the same reason @CurrentUser does: absent
 * means unverified, and defaulting that to `false` would turn a wiring bug
 * into a plausible-looking answer.
 */
export const CurrentUserIsAdmin = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): boolean => {
    const request = ctx
      .switchToHttp()
      .getRequest<Request & Record<string, unknown>>();
    const isAdmin = request[AUTH_IS_ADMIN];
    if (typeof isAdmin !== 'boolean') {
      throw new Error(
        'CurrentUserIsAdmin used on a route without ClerkAuthGuard — there is no verified caller to describe.',
      );
    }
    return isAdmin;
  },
);
