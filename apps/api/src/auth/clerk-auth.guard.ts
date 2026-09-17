import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { verifyToken } from '@clerk/backend';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../common/public.decorator';
import { webOrigins } from '../common/origins';
import { UserProvisioningService } from './user-provisioning.service';

/** Where the verified Clerk user id is stashed for @CurrentUser() to read. */
export const AUTH_USER_ID = 'authUserId';

/**
 * Where the verified admin flag is stashed for AdminGuard and @CurrentUser to
 * read. Deliberately set on every guarded request, admin or not, so its
 * absence means "this request was never authenticated" rather than "this
 * caller is an athlete" (DN-92).
 */
export const AUTH_IS_ADMIN = 'authIsAdmin';

/**
 * Verifies the Clerk session token on every non-public route and records who
 * the caller is. Replaces the shared-secret ApiTokenGuard: a static token
 * shipped to a browser is readable by anyone who loads the page, whereas a
 * Clerk session token is short-lived and identifies one user, which is what
 * per-user data scoping needs.
 *
 * Verification is networkless — the JWT is checked against Clerk's public
 * keys, so this costs no round trip per request.
 *
 * `authorizedParties` is what stops a token minted for some other frontend on
 * the same Clerk instance from being spent here. Clerk skips the check
 * entirely when the option is absent, so leaving it unset silently accepts any
 * token the instance ever issued, whatever origin asked for it.
 *
 * Admin (DN-92) rides on the same verification. `isAdmin` is a custom claim
 * the Clerk JWT template fills from `publicMetadata.isAdmin`, so reading it
 * here stays networkless -- the property above is the whole reason this guard
 * exists in this shape, and a `clerkClient.users.getUser` per admin request
 * would give it up.
 *
 * Two consequences of that choice, both deliberate:
 *
 *   - The claim lives in Clerk dashboard config nothing in this repo can
 *     assert. A missing template, a renamed claim or a dropped field all leave
 *     the claim absent, which reads as *not* an admin. Drift can lock an admin
 *     out; it cannot let an athlete in.
 *   - Revoking admin takes effect at the caller's next token refresh, not
 *     instantly. Clerk session tokens last ~60s, so that is the exposure --
 *     small, bounded, and the price of not paying a round trip per request.
 */
@Injectable()
export class ClerkAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly provisioning: UserProvisioningService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }

    let userId: string;
    let isAdmin: boolean;
    try {
      const claims = await verifyToken(header.slice('Bearer '.length), {
        secretKey: process.env.CLERK_SECRET_KEY,
        // Same allowlist CORS uses: the origins that are allowed to hold a
        // token for this API are exactly the ones allowed to read its
        // responses.
        authorizedParties: webOrigins(),
      });
      // `sub` is Clerk's user id and is what User.id stores.
      userId = claims.sub;
      // `=== true` rather than a truthiness check: the claim is typed
      // `unknown` (JwtPayload carries an index signature), and a template
      // misconfigured to emit the string "false" is truthy.
      isAdmin = claims.isAdmin === true;
    } catch {
      // Deliberately opaque: an expired token and a forged one should look
      // identical from outside.
      throw new UnauthorizedException('Invalid session token');
    }

    if (!userId) throw new UnauthorizedException('Token carries no subject');

    await this.provisioning.ensure(userId);
    const stash = request as Request & Record<string, unknown>;
    stash[AUTH_USER_ID] = userId;
    stash[AUTH_IS_ADMIN] = isAdmin;
    return true;
  }
}
