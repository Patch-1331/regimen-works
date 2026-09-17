import { SetMetadata } from '@nestjs/common';

export const IS_ADMIN_ONLY_KEY = 'isAdminOnly';

/**
 * Restricts a route to an admin (DN-92). The counterpart to @Public(): that
 * one opens a route to everyone, this one closes it to all but one.
 *
 * Marking alone is enough — AdminGuard is registered globally, so there is no
 * second @UseGuards() to forget. That pairing is the trap this avoids: a route
 * carrying @AdminOnly() and no guard type-checks, reads as guarded in review,
 * and is open to every authenticated athlete.
 *
 * Only meaningful on a route ClerkAuthGuard covers. Combined with @Public()
 * the guard throws rather than admitting the caller, because there is no
 * verified identity to judge and "anonymous admin" is not a state this system
 * has.
 */
export const AdminOnly = () => SetMetadata(IS_ADMIN_ONLY_KEY, true);
